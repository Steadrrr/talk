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

// 미리보기 그림 (영상 첫 장면 JPEG). 올리기 시작 뒤 그대로(octet-stream) 따로 받는다
function talk_media_thumb(PDO $pdo, int $uid, string $key, string $data): void {
    $m = talk_media_row($pdo, $key);
    if (!$m || (int)$m['user_id'] !== $uid || (int)$m['done'] || (int)$m['deleted']) talk_fail('올리던 파일을 찾지 못했어요.', 404);
    if ($data === '' || strlen($data) > 200_000 || talk_photo_type($data) === null) talk_fail('미리보기 그림이 아니에요.');
    $pdo->prepare('UPDATE talk_media SET thumb = ? WHERE id = ?')->execute([$data, (int)$m['id']]);
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
    talk_media_check_file($cfg, $m);
    $text = $m['kind'] === 'photo' ? '사진을 보냈어요.' : '동영상을 보냈어요.';
    return talk_media_post($pdo, $cfg, $uid, $roomId, $m['kind'], talk_media_item($m), [$m], $clientId, $text);
}

// 다 받았는지·사진이 맞는지
function talk_media_check_file(array $cfg, array $m): void {
    $path = talk_media_path($cfg, $m);
    clearstatcache(true, $path);
    if (!is_file($path) || filesize($path) !== (int)$m['size']) talk_fail('파일을 다 받지 못했어요. 다시 보내 주세요.');
    $head = (string)file_get_contents($path, false, null, 0, 16);
    if ($m['kind'] === 'photo' && talk_photo_type($head) === null) { @unlink($path); talk_fail('사진 파일이 아니에요.'); }
}

// 메시지 본문에 들어가는 파일 하나 (묶음이면 items 안에 이것들)
function talk_media_item(array $m): array {
    return ['key' => $m['mkey'], 'w' => (int)$m['w'], 'h' => (int)$m['h'], 'dur' => (int)$m['dur'], 'size' => (int)$m['size'], 'thumb' => $m['thumb'] !== null];
}

// 사진·영상 메시지 만들기: 올린 파일이면 done 표시, 메시지마다 쓰는 파일을 talk_media_uses 에
function talk_media_post(PDO $pdo, array $cfg, int $uid, int $roomId, string $kind, array $body, array $media, string $clientId, string $pushText): array {
    $clientId = preg_match('/^[A-Za-z0-9_-]{8,40}$/', $clientId) ? $clientId : null;
    $st = $pdo->prepare("SELECT dm_key FROM talk_rooms WHERE id = ? AND kind = 'dm'");
    $st->execute([$roomId]);
    if ($dm = $st->fetchColumn()) talk_dm_rejoin($pdo, $roomId, array_map('intval', explode(':', $dm)));
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO talk_messages (room_id, user_id, kind, body, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$roomId, $uid, $kind, json_encode($body, JSON_UNESCAPED_SLASHES), $clientId, talk_now()]);
    $id = (int)$pdo->lastInsertId();
    $done = $pdo->prepare('UPDATE talk_media SET done = 1, message_id = ? WHERE id = ? AND done = 0');
    $use = $pdo->prepare('INSERT IGNORE INTO talk_media_uses (mkey, message_id, room_id) VALUES (?, ?, ?)');
    foreach ($media as $m) { $done->execute([$id, (int)$m['id']]); $use->execute([$m['mkey'], $id, $roomId]); }
    $pdo->prepare('UPDATE talk_room_members SET last_read_id = ? WHERE room_id = ? AND user_id = ?')->execute([$id, $roomId, $uid]);
    talk_event($pdo, $roomId, 'msg', $id);
    $pdo->commit();
    if (function_exists('talk_push_message')) talk_after_response(fn() => talk_push_message($pdo, $roomId, $uid, $pushText));
    talk_after_response(fn() => talk_media_cleanup($pdo, $cfg));
    $st = $pdo->prepare('SELECT * FROM talk_messages WHERE id = ?');
    $st->execute([$id]);
    return talk_decorate($pdo, [talk_msg_view($st->fetch())])[0];
}

const TALK_ALBUM_MAX = 30;

// 사진 묶음: 따로 올린 사진 여러 장(다 받은 것)을 메시지 하나로. 본문 {"items":[{key,w,h,size}, …]}
function talk_media_album(PDO $pdo, array $cfg, int $uid, array $keys, string $clientId): array {
    $keys = array_values(array_unique(array_map('strval', $keys)));
    if (count($keys) < 2) talk_fail('묶음은 사진 두 장부터예요.');
    if (count($keys) > TALK_ALBUM_MAX) talk_fail('한 번에 ' . TALK_ALBUM_MAX . '장까지 보낼 수 있어요.');
    $rows = [];
    foreach ($keys as $k) {
        $m = talk_media_row($pdo, $k);
        if (!$m || (int)$m['user_id'] !== $uid || (int)$m['deleted'] || $m['kind'] !== 'photo') talk_fail('올리던 사진을 찾지 못했어요. 다시 보내 주세요.', 404);
        $rows[] = $m;
    }
    // 다시 보낸 것(연결이 끊겨 재시도): 이미 만든 메시지
    if ((int)$rows[0]['done'] && $rows[0]['message_id']) {
        $st = $pdo->prepare('SELECT * FROM talk_messages WHERE id = ?');
        $st->execute([(int)$rows[0]['message_id']]);
        if ($msg = $st->fetch()) return talk_decorate($pdo, [talk_msg_view($msg)])[0];
    }
    $roomId = (int)$rows[0]['room_id'];
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    foreach ($rows as $m) {
        if ((int)$m['room_id'] !== $roomId || (int)$m['done']) talk_fail('올리던 사진을 찾지 못했어요. 다시 보내 주세요.', 404);
        talk_media_check_file($cfg, $m);
    }
    return talk_media_post($pdo, $cfg, $uid, $roomId, 'photo', ['items' => array_map('talk_media_item', $rows)], $rows, $clientId, '사진 ' . count($rows) . '장을 보냈어요.');
}

// 사진·영상 메시지의 파일들 (묶음이면 items, 아니면 본문 하나)
function talk_media_items(array $body): array {
    if (isset($body['items']) && is_array($body['items'])) return $body['items'];
    return isset($body['key']) ? [$body] : [];
}

// 전달: 같은 그룹의 방·친구에게. 사진·영상은 다시 올리지 않고 같은 파일을 쓴다 (보관 기간은 처음 올린 날부터)
//  index 가 있으면 묶음 가운데 그 한 장만
function talk_forward(PDO $pdo, array $cfg, int $uid, int $msgId, ?int $index, array $roomIds, array $userIds): array {
    $st = $pdo->prepare('SELECT m.*, r.group_id FROM talk_messages m JOIN talk_rooms r ON r.id = m.room_id WHERE m.id = ?');
    $st->execute([$msgId]);
    $src = $st->fetch();
    if (!$src || !talk_room_member($pdo, $uid, (int)$src['room_id'])) talk_fail('메시지가 없어요.', 404);
    if (!in_array($src['kind'], ['text', 'photo', 'video'], true)) talk_fail('전달할 수 없는 메시지예요.');
    $gid = (int)$src['group_id'];
    // 받을 곳: 내가 들어가 있는 같은 그룹 방 + 같은 그룹 친구와의 1:1 방
    $targets = [];
    $mine = talk_my_room_ids($pdo, $uid);
    $grp = $pdo->prepare('SELECT group_id FROM talk_rooms WHERE id = ?');
    foreach (array_unique(array_map('intval', $roomIds)) as $rid) {
        $grp->execute([$rid]);
        if (!in_array($rid, $mine, true) || (int)$grp->fetchColumn() !== $gid) talk_fail('같은 그룹 채팅방에만 전달할 수 있어요.', 403);
        $targets[$rid] = true;
    }
    foreach (array_unique(array_map('intval', $userIds)) as $u) {
        if ($u === $uid || !talk_in_group($pdo, $u, $gid)) talk_fail('같은 그룹 사람에게만 전달할 수 있어요.', 403);
        $bot = $pdo->prepare('SELECT is_bot FROM talk_users WHERE id = ?');
        $bot->execute([$u]);
        if ((int)$bot->fetchColumn()) talk_fail('같은 그룹 사람에게만 전달할 수 있어요.', 403);
        $targets[talk_open_dm($pdo, $uid, $u)] = true;
    }
    if (!$targets) talk_fail('전달할 곳을 골라 주세요.');
    if (count($targets) > 20) talk_fail('한 번에 20곳까지 전달할 수 있어요.');

    if ($src['kind'] === 'text') {
        $out = [];
        foreach (array_keys($targets) as $rid) $out[] = talk_send($pdo, $uid, $rid, (string)$src['body'], '', 0);
        return $out;
    }
    $items = talk_media_items(json_decode((string)$src['body'], true) ?: []);
    if ($index !== null) {
        if (!isset($items[$index])) talk_fail('사진을 찾지 못했어요.', 404);
        $items = [$items[$index]];
    }
    $media = [];
    foreach ($items as $it) {
        $m = talk_media_row($pdo, (string)($it['key'] ?? ''));
        if ($m && !(int)$m['deleted'] && (int)$m['done']) $media[] = $m;
    }
    if (!$media) talk_fail('보관 기간이 지나 지워져서 전달할 수 없어요.', 410);
    $body = count($media) > 1 ? ['items' => array_map('talk_media_item', $media)] : talk_media_item($media[0]);
    $text = $src['kind'] === 'video' ? '동영상을 보냈어요.' : (count($media) > 1 ? '사진 ' . count($media) . '장을 보냈어요.' : '사진을 보냈어요.');
    $out = [];
    foreach (array_keys($targets) as $rid) $out[] = talk_media_post($pdo, $cfg, $uid, $rid, $src['kind'], $body, $media, '', $text);
    return $out;
}

// 채팅방 사진 모아보기: 이 방의 사진 메시지 (최근 것부터, 지워진 것은 앱이 뺌)
function talk_room_photos(PDO $pdo, int $uid, int $roomId): array {
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $st = $pdo->prepare("SELECT * FROM talk_messages WHERE room_id = ? AND kind = 'photo' ORDER BY id DESC LIMIT 1000");
    $st->execute([$roomId]);
    return array_map('talk_msg_view', $st->fetchAll());
}

// 메시지들이 쓰던 파일을 놓음: 다른 메시지가 더 안 쓰는 파일은 지운다
function talk_media_release(PDO $pdo, array $cfg, array $keys): void {
    $left = $pdo->prepare('SELECT COUNT(*) FROM talk_media_uses WHERE mkey = ?');
    foreach (array_unique($keys) as $k) {
        $left->execute([$k]);
        if ((int)$left->fetchColumn() > 0) continue;
        $m = talk_media_row($pdo, $k);
        if (!$m || (int)$m['deleted']) continue;
        @unlink(talk_media_path($cfg, $m));
        $pdo->prepare('UPDATE talk_media SET deleted = 1, thumb = NULL WHERE id = ?')->execute([(int)$m['id']]);
    }
}

// 하나 지우기 (보관 기간·상한): 파일을 지우고, 이 파일을 쓰는 메시지마다 본문에 gone 표시
//  묶음은 그 한 장만 gone, 다 지워지면 메시지도 gone. 방 사람들 앱이 다시 받게 'room' 변경
function talk_media_delete(PDO $pdo, array $cfg, array $m): void {
    @unlink(talk_media_path($cfg, $m));
    $pdo->prepare('UPDATE talk_media SET deleted = 1, thumb = NULL WHERE id = ?')->execute([(int)$m['id']]);
    $st = $pdo->prepare('SELECT u.message_id, u.room_id, t.body FROM talk_media_uses u JOIN talk_messages t ON t.id = u.message_id WHERE u.mkey = ?');
    $st->execute([$m['mkey']]);
    $rooms = [];
    foreach ($st->fetchAll() as $u) {
        $b = json_decode((string)$u['body'], true) ?: [];
        if (isset($b['items']) && is_array($b['items'])) {
            foreach ($b['items'] as &$it) if (($it['key'] ?? '') === $m['mkey']) $it['gone'] = true;
            unset($it);
            if (!array_filter($b['items'], fn($it) => empty($it['gone']))) $b['gone'] = true;
        } else $b['gone'] = true;
        $pdo->prepare('UPDATE talk_messages SET body = ? WHERE id = ?')->execute([json_encode($b, JSON_UNESCAPED_SLASHES), (int)$u['message_id']]);
        $rooms[(int)$u['room_id']] = true;
    }
    $pdo->prepare('DELETE FROM talk_media_uses WHERE mkey = ?')->execute([$m['mkey']]);
    foreach (array_keys($rooms) as $rid) talk_event($pdo, $rid, 'room');
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
    // 파일은 이 메시지만 쓰고 있을 때만 지움 (전달한 곳에는 남음)
    $st = $pdo->prepare('SELECT mkey FROM talk_media_uses WHERE message_id = ?');
    $st->execute([$msgId]);
    $keys = $st->fetchAll(PDO::FETCH_COLUMN);
    $pdo->prepare('DELETE FROM talk_media_uses WHERE message_id = ?')->execute([$msgId]);
    talk_media_release($pdo, $cfg, $keys);
    $pdo->prepare("UPDATE talk_messages SET kind = 'deleted', body = '' WHERE id = ?")->execute([$msgId]);
    $u = $pdo->prepare('UPDATE talk_rooms SET notice_id = NULL, notice_by = NULL WHERE notice_id = ?');
    $u->execute([$msgId]);
    if ($u->rowCount() > 0) talk_event($pdo, (int)$m['room_id'], 'room');   // 공지였으면 공지도 내림
    talk_event($pdo, (int)$m['room_id'], 'msg', $msgId);
}
