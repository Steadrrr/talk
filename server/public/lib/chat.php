<?php
// SAKi Talk 채팅방·메시지·동기화
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_BODY_MAX = 4000;
const TALK_PAGE = 50;        // 예전 대화 한 번에 불러오는 수
const TALK_FIRST_MSGS = 30;  // 처음 동기화 때 방마다 보내는 최근 메시지 수
const TALK_SYNC_LIMIT = 500; // 동기화 한 번에 보는 변경 수 (넘으면 more=true, 앱이 곧바로 다시 부름)

// DB 시각(UTC, "Y-m-d H:i:s") → "Y-m-dTH:i:sZ" (아이폰 사파리는 가운데 빈칸이 있으면 시간을 잘못 읽을 수 있음)
function talk_iso(string $dt): string { return str_replace(' ', 'T', $dt) . 'Z'; }

function talk_event(PDO $pdo, int $roomId, string $kind, int $ref = 0): void {
    $pdo->prepare('INSERT INTO talk_events (room_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?)')->execute([$roomId, $kind, $ref, talk_now()]);
}

// 내가 들어가 있는 방 번호들 (닫힌 그룹의 방은 뺌)
function talk_my_room_ids(PDO $pdo, int $uid): array {
    $st = $pdo->prepare('SELECT r.id FROM talk_rooms r JOIN talk_room_members m ON m.room_id = r.id JOIN talk_groups g ON g.id = r.group_id
        WHERE m.user_id = ? AND g.closed = 0');
    $st->execute([$uid]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

function talk_room_member(PDO $pdo, int $uid, int $roomId): bool {
    return in_array($roomId, talk_my_room_ids($pdo, $uid), true);
}

function talk_msg_view(array $m): array {
    return ['id' => (int)$m['id'], 'room_id' => (int)$m['room_id'], 'user_id' => (int)$m['user_id'], 'kind' => $m['kind'],
        'body' => $m['body'], 'client_id' => $m['client_id'], 'at' => talk_iso($m['created_at'])];
}

// 방 요약: 이름, 사람(마지막으로 읽은 번호 포함), 마지막 메시지, 내가 안 읽은 수
function talk_rooms_view(PDO $pdo, int $uid, array $roomIds): array {
    if (!$roomIds) return [];
    $in = implode(',', array_fill(0, count($roomIds), '?'));
    $st = $pdo->prepare("SELECT id, group_id, kind, name, created_at FROM talk_rooms WHERE id IN ($in)");
    $st->execute($roomIds);
    $rooms = [];
    foreach ($st->fetchAll() as $r) {
        $rooms[(int)$r['id']] = ['id' => (int)$r['id'], 'group_id' => (int)$r['group_id'], 'kind' => $r['kind'], 'name' => $r['name'],
            'created_at' => talk_iso($r['created_at']), 'members' => [], 'last' => null, 'unread' => 0, 'muted' => 0, 'pinned' => 0];
    }
    $st = $pdo->prepare("SELECT m.room_id, m.user_id, m.last_read_id, m.muted, m.pinned, u.name, u.nick FROM talk_room_members m JOIN talk_users u ON u.id = m.user_id
        WHERE m.room_id IN ($in) ORDER BY m.joined_at, m.user_id");
    $st->execute($roomIds);
    foreach ($st->fetchAll() as $m) {
        $rid = (int)$m['room_id'];
        $rooms[$rid]['members'][] = ['id' => (int)$m['user_id'], 'name' => $m['name'], 'nick' => $m['nick'], 'last_read_id' => (int)$m['last_read_id']];
        if ((int)$m['user_id'] === $uid) { $rooms[$rid]['muted'] = (int)$m['muted']; $rooms[$rid]['pinned'] = (int)$m['pinned']; }
    }
    $st = $pdo->prepare("SELECT m.* FROM talk_messages m JOIN (SELECT room_id, MAX(id) mid FROM talk_messages WHERE room_id IN ($in) GROUP BY room_id) x ON m.id = x.mid");
    $st->execute($roomIds);
    foreach ($st->fetchAll() as $m) $rooms[(int)$m['room_id']]['last'] = talk_msg_view($m);
    $st = $pdo->prepare("SELECT m.room_id, COUNT(*) n FROM talk_messages m JOIN talk_room_members rm ON rm.room_id = m.room_id AND rm.user_id = ?
        WHERE m.room_id IN ($in) AND m.id > rm.last_read_id AND m.user_id <> ? GROUP BY m.room_id");
    $st->execute([$uid, ...$roomIds, $uid]);
    foreach ($st->fetchAll() as $r) $rooms[(int)$r['room_id']]['unread'] = (int)$r['n'];
    return array_values($rooms);
}

function talk_messages_where(PDO $pdo, string $where, array $args, int $limit): array {
    $st = $pdo->prepare("SELECT * FROM talk_messages WHERE $where ORDER BY id DESC LIMIT $limit");
    $st->execute($args);
    return array_reverse(array_map('talk_msg_view', $st->fetchAll()));
}

// ───── 동기화 ─────
// since=0: 내 방 전부 + 방마다 최근 메시지. 그 뒤로는 since 이후 바뀐 방의 요약과 새 메시지만.
function talk_sync(PDO $pdo, int $uid, int $since): array {
    $max = (int)$pdo->query('SELECT COALESCE(MAX(id), 0) FROM talk_events')->fetchColumn();
    $myRooms = talk_my_room_ids($pdo, $uid);
    if ($since > 0) {
        // 오래된 변경 기록이 정리돼서 이어 받을 수 없으면 처음부터
        $min = (int)$pdo->query('SELECT COALESCE(MIN(id), 0) FROM talk_events')->fetchColumn();
        if ($min > $since + 1) $since = 0;
    }
    if ($since <= 0 || $since > $max) {
        $msgs = [];
        foreach ($myRooms as $rid) array_push($msgs, ...talk_messages_where($pdo, 'room_id = ?', [$rid], TALK_FIRST_MSGS));
        return ['full' => true, 'groups_rev' => talk_groups_rev($pdo), 'cursor' => $max, 'more' => false, 'rooms' => talk_rooms_view($pdo, $uid, $myRooms), 'messages' => $msgs];
    }
    if (!$myRooms || $since === $max) return ['full' => false, 'groups_rev' => talk_groups_rev($pdo), 'cursor' => $max, 'more' => false, 'rooms' => [], 'messages' => []];
    $in = implode(',', array_fill(0, count($myRooms), '?'));
    $st = $pdo->prepare("SELECT id, room_id, kind, ref_id FROM talk_events WHERE id > ? AND id <= ? AND room_id IN ($in) ORDER BY id LIMIT " . TALK_SYNC_LIMIT);
    $st->execute([$since, $max, ...$myRooms]);
    $events = $st->fetchAll();
    $more = count($events) === TALK_SYNC_LIMIT;
    $cursor = $more ? (int)end($events)['id'] : $max;
    $touched = array_values(array_unique(array_map(fn($e) => (int)$e['room_id'], $events)));
    $msgIds = array_values(array_unique(array_map(fn($e) => (int)$e['ref_id'], array_filter($events, fn($e) => $e['kind'] === 'msg'))));
    $msgs = [];
    if ($msgIds) {
        $mi = implode(',', array_fill(0, count($msgIds), '?'));
        $msgs = talk_messages_where($pdo, "id IN ($mi)", $msgIds, count($msgIds));
    }
    // 방이 새로 생겼으면 그 방의 최근 메시지도 (방이 생긴 뒤 처음 받는 경우)
    foreach ($events as $e) {
        if ($e['kind'] === 'room') foreach (talk_messages_where($pdo, 'room_id = ? AND id NOT IN (' . ($msgIds ? implode(',', $msgIds) : '0') . ')', [(int)$e['room_id']], TALK_FIRST_MSGS) as $m) $msgs[] = $m;
    }
    usort($msgs, fn($a, $b) => $a['id'] <=> $b['id']);
    return ['full' => false, 'groups_rev' => talk_groups_rev($pdo), 'cursor' => $cursor, 'more' => $more, 'rooms' => talk_rooms_view($pdo, $uid, $touched), 'messages' => $msgs];
}

// ───── 방 만들기 ─────
// 1:1 방: 같은 그룹에 있는 사람과만. 이미 있으면 그 방
function talk_open_dm(PDO $pdo, int $uid, int $otherId): int {
    if ($otherId === $uid) talk_fail('나와의 1:1 방은 아직 없어요.');
    $st = $pdo->prepare('SELECT a.group_id FROM talk_group_members a JOIN talk_group_members b ON b.group_id = a.group_id JOIN talk_groups g ON g.id = a.group_id
        JOIN talk_users u ON u.id = b.user_id WHERE a.user_id = ? AND b.user_id = ? AND g.closed = 0 AND u.disabled = 0 ORDER BY a.group_id LIMIT 1');
    $st->execute([$uid, $otherId]);
    $gid = $st->fetchColumn();
    if ($gid === false) talk_fail('같은 그룹에 있는 사람과만 대화할 수 있어요.', 403);
    $key = min($uid, $otherId) . ':' . max($uid, $otherId);
    $st = $pdo->prepare('SELECT id FROM talk_rooms WHERE dm_key = ?');
    $st->execute([$key]);
    $rid = $st->fetchColumn();
    if ($rid !== false) return (int)$rid;
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO talk_rooms (group_id, kind, dm_key, created_by, created_at) VALUES (?, ?, ?, ?, ?)')->execute([(int)$gid, 'dm', $key, $uid, talk_now()]);
        $rid = (int)$pdo->lastInsertId();
        $add = $pdo->prepare('INSERT INTO talk_room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)');
        foreach ([$uid, $otherId] as $u) $add->execute([$rid, $u, talk_now()]);
        talk_event($pdo, $rid, 'room');
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        // 두 사람이 동시에 만든 경우: 먼저 생긴 방을 쓴다
        $st = $pdo->prepare('SELECT id FROM talk_rooms WHERE dm_key = ?');
        $st->execute([$key]);
        $rid = $st->fetchColumn();
        if ($rid === false) throw $e;
        return (int)$rid;
    }
    return $rid;
}

// 여럿 방: 같은 그룹 사람들로
function talk_create_room(PDO $pdo, int $uid, int $groupId, array $memberIds, string $name): int {
    if (!talk_in_group($pdo, $uid, $groupId)) talk_fail('이 그룹에 들어가 있지 않아요.', 403);
    $ids = array_values(array_unique(array_filter(array_map('intval', $memberIds), fn($i) => $i > 0 && $i !== $uid)));
    if (!$ids) talk_fail('함께할 사람을 한 명 이상 골라 주세요.');
    if (count($ids) > 50) talk_fail('사람이 너무 많아요.');
    foreach ($ids as $i) if (!talk_in_group($pdo, $i, $groupId)) talk_fail('같은 그룹 사람만 초대할 수 있어요.', 403);
    $name = trim(preg_replace('/\s+/u', ' ', $name));
    if (mb_strlen($name) > 40) talk_fail('방 이름은 40자까지예요.');
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO talk_rooms (group_id, kind, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$groupId, 'group', $name === '' ? null : $name, $uid, talk_now()]);
    $rid = (int)$pdo->lastInsertId();
    $add = $pdo->prepare('INSERT INTO talk_room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)');
    foreach ([$uid, ...$ids] as $u) $add->execute([$rid, $u, talk_now()]);
    talk_event($pdo, $rid, 'room');
    $pdo->commit();
    return $rid;
}

// ───── 메시지 ─────
function talk_send(PDO $pdo, int $uid, int $roomId, string $body, string $clientId): array {
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $body = rtrim(str_replace("\r\n", "\n", $body));
    if (trim($body) === '') talk_fail('빈 메시지는 보낼 수 없어요.');
    if (mb_strlen($body) > TALK_BODY_MAX) talk_fail('메시지는 ' . TALK_BODY_MAX . '자까지예요.');
    $clientId = preg_match('/^[A-Za-z0-9_-]{8,40}$/', $clientId) ? $clientId : null;
    // 같은 메시지를 다시 보낸 경우(연결이 끊겨 재시도): 처음 것을 돌려준다
    if ($clientId !== null) {
        $st = $pdo->prepare('SELECT * FROM talk_messages WHERE user_id = ? AND client_id = ?');
        $st->execute([$uid, $clientId]);
        if ($m = $st->fetch()) return talk_msg_view($m);
    }
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO talk_messages (room_id, user_id, kind, body, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$roomId, $uid, 'text', $body, $clientId, talk_now()]);
    $id = (int)$pdo->lastInsertId();
    $pdo->prepare('UPDATE talk_room_members SET last_read_id = ? WHERE room_id = ? AND user_id = ?')->execute([$id, $roomId, $uid]);
    talk_event($pdo, $roomId, 'msg', $id);
    $pdo->commit();
    if (function_exists('talk_push_message')) talk_after_response(fn() => talk_push_message($pdo, $roomId, $uid, $body));
    if (random_int(1, 200) === 1) talk_cleanup_events($pdo);
    $st = $pdo->prepare('SELECT * FROM talk_messages WHERE id = ?');
    $st->execute([$id]);
    return talk_msg_view($st->fetch());
}

function talk_mark_read(PDO $pdo, int $uid, int $roomId, int $lastId): void {
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $st = $pdo->prepare('SELECT COALESCE(MAX(id), 0) FROM talk_messages WHERE room_id = ? AND id <= ?');
    $st->execute([$roomId, $lastId]);
    $upto = (int)$st->fetchColumn();
    $u = $pdo->prepare('UPDATE talk_room_members SET last_read_id = ? WHERE room_id = ? AND user_id = ? AND last_read_id < ?');
    $u->execute([$upto, $roomId, $uid, $upto]);
    if ($u->rowCount() > 0) talk_event($pdo, $roomId, 'read');
}

function talk_history(PDO $pdo, int $uid, int $roomId, int $before): array {
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    return talk_messages_where($pdo, 'room_id = ? AND id < ?', [$roomId, $before > 0 ? $before : PHP_INT_MAX], TALK_PAGE);
}

// 변경 기록은 30일만 둔다 (그보다 오래 앱을 안 연 기기는 처음부터 다시 받음)
function talk_cleanup_events(PDO $pdo): void {
    $pdo->prepare('DELETE FROM talk_events WHERE created_at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 30 * 86400)]);
}
