<?php
// SAKi Talk 계정·기기·그룹·초대 코드
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0 O 1 I) 뺌
const TALK_NAME_MAX = 20;

// 관리자(처음 설정에서 만든 사람)를 메신저 사용자로도 만든다. 관리 화면 비밀번호와 같은 비밀번호로 로그인
function talk_ensure_admin(PDO $pdo, array $cfg): void {
    if ($pdo->query('SELECT COUNT(*) FROM talk_users WHERE is_admin = 1')->fetchColumn()) return;
    $pdo->prepare('INSERT IGNORE INTO talk_users (name, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)')
        ->execute([(string)$cfg['admin_name'], (string)$cfg['admin_hash'], talk_now()]);
    talk_admin_in_all_groups($pdo);
}

// 관리자는 모든 그룹에 들어가 있다 (모든 그룹 사람에게 보이고, 모두와 대화할 수 있음)
function talk_admin_in_all_groups(PDO $pdo): void {
    $pdo->prepare('INSERT IGNORE INTO talk_group_members (group_id, user_id, joined_at) SELECT g.id, u.id, ? FROM talk_groups g CROSS JOIN talk_users u WHERE u.is_admin = 1')
        ->execute([talk_now()]);
    talk_groups_changed($pdo);
}

// 관리 화면에서 한 사람의 그룹을 한꺼번에 정한다 (체크한 그룹만 남김). 관리자는 바꾸지 않음
function talk_set_user_groups(PDO $pdo, int $uid, array $groupIds): void {
    $st = $pdo->prepare('SELECT is_admin FROM talk_users WHERE id = ?');
    $st->execute([$uid]);
    $isAdmin = $st->fetchColumn();
    if ($isAdmin === false || (int)$isAdmin) return;
    $valid = array_map('intval', $pdo->query('SELECT id FROM talk_groups')->fetchAll(PDO::FETCH_COLUMN));
    $want = array_values(array_intersect($valid, array_map('intval', $groupIds)));
    $pdo->beginTransaction();
    if ($want) {
        $in = implode(',', array_fill(0, count($want), '?'));
        $pdo->prepare("DELETE FROM talk_group_members WHERE user_id = ? AND group_id NOT IN ($in)")->execute([$uid, ...$want]);
    } else {
        $pdo->prepare('DELETE FROM talk_group_members WHERE user_id = ?')->execute([$uid]);
    }
    foreach ($want as $g) talk_join_group($pdo, $uid, $g);
    talk_groups_changed($pdo);
    $pdo->commit();
}

function talk_clean_name(mixed $v): string {
    $n = trim(preg_replace('/\s+/u', ' ', (string)$v));
    if ($n === '' || mb_strlen($n) > TALK_NAME_MAX) talk_fail('이름은 1~' . TALK_NAME_MAX . '자로 해 주세요.');
    if (preg_match('/[\x00-\x1F<>]/u', $n)) talk_fail('이름에 쓸 수 없는 글자가 있어요.');
    return $n;
}

// 닉네임: 비우면 본명을 쓴다 (null)
function talk_clean_nick(mixed $v): ?string {
    $n = trim(preg_replace('/\s+/u', ' ', (string)$v));
    if ($n === '') return null;
    if (mb_strlen($n) > TALK_NAME_MAX) talk_fail('닉네임은 ' . TALK_NAME_MAX . '자까지 쓸 수 있어요.');
    if (preg_match('/[\x00-\x1F<>]/u', $n)) talk_fail('닉네임에 쓸 수 없는 글자가 있어요.');
    return $n;
}

function talk_set_nick(PDO $pdo, int $uid, ?string $nick): void {
    $pdo->prepare('UPDATE talk_users SET nick = ? WHERE id = ?')->execute([$nick, $uid]);
    talk_profile_changed($pdo, $uid);
}

// 말풍선 색: '#rrggbb' 또는 비우면 기본 (null)
function talk_set_bubble(PDO $pdo, int $uid, mixed $v): void {
    $c = strtolower(trim((string)$v));
    if ($c !== '' && !preg_match('/^#[0-9a-f]{6}$/', $c)) talk_fail('색 값이 이상해요.');
    $pdo->prepare('UPDATE talk_users SET bubble = ? WHERE id = ?')->execute([$c === '' ? null : $c, $uid]);
    talk_profile_changed($pdo, $uid);
}

// 프로필 사진: 휴대폰에서 줄인 JPEG·WebP·PNG (300KB 까지). null 이면 지움
const TALK_PHOTO_MAX = 300 * 1024;
function talk_set_photo(PDO $pdo, int $uid, ?string $data): void {
    talk_check_photo($data);
    $pdo->prepare('UPDATE talk_users SET photo = ?, photo_key = ? WHERE id = ?')
        ->execute([$data, $data === null ? null : bin2hex(random_bytes(12)), $uid]);
    talk_profile_changed($pdo, $uid);
}

function talk_check_photo(?string $data): void {
    if ($data === null) return;
    if (strlen($data) > TALK_PHOTO_MAX) talk_fail('사진이 너무 커요.');
    if (talk_photo_type($data) === null) talk_fail('사진 파일이 아니에요.');
}

// 사키 프로필 사진: 내 화면에서만 사키가 이 사진으로 보임 (다른 사람에게는 안 알림). null 이면 기본
function talk_set_saki_photo(PDO $pdo, int $uid, ?string $data): void {
    talk_check_photo($data);
    $pdo->prepare('UPDATE talk_users SET saki_photo = ?, saki_photo_key = ? WHERE id = ?')
        ->execute([$data, $data === null ? null : bin2hex(random_bytes(12)), $uid]);
}

function talk_photo_type(string $data): ?string {
    if (str_starts_with($data, "\xFF\xD8\xFF")) return 'image/jpeg';
    if (str_starts_with($data, "\x89PNG")) return 'image/png';
    if (str_starts_with($data, 'RIFF') && substr($data, 8, 4) === 'WEBP') return 'image/webp';
    return null;
}

// 닉네임·사진이 바뀌면: 같은 그룹 사람들의 앱이 친구 목록(groups_rev)과 방 목록(방마다 'room' 변경)을 다시 받게 한다
function talk_profile_changed(PDO $pdo, int $uid): void {
    $st = $pdo->prepare('SELECT room_id FROM talk_room_members WHERE user_id = ?');
    $st->execute([$uid]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $rid) talk_event($pdo, (int)$rid, 'room');
    talk_groups_changed($pdo);
}

function talk_check_new_password(mixed $v): string {
    $pw = (string)$v;
    if (mb_strlen($pw) < 6) talk_fail('비밀번호는 6자 이상으로 해 주세요.');
    if (strlen($pw) > 200) talk_fail('비밀번호가 너무 길어요.');
    return $pw;
}

// ───── 로그인 실패 막기 (15분에 IP 당 8번) ─────
function talk_login_locked(PDO $pdo): void {
    $st = $pdo->prepare('SELECT COUNT(*) FROM talk_login_fails WHERE ip = ? AND at > ?');
    $st->execute([talk_client_ip(), gmdate('Y-m-d H:i:s', time() - 900)]);
    if ((int)$st->fetchColumn() >= 8) talk_fail('여러 번 틀렸어요. 15분 뒤에 다시 시도해 주세요.', 429);
}

function talk_login_fail(PDO $pdo, string $msg): never {
    $pdo->prepare('INSERT INTO talk_login_fails (ip, at) VALUES (?, ?)')->execute([talk_client_ip(), talk_now()]);
    $pdo->prepare('DELETE FROM talk_login_fails WHERE at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 86400)]);
    talk_fail($msg, 401);
}

// ───── 기기 토큰 ─────
// 로그인: 새 토큰. 같은 기기 열쇠로 예전에 로그인한 줄은 끊는다 (다시 로그인할 때마다 기기가 쌓이지 않게)
function talk_new_device(PDO $pdo, int $uid, string $name, string $key = ''): string {
    $key = preg_match('/^[a-f0-9]{32}$/', $key) ? $key : null;
    if ($key !== null) {
        $st = $pdo->prepare('SELECT id FROM talk_devices WHERE user_id = ? AND device_key = ? AND revoked = 0');
        $st->execute([$uid, $key]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $old) talk_revoke_device($pdo, (int)$old);
    }
    talk_prune_devices($pdo);
    $token = bin2hex(random_bytes(32));
    $now = talk_now();
    $pdo->prepare('INSERT INTO talk_devices (user_id, name, token_hash, device_key, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$uid, mb_substr(trim($name) ?: '이름 없는 기기', 0, 100), hash('sha256', $token), $key, $now, $now]);
    return $token;
}

// 기기 끊기: 토큰을 못 쓰게 하고 알림 주소도 지움
function talk_revoke_device(PDO $pdo, int $deviceId): void {
    $pdo->prepare('UPDATE talk_devices SET revoked = 1 WHERE id = ?')->execute([$deviceId]);
    $pdo->prepare('DELETE FROM talk_push_subs WHERE device_id = ?')->execute([$deviceId]);
}

// 60일 넘게 안 쓴 기기는 끊음 (로그인할 때마다 한 번 정리)
function talk_prune_devices(PDO $pdo): int {
    $st = $pdo->prepare('SELECT id FROM talk_devices WHERE revoked = 0 AND last_seen < ?');
    $st->execute([gmdate('Y-m-d H:i:s', time() - 60 * 86400)]);
    $ids = $st->fetchAll(PDO::FETCH_COLUMN);
    foreach ($ids as $id) talk_revoke_device($pdo, (int)$id);
    return count($ids);
}

function talk_token_from_request(): string {
    return (string)($_SERVER['HTTP_X_TALK_TOKEN'] ?? '');
}

// 로그인한 사람 → ['id', 'name', 'nick', 'is_admin', 'device_id']
function talk_auth(PDO $pdo): array {
    $t = talk_token_from_request();
    if (!preg_match('/^[a-f0-9]{64}$/', $t)) talk_fail('로그인이 필요해요.', 401);
    $st = $pdo->prepare('SELECT d.id AS device_id, d.last_seen, d.active_at, d.active_room, u.id, u.name, u.nick, u.photo_key, u.saki_photo_key, u.bubble, u.is_admin, u.push_quiet FROM talk_devices d JOIN talk_users u ON u.id = d.user_id
        WHERE d.token_hash = ? AND d.revoked = 0 AND u.disabled = 0');
    $st->execute([hash('sha256', $t)]);
    $me = $st->fetch();
    if (!$me) talk_fail('로그인이 필요해요.', 401);
    // 마지막 사용 시각은 5분에 한 번만 적는다 (폴링마다 쓰지 않게)
    if (strtotime($me['last_seen'] . ' UTC') < time() - 300) {
        $pdo->prepare('UPDATE talk_devices SET last_seen = ? WHERE id = ?')->execute([talk_now(), $me['device_id']]);
    }
    return ['id' => (int)$me['id'], 'name' => $me['name'], 'nick' => $me['nick'], 'photo' => $me['photo_key'], 'saki_photo' => $me['saki_photo_key'], 'bubble' => $me['bubble'], 'is_admin' => (int)$me['is_admin'], 'push_quiet' => (int)$me['push_quiet'], 'device_id' => (int)$me['device_id'], 'active_at' => $me['active_at'], 'active_room' => (int)$me['active_room']];
}

// 앱에서 이 방을 보고 있음 (동기화할 때마다 부름, 방이 같으면 5초에 한 번만 적음, 0 = 목록). 앱을 숨기면 me/away 로 지움
function talk_mark_active(PDO $pdo, array $me, int $room): void {
    if ($room === $me['active_room'] && $me['active_at'] && strtotime($me['active_at'] . ' UTC') > time() - 5) return;
    $pdo->prepare('UPDATE talk_devices SET active_at = ?, active_room = ? WHERE id = ?')->execute([talk_now(), $room, $me['device_id']]);
}

// ───── 초대 코드 ─────
function talk_invite_hash(string $code): string {
    return hash('sha256', strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code)));
}

function talk_new_invite(PDO $pdo, int $groupId, int $uses, int $days): string {
    $code = '';
    for ($i = 0; $i < 8; $i++) $code .= TALK_INVITE_ALPHABET[random_int(0, strlen(TALK_INVITE_ALPHABET) - 1)];
    $pdo->prepare('INSERT INTO talk_invites (group_id, code_hash, code, uses_left, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$groupId, talk_invite_hash($code), $code, max(1, min(50, $uses)), gmdate('Y-m-d H:i:s', time() + max(1, min(90, $days)) * 86400), talk_now()]);
    return $code;
}

// 쓸 수 있는 초대 코드면 그룹 번호, 아니면 null. $use 면 남은 횟수를 하나 줄인다
function talk_invite_group(PDO $pdo, string $code, bool $use): ?int {
    $st = $pdo->prepare('SELECT i.id, i.group_id FROM talk_invites i JOIN talk_groups g ON g.id = i.group_id
        WHERE i.code_hash = ? AND i.revoked = 0 AND i.uses_left > 0 AND i.expires_at > ? AND g.closed = 0');
    $st->execute([talk_invite_hash($code), talk_now()]);
    $row = $st->fetch();
    if (!$row) return null;
    if ($use) {
        $u = $pdo->prepare('UPDATE talk_invites SET uses_left = uses_left - 1 WHERE id = ? AND uses_left > 0');
        $u->execute([$row['id']]);
        if ($u->rowCount() === 0) return null;
    }
    return (int)$row['group_id'];
}

function talk_join_group(PDO $pdo, int $uid, int $groupId): void {
    $pdo->prepare('INSERT IGNORE INTO talk_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)')->execute([$groupId, $uid, talk_now()]);
    talk_groups_changed($pdo);
}

// 그룹·사람이 바뀌면 번호를 올린다. 앱은 동기화 때 이 번호가 바뀌었으면 친구 목록을 다시 받는다
function talk_groups_changed(PDO $pdo): void {
    $pdo->exec("INSERT INTO talk_meta (k, v) VALUES ('groups_rev', '1') ON DUPLICATE KEY UPDATE v = v + 1");
}

function talk_groups_rev(PDO $pdo): int {
    return (int)(talk_meta_get($pdo, 'groups_rev') ?? 0);
}

// ───── 그룹 ─────
// 내가 속한 (닫히지 않은) 그룹과 그 사람들
function talk_my_groups(PDO $pdo, int $uid): array {
    $st = $pdo->prepare('SELECT g.id, g.name FROM talk_groups g JOIN talk_group_members m ON m.group_id = g.id WHERE m.user_id = ? AND g.closed = 0 ORDER BY g.id');
    $st->execute([$uid]);
    $groups = $st->fetchAll();
    if (!$groups) return [];
    $ids = array_column($groups, 'id');
    $in = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT m.group_id, u.id, u.name, u.nick, u.photo_key, u.bubble FROM talk_group_members m JOIN talk_users u ON u.id = m.user_id
        WHERE m.group_id IN ($in) AND u.disabled = 0 ORDER BY COALESCE(u.nick, u.name)");
    $st->execute($ids);
    $members = [];
    foreach ($st->fetchAll() as $r) $members[(int)$r['group_id']][] = ['id' => (int)$r['id'], 'name' => $r['name'], 'nick' => $r['nick'], 'photo' => $r['photo_key'], 'bubble' => $r['bubble']];
    return array_map(fn($g) => ['id' => (int)$g['id'], 'name' => $g['name'], 'members' => $members[(int)$g['id']] ?? []], $groups);
}

function talk_in_group(PDO $pdo, int $uid, int $groupId): bool {
    $st = $pdo->prepare('SELECT 1 FROM talk_group_members m JOIN talk_groups g ON g.id = m.group_id JOIN talk_users u ON u.id = m.user_id
        WHERE m.group_id = ? AND m.user_id = ? AND g.closed = 0 AND u.disabled = 0');
    $st->execute([$groupId, $uid]);
    return (bool)$st->fetchColumn();
}
