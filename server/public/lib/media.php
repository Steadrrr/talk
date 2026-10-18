<?php
// SAKi Talk 사진·영상: 휴대폰에서 줄인 파일을 2MB 조각으로 받아 비공개 폴더(설정 폴더/media)에 둔다.
//  - 주소는 무작위 열쇠 (api.php/media/<열쇠>), <img>·<video> 가 머리를 못 붙여서 로그인 없이 열쇠로만
//  - 영상은 Range 요청을 받아야 아이폰에서 재생된다
//  - 보관: 사진 photo_days·영상 video_days 일, 전체 media_limit_mb 를 넘으면 오래된 것부터 지움
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_CHUNK_MAX = 2 * 1024 * 1024 + 1024;
const TALK_MEDIA_TYPES = [
    'photo' => ['image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/png' => 'png'],
    'video' => ['video/mp4' => 'mp4', 'video/quicktime' => 'mov', 'video/webm' => 'webm'],
];
const TALK_MEDIA_MAX = ['photo' => 6 * 1024 * 1024, 'video' => 40 * 1024 * 1024];

function talk_media_dir(array $cfg): string {
    $d = $cfg['private_dir'] . '/media';
    if (!is_dir($d) && !@mkdir($d, 0700, true) && !is_dir($d)) talk_fail('사진을 둘 폴더를 만들지 못했어요.', 500);
    return $d;
}

function talk_media_path(array $cfg, array $m): string {
    return talk_media_dir($cfg) . '/' . $m['mkey'] . '.' . (TALK_MEDIA_TYPES[$m['kind']][$m['mime']] ?? 'bin');
}

function talk_media_row(PDO $pdo, string $key): ?array {
    if (!preg_match('/^[a-f0-9]{32}$/', $key)) return null;
    $st = $pdo->prepare('SELECT * FROM talk_media WHERE mkey = ?');
    $st->execute([$key]);
    return $st->fetch() ?: null;
}

// 올리기 시작: 크기·종류를 확인하고 빈 파일을 만든다
function talk_media_start(PDO $pdo, array $cfg, int $uid, array $b): array {
    $roomId = (int)($b['room_id'] ?? 0);
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $kind = (string)($b['kind'] ?? '');
    $mime = (string)($b['mime'] ?? '');
    if (!isset(TALK_MEDIA_TYPES[$kind][$mime])) talk_fail('보낼 수 없는 파일이에요.');
    $size = (int)($b['size'] ?? 0);
    if ($size <= 0) talk_fail('빈 파일이에요.');
    if ($size > TALK_MEDIA_MAX[$kind]) talk_fail($kind === 'photo' ? '사진이 너무 커요.' : '영상이 너무 커요. 60초 이하로 보내 주세요.');
    if ($size > (int)$cfg['media_limit_mb'] * 1024 * 1024) talk_fail('사진·영상 전체 용량보다 커요.');
    $thumb = null;
    if (!empty($b['thumb'])) {
        $thumb = base64_decode((string)$b['thumb'], true);
        if ($thumb === false || strlen($thumb) > 200_000 || talk_photo_type($thumb) === null) $thumb = null;
    }
    $key = bin2hex(random_bytes(16));
    $pdo->prepare('INSERT INTO talk_media (mkey, room_id, user_id, kind, mime, size, w, h, dur, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$key, $roomId, $uid, $kind, $mime, $size, max(0, (int)($b['w'] ?? 0)), max(0, (int)($b['h'] ?? 0)), max(0, (int)($b['dur'] ?? 0)), $thumb, talk_now()]);
    $m = talk_media_row($pdo, $key);
    if (file_put_contents(talk_media_path($cfg, $m), '') === false) talk_fail('파일을 만들지 못했어요.', 500);
    return ['key' => $key];
}

// 조각 이어 붙이기: offset 이 지금까지 받은 크기와 같을 때만 (끊겼다 다시 보내도 겹치지 않게)
function talk_media_chunk(PDO $pdo, array $cfg, int $uid, string $key, int $offset): array {
    $m = talk_media_row($pdo, $key);
    if (!$m || (int)$m['user_id'] !== $uid || (int)$m['done'] || (int)$m['deleted']) talk_fail('올리던 파일을 찾지 못했어요.', 404);
    $path = talk_media_path($cfg, $m);
    clearstatcache(true, $path);
    $have = is_file($path) ? (int)filesize($path) : 0;
    if ($offset !== $have) return ['received' => $have];   // 앱이 이 자리부터 다시 보냄
    $data = file_get_contents('php://input', false, null, 0, TALK_CHUNK_MAX + 1);
    if ($data === false || $data === '') talk_fail('조각이 비었어요.');
    if (strlen($data) > TALK_CHUNK_MAX) talk_fail('조각이 너무 커요.', 413);
    if ($have + strlen($data) > (int)$m['size']) talk_fail('파일 크기가 맞지 않아요.');
    if (file_put_contents($path, $data, FILE_APPEND | LOCK_EX) === false) talk_fail('파일을 쓰지 못했어요. 서버 용량을 확인해 주세요.', 500);
    clearstatcache(true, $path);
    return ['received' => (int)filesize($path)];
}

// 다 올렸으면 메시지로 (본문은 JSON: 열쇠·크기·가로세로·길이)
function talk_media_finish(PDO $pdo, array $cfg, int $uid, string $key, string $clientId): array {
    $m = talk_media_row($pdo, $key);
    if (!$m || (int)$m['user_id'] !== $uid || (int)$m['deleted']) talk_fail('올리던 파일을 찾지 못했어요.', 404);
    if ((int)$m['done'] && $m['message_id']) {
        $st = $pdo->prepare('SELECT * FROM talk_messages WHERE id = ?');
        $st->execute([(int)$m['message_id']]);
        return talk_msg_view($st->fetch());
    }
    $roomId = (int)$m['room_id'];
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $path = talk_media_path($cfg, $m);
    clearstatcache(true, $path);
    if (!is_file($path) || filesize($path) !== (int)$m['size']) talk_fail('파일을 다 받지 못했어요. 다시 보내 주세요.');
    $head = (string)file_get_contents($path, false, null, 0, 16);
    if ($m['kind'] === 'photo' && talk_photo_type($head) === null) { @unlink($path); talk_fail('사진 파일이 아니에요.'); }
    $body = json_encode(['key' => $key, 'w' => (int)$m['w'], 'h' => (int)$m['h'], 'dur' => (int)$m['dur'], 'size' => (int)$m['size'], 'thumb' => $m['thumb'] !== null],
        JSON_UNESCAPED_SLASHES);
    $clientId = preg_match('/^[A-Za-z0-9_-]{8,40}$/', $clientId) ? $clientId : null;
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO talk_messages (room_id, user_id, kind, body, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$roomId, $uid, $m['kind'], $body, $clientId, talk_now()]);
    $id = (int)$pdo->lastInsertId();
    $pdo->prepare('UPDATE talk_media SET done = 1, message_id = ? WHERE id = ?')->execute([$id, (int)$m['id']]);
    $pdo->prepare('UPDATE talk_room_members SET last_read_id = ? WHERE room_id = ? AND user_id = ?')->execute([$id, $roomId, $uid]);
    talk_event($pdo, $roomId, 'msg', $id);
    $pdo->commit();
    $text = $m['kind'] === 'photo' ? '사진을 보냈어요.' : '동영상을 보냈어요.';
    if (function_exists('talk_push_message')) talk_after_response(fn() => talk_push_message($pdo, $roomId, $uid, $text));
    talk_after_response(fn() => talk_media_cleanup($pdo, $cfg));
    $st = $pdo->prepare('SELECT * FROM talk_messages WHERE id = ?');
    $st->execute([$id]);
    return talk_msg_view($st->fetch());
}

// 하나 지우기: 파일을 지우고 메시지 본문에 gone 표시 (방 사람들 앱이 다시 받게 'room' 변경)
function talk_media_delete(PDO $pdo, array $cfg, array $m): void {
    @unlink(talk_media_path($cfg, $m));
    $pdo->prepare('UPDATE talk_media SET deleted = 1, thumb = NULL WHERE id = ?')->execute([(int)$m['id']]);
    if ($m['message_id']) {
        $st = $pdo->prepare('SELECT body FROM talk_messages WHERE id = ?');
        $st->execute([(int)$m['message_id']]);
        $b = json_decode((string)$st->fetchColumn(), true) ?: [];
        $b['gone'] = true;
        $pdo->prepare('UPDATE talk_messages SET body = ? WHERE id = ?')->execute([json_encode($b, JSON_UNESCAPED_SLASHES), (int)$m['message_id']]);
        talk_event($pdo, (int)$m['room_id'], 'room');
    }
}

// 정리: 보관 기간이 지난 것, 하루 넘게 덜 올라온 것, 그리고 전체 상한을 넘으면 오래된 것부터
function talk_media_cleanup(PDO $pdo, array $cfg): array {
    $out = ['expired' => 0, 'over' => 0];
    $now = time();
    $st = $pdo->prepare("SELECT * FROM talk_media WHERE deleted = 0 AND (
        (done = 0 AND created_at < ?) OR (kind = 'photo' AND created_at < ?) OR (kind = 'video' AND created_at < ?))");
    $st->execute([gmdate('Y-m-d H:i:s', $now - 86400), gmdate('Y-m-d H:i:s', $now - (int)$cfg['photo_days'] * 86400), gmdate('Y-m-d H:i:s', $now - (int)$cfg['video_days'] * 86400)]);
    foreach ($st->fetchAll() as $m) { talk_media_delete($pdo, $cfg, $m); $out['expired']++; }
    $limit = (int)$cfg['media_limit_mb'] * 1024 * 1024;
    $total = talk_media_usage($pdo);
    if ($total > $limit) {
        foreach ($pdo->query('SELECT * FROM talk_media WHERE deleted = 0 AND done = 1 ORDER BY id')->fetchAll() as $m) {
            if ($total <= $limit) break;
            talk_media_delete($pdo, $cfg, $m);
            $total -= (int)$m['size'];
            $out['over']++;
        }
    }
    return $out;
}

function talk_media_usage(PDO $pdo): int {
    return (int)$pdo->query('SELECT COALESCE(SUM(size), 0) FROM talk_media WHERE deleted = 0')->fetchColumn();
}

// 내려 주기 (영상은 Range 로 일부만도)
function talk_media_serve(PDO $pdo, array $cfg, string $key, bool $thumb): never {
    $m = talk_media_row($pdo, $key);
    if (!$m || (int)$m['deleted'] || !(int)$m['done']) talk_fail('보관 기간이 지나 지워졌어요.', 404);
    header('Cache-Control: private, max-age=31536000, immutable');
    if ($thumb) {
        if ($m['thumb'] === null) talk_fail('미리보기가 없어요.', 404);
        header('Content-Type: ' . (talk_photo_type($m['thumb']) ?? 'image/jpeg'));
        header('Content-Length: ' . strlen($m['thumb']));
        echo $m['thumb'];
        exit;
    }
    $path = talk_media_path($cfg, $m);
    if (!is_file($path)) talk_fail('보관 기간이 지나 지워졌어요.', 404);
    $size = (int)filesize($path);
    $start = 0;
    $end = $size - 1;
    header('Content-Type: ' . $m['mime']);
    header('Accept-Ranges: bytes');
    if (preg_match('/^bytes=(\d*)-(\d*)$/', (string)($_SERVER['HTTP_RANGE'] ?? ''), $r)) {
        if ($r[1] === '' && $r[2] !== '') { $start = max(0, $size - (int)$r[2]); }
        else { $start = (int)$r[1]; if ($r[2] !== '') $end = min($end, (int)$r[2]); }
        if ($start > $end || $start >= $size) {
            http_response_code(416);
            header("Content-Range: bytes */$size");
            exit;
        }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    $f = fopen($path, 'rb');
    fseek($f, $start);
    $left = $end - $start + 1;
    while ($left > 0 && !feof($f)) {
        $buf = fread($f, (int)min(65536, $left));
        if ($buf === false) break;
        echo $buf;
        $left -= strlen($buf);
    }
    fclose($f);
    exit;
}

// 모두에게 삭제: 보낸 사람만. 파일도 지우고, 메시지는 "삭제된 메시지" 로 바뀐다 (모두의 화면에 같은 번호로 다시 내려감)
function talk_message_delete(PDO $pdo, array $cfg, int $uid, int $msgId): void {
    $st = $pdo->prepare('SELECT id, room_id, user_id, kind FROM talk_messages WHERE id = ?');
    $st->execute([$msgId]);
    $m = $st->fetch();
    if (!$m || !talk_room_member($pdo, $uid, (int)$m['room_id'])) talk_fail('메시지가 없어요.', 404);
    if ((int)$m['user_id'] !== $uid) talk_fail('내가 보낸 것만 모두에게서 지울 수 있어요.', 403);
    if ($m['kind'] === 'system') talk_fail('안내 글은 지울 수 없어요.', 400);
    if ($m['kind'] === 'deleted') return;
    $st = $pdo->prepare('SELECT * FROM talk_media WHERE message_id = ? AND deleted = 0');
    $st->execute([$msgId]);
    foreach ($st->fetchAll() as $md) {
        @unlink(talk_media_path($cfg, $md));
        $pdo->prepare('UPDATE talk_media SET deleted = 1, thumb = NULL WHERE id = ?')->execute([(int)$md['id']]);
    }
    $pdo->prepare("UPDATE talk_messages SET kind = 'deleted', body = '' WHERE id = ?")->execute([$msgId]);
    talk_event($pdo, (int)$m['room_id'], 'msg', $msgId);
}
