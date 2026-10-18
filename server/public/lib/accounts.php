<?php
// S.A.K.I Talk 계정·기기·그룹·초대 코드
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0 O 1 I) 뺌
const TALK_NAME_MAX = 20;

// 관리자(처음 설정에서 만든 사람)를 메신저 사용자로도 만든다. 관리 화면 비밀번호와 같은 비밀번호로 로그인
function talk_ensure_admin(PDO $pdo, array $cfg): void {
    if ($pdo->query('SELECT COUNT(*) FROM talk_users WHERE is_admin = 1')->fetchColumn()) return;
    $pdo->prepare('INSERT IGNORE INTO talk_users (name, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)')
        ->execute([(string)$cfg['admin_name'], (string)$cfg['admin_hash'], talk_now()]);
}

function talk_clean_name(mixed $v): string {
    $n = trim(preg_replace('/\s+/u', ' ', (string)$v));
    if ($n === '' || mb_strlen($n) > TALK_NAME_MAX) talk_fail('이름은 1~' . TALK_NAME_MAX . '자로 해 주세요.');
    if (preg_match('/[\x00-\x1F<>]/u', $n)) talk_fail('이름에 쓸 수 없는 글자가 있어요.');
    return $n;
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
function talk_new_device(PDO $pdo, int $uid, string $name): string {
    $token = bin2hex(random_bytes(32));
    $now = talk_now();
    $pdo->prepare('INSERT INTO talk_devices (user_id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
        ->execute([$uid, mb_substr(trim($name) ?: '이름 없는 기기', 0, 100), hash('sha256', $token), $now, $now]);
    return $token;
}

function talk_token_from_request(): string {
    return (string)($_SERVER['HTTP_X_TALK_TOKEN'] ?? '');
}

// 로그인한 사람 → ['id', 'name', 'is_admin', 'device_id']
function talk_auth(PDO $pdo): array {
    $t = talk_token_from_request();
    if (!preg_match('/^[a-f0-9]{64}$/', $t)) talk_fail('로그인이 필요해요.', 401);
    $st = $pdo->prepare('SELECT d.id AS device_id, d.last_seen, u.id, u.name, u.is_admin FROM talk_devices d JOIN talk_users u ON u.id = d.user_id
        WHERE d.token_hash = ? AND d.revoked = 0 AND u.disabled = 0');
    $st->execute([hash('sha256', $t)]);
    $me = $st->fetch();
    if (!$me) talk_fail('로그인이 필요해요.', 401);
    // 마지막 사용 시각은 5분에 한 번만 적는다 (폴링마다 쓰지 않게)
    if (strtotime($me['last_seen'] . ' UTC') < time() - 300) {
        $pdo->prepare('UPDATE talk_devices SET last_seen = ? WHERE id = ?')->execute([talk_now(), $me['device_id']]);
    }
    return ['id' => (int)$me['id'], 'name' => $me['name'], 'is_admin' => (int)$me['is_admin'], 'device_id' => (int)$me['device_id']];
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
    $st = $pdo->prepare("SELECT m.group_id, u.id, u.name FROM talk_group_members m JOIN talk_users u ON u.id = m.user_id
        WHERE m.group_id IN ($in) AND u.disabled = 0 ORDER BY u.name");
    $st->execute($ids);
    $members = [];
    foreach ($st->fetchAll() as $r) $members[(int)$r['group_id']][] = ['id' => (int)$r['id'], 'name' => $r['name']];
    return array_map(fn($g) => ['id' => (int)$g['id'], 'name' => $g['name'], 'members' => $members[(int)$g['id']] ?? []], $groups);
}

function talk_in_group(PDO $pdo, int $uid, int $groupId): bool {
    $st = $pdo->prepare('SELECT 1 FROM talk_group_members m JOIN talk_groups g ON g.id = m.group_id JOIN talk_users u ON u.id = m.user_id
        WHERE m.group_id = ? AND m.user_id = ? AND g.closed = 0 AND u.disabled = 0');
    $st->execute([$groupId, $uid]);
    return (bool)$st->fetchColumn();
}
