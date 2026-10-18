<?php
// SAKi Talk 서버 API
// 주소: /talk/api.php/<경로>  (PATH_INFO 가 안 되는 서버면 /talk/api.php?r=<경로>)
// 공유 호스팅에서 막히기 쉬운 PUT/DELETE 와 Authorization 헤더는 쓰지 않는다: 쓰기는 모두 POST, 인증은 X-Talk-Token.
declare(strict_types=1);
define('TALK', true);
require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/accounts.php';
require __DIR__ . '/lib/chat.php';
require __DIR__ . '/lib/push.php';

header('X-Robots-Tag: noindex');

$route = trim((string)($_SERVER['PATH_INFO'] ?? ($_GET['r'] ?? '')), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$cfg = talk_config();
// 프로필·채팅방 사진 (로그인 없이: <img> 는 머리를 못 붙임. 주소의 열쇠가 무작위라 알아야만 봄)
if (preg_match('#^photo/([a-f0-9]{24})$#', $route, $pm)) {
    $cfg0 = talk_config();
    if ($cfg0 === null) talk_fail('설정 전이에요.', 503);
    $st = talk_db($cfg0)->prepare('SELECT photo FROM talk_users WHERE photo_key = ? UNION ALL SELECT photo FROM talk_rooms WHERE photo_key = ? LIMIT 1');
    $st->execute([$pm[1], $pm[1]]);
    $data = $st->fetchColumn();
    if (!$data) talk_fail('사진이 없어요.', 404);
    header('Content-Type: ' . (talk_photo_type($data) ?? 'application/octet-stream'));
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Content-Length: ' . strlen($data));
    echo $data;
    exit;
}

if ($route === 'health') {
    $out = ['ok' => true, 'name' => 'SAKi Talk', 'version' => TALK_SERVER_VERSION, 'configured' => $cfg !== null];
    if ($cfg !== null) {
        try {
            talk_migrate_if_needed(talk_db($cfg));
            $out['db'] = true;
        } catch (Throwable $e) {
            $out['db'] = false;
        }
    }
    talk_json($out);
}
if ($cfg === null) talk_fail('아직 설정하지 않았어요. setup.php 를 먼저 열어 주세요.', 503);

try {
    $pdo = talk_db($cfg);
    talk_migrate_if_needed($pdo);
    talk_ensure_admin($pdo, $cfg);
} catch (Throwable $e) {
    talk_fail('DB 에 연결하지 못했어요.', 500);
}

$need = function (string $m) use ($method) { if ($method !== $m) talk_fail('지원하지 않는 방식이에요.', 405); };
$q = fn(string $k, mixed $d = null) => $_GET[$k] ?? $d;

// ───── 로그인 없이 ─────
if ($route === 'auth/login') {
    $need('POST');
    $b = talk_body();
    talk_login_locked($pdo);
    $st = $pdo->prepare('SELECT id, password_hash FROM talk_users WHERE name = ? AND disabled = 0');
    $st->execute([trim((string)($b['name'] ?? ''))]);
    $u = $st->fetch();
    if (!$u || !password_verify((string)($b['password'] ?? ''), $u['password_hash'])) talk_login_fail($pdo, '이름이나 비밀번호가 맞지 않아요.');
    talk_json(['ok' => true, 'token' => talk_new_device($pdo, (int)$u['id'], (string)($b['device'] ?? ''))]);
}

// 초대 코드 확인 (가입 화면에서 그룹 이름을 보여 주려고). 틀린 코드는 로그인 실패처럼 센다
if ($route === 'auth/invite') {
    $need('POST');
    $b = talk_body();
    talk_login_locked($pdo);
    $gid = talk_invite_group($pdo, (string)($b['invite'] ?? ''), false);
    if ($gid === null) talk_login_fail($pdo, '초대 코드가 맞지 않거나 이미 다 썼어요.');
    $st = $pdo->prepare('SELECT name FROM talk_groups WHERE id = ?');
    $st->execute([$gid]);
    talk_json(['ok' => true, 'group' => $st->fetchColumn()]);
}

if ($route === 'auth/register') {
    $need('POST');
    $b = talk_body();
    talk_login_locked($pdo);
    $name = talk_clean_name($b['name'] ?? '');
    $nick = talk_clean_nick($b['nick'] ?? '');
    $pw = talk_check_new_password($b['password'] ?? '');
    if (talk_invite_group($pdo, (string)($b['invite'] ?? ''), false) === null) talk_login_fail($pdo, '초대 코드가 맞지 않거나 이미 다 썼어요.');
    $st = $pdo->prepare('SELECT 1 FROM talk_users WHERE name = ?');
    $st->execute([$name]);
    if ($st->fetchColumn()) talk_fail('이미 있는 이름이에요. 다른 이름을 써 주세요. (이미 가입했다면 로그인 후 초대 코드를 넣어 주세요)', 409);
    $pdo->beginTransaction();
    $gid = talk_invite_group($pdo, (string)$b['invite'], true);
    if ($gid === null) { $pdo->rollBack(); talk_fail('초대 코드가 맞지 않거나 이미 다 썼어요.', 401); }
    $pdo->prepare('INSERT INTO talk_users (name, nick, password_hash, created_at) VALUES (?, ?, ?, ?)')->execute([$name, $nick, password_hash($pw, PASSWORD_DEFAULT), talk_now()]);
    $uid = (int)$pdo->lastInsertId();
    talk_join_group($pdo, $uid, $gid);
    $pdo->commit();
    talk_json(['ok' => true, 'token' => talk_new_device($pdo, $uid, (string)($b['device'] ?? ''))]);
}

// ───── 로그인 필요 ─────
$me = talk_auth($pdo);
$uid = $me['id'];

switch ($route) {
    case 'me':
        talk_json(['ok' => true, 'me' => ['id' => $uid, 'name' => $me['name'], 'nick' => $me['nick'], 'photo' => $me['photo'], 'is_admin' => $me['is_admin']], 'groups' => talk_my_groups($pdo, $uid), 'groups_rev' => talk_groups_rev($pdo)]);

    case 'me/nick':
        $need('POST');
        talk_set_nick($pdo, $uid, talk_clean_nick(talk_body()['nick'] ?? ''));
        talk_json(['ok' => true]);

    case 'me/photo':
        $need('POST');
        $b = talk_body(500_000);
        $data = null;
        if (!empty($b['data'])) {
            $data = base64_decode((string)$b['data'], true);
            if ($data === false) talk_fail('사진을 읽지 못했어요.');
        }
        talk_set_photo($pdo, $uid, $data);
        talk_json(['ok' => true]);

    case 'rooms/photo':
        $need('POST');
        $b = talk_body(500_000);
        $data = null;
        if (!empty($b['data'])) {
            $data = base64_decode((string)$b['data'], true);
            if ($data === false) talk_fail('사진을 읽지 못했어요.');
        }
        talk_room_photo($pdo, $uid, (int)($b['room_id'] ?? 0), $data);
        talk_json(['ok' => true]);

    case 'rooms/prefs':
        $need('POST');
        $b = talk_body();
        talk_room_prefs($pdo, $uid, (int)($b['room_id'] ?? 0), $b);
        talk_json(['ok' => true]);

    case 'rooms/rename':
        $need('POST');
        $b = talk_body();
        talk_room_rename($pdo, $uid, (int)($b['room_id'] ?? 0), (string)($b['name'] ?? ''));
        talk_json(['ok' => true]);

    case 'rooms/invite':
        $need('POST');
        $b = talk_body();
        talk_room_invite($pdo, $uid, (int)($b['room_id'] ?? 0), (array)($b['user_ids'] ?? []));
        talk_json(['ok' => true]);

    case 'rooms/leave':
        $need('POST');
        talk_room_leave($pdo, $uid, (int)(talk_body()['room_id'] ?? 0));
        talk_json(['ok' => true]);

    case 'admin/ticket':
        // 앱의 관리자 계정 → 관리 화면을 비밀번호 없이 열기: 60초 동안 한 번 쓰는 표
        $need('POST');
        if (!$me['is_admin']) talk_fail('관리자만 쓸 수 있어요.', 403);
        $ticket = bin2hex(random_bytes(16));
        talk_meta_set($pdo, 'admin_ticket', json_encode(['hash' => hash('sha256', $ticket), 'exp' => time() + 60]));
        talk_json(['ok' => true, 'url' => 'setup.php?ticket=' . $ticket]);

    case 'me/away':
        $need('POST');
        $pdo->prepare('UPDATE talk_devices SET active_at = NULL WHERE id = ?')->execute([$me['device_id']]);
        talk_json(['ok' => true]);

    case 'push/key':
        talk_json(['ok' => true, 'key' => talk_vapid($pdo)['public']]);

    case 'push/subscribe':
        $need('POST');
        talk_push_subscribe($pdo, $me['device_id'], talk_body());
        talk_json(['ok' => true]);

    case 'push/test':
        $need('POST');
        talk_json(['ok' => true] + talk_push_test($pdo, $me['device_id']));

    case 'push/unsubscribe':
        $need('POST');
        talk_push_unsubscribe($pdo, $me['device_id'], (string)(talk_body()['endpoint'] ?? ''));
        talk_json(['ok' => true]);

    case 'auth/logout':
        $need('POST');
        $pdo->prepare('UPDATE talk_devices SET revoked = 1 WHERE id = ?')->execute([$me['device_id']]);
        talk_push_unsubscribe($pdo, $me['device_id'], '');
        talk_json(['ok' => true]);

    case 'auth/password':
        $need('POST');
        $b = talk_body();
        $st = $pdo->prepare('SELECT password_hash FROM talk_users WHERE id = ?');
        $st->execute([$uid]);
        if (!password_verify((string)($b['old'] ?? ''), (string)$st->fetchColumn())) talk_fail('지금 비밀번호가 맞지 않아요.', 403);
        $pdo->prepare('UPDATE talk_users SET password_hash = ? WHERE id = ?')->execute([password_hash(talk_check_new_password($b['new'] ?? ''), PASSWORD_DEFAULT), $uid]);
        talk_json(['ok' => true]);

    case 'groups/join':
        $need('POST');
        $b = talk_body();
        talk_login_locked($pdo);
        $gid = talk_invite_group($pdo, (string)($b['invite'] ?? ''), false);
        if ($gid === null) talk_login_fail($pdo, '초대 코드가 맞지 않거나 이미 다 썼어요.');
        if (talk_in_group($pdo, $uid, $gid)) talk_fail('이미 들어가 있는 그룹이에요.', 409);
        talk_invite_group($pdo, (string)$b['invite'], true);
        talk_join_group($pdo, $uid, $gid);
        talk_json(['ok' => true, 'groups' => talk_my_groups($pdo, $uid)]);

    case 'sync':
        if ($q('active', '0') === '1') talk_mark_active($pdo, $me, (int)$q('room', 0));
        // room_ids: 지금 들어가 있는 방 전부 (나간 방·닫힌 그룹의 방을 앱에서 지우게)
        talk_json(['ok' => true] + talk_sync($pdo, $uid, (int)$q('since', 0)) + ['room_ids' => talk_my_room_ids($pdo, $uid)]);

    case 'rooms/dm':
        $need('POST');
        $b = talk_body();
        $rid = talk_open_dm($pdo, $uid, (int)($b['user_id'] ?? 0));
        talk_json(['ok' => true, 'room' => talk_rooms_view($pdo, $uid, [$rid])[0]]);

    case 'rooms/create':
        $need('POST');
        $b = talk_body();
        $rid = talk_create_room($pdo, $uid, (int)($b['group_id'] ?? 0), (array)($b['member_ids'] ?? []), (string)($b['name'] ?? ''));
        talk_json(['ok' => true, 'room' => talk_rooms_view($pdo, $uid, [$rid])[0]]);

    case 'messages/send':
        $need('POST');
        $b = talk_body();
        talk_json(['ok' => true, 'message' => talk_send($pdo, $uid, (int)($b['room_id'] ?? 0), (string)($b['body'] ?? ''), (string)($b['client_id'] ?? ''))]);

    case 'messages/history':
        talk_json(['ok' => true, 'messages' => talk_history($pdo, $uid, (int)$q('room_id', 0), (int)$q('before', 0))]);

    case 'rooms/read':
        $need('POST');
        $b = talk_body();
        talk_mark_read($pdo, $uid, (int)($b['room_id'] ?? 0), (int)($b['last_id'] ?? 0));
        talk_json(['ok' => true]);
}

talk_fail('없는 주소예요.', 404);
