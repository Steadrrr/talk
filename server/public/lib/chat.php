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
        'body' => $m['body'], 'client_id' => $m['client_id'], 'at' => talk_iso($m['created_at']),
        'reply_to' => (int)($m['reply_to'] ?? 0) ?: null] + (empty($m['links']) ? [] : ['links' => json_decode($m['links'], true)]);
}

const TALK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

// 메시지 목록에 답장한 원래 글 미리보기(reply)와 반응(reactions: [[사람, 이모지], …])을 붙인다
function talk_decorate(PDO $pdo, array $msgs): array {
    if (!$msgs) return $msgs;
    $ids = array_map(fn($m) => $m['id'], $msgs);
    $in = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT message_id, user_id, emoji FROM talk_reactions WHERE message_id IN ($in) ORDER BY created_at");
    $st->execute($ids);
    $re = [];
    foreach ($st->fetchAll() as $r) $re[(int)$r['message_id']][] = [(int)$r['user_id'], $r['emoji']];
    $rids = array_values(array_unique(array_filter(array_map(fn($m) => $m['reply_to'], $msgs))));
    $orig = [];
    if ($rids) {
        $st = $pdo->prepare('SELECT id, user_id, kind, body FROM talk_messages WHERE id IN (' . implode(',', array_fill(0, count($rids), '?')) . ')');
        $st->execute($rids);
        foreach ($st->fetchAll() as $o) $orig[(int)$o['id']] = ['id' => (int)$o['id'], 'user_id' => (int)$o['user_id'], 'kind' => $o['kind'],
            'body' => $o['kind'] === 'text' ? mb_substr($o['body'], 0, 80) : ''];
    }
    foreach ($msgs as &$m) {
        $m['reactions'] = $re[$m['id']] ?? [];
        if ($m['reply_to']) $m['reply'] = $orig[$m['reply_to']] ?? ['id' => $m['reply_to'], 'user_id' => 0, 'kind' => 'deleted', 'body' => ''];
    }
    return $msgs;
}

// 반응 달기: 같은 이모지를 다시 누르면 뺌, 다른 것을 누르면 바꿈
function talk_react(PDO $pdo, int $uid, int $msgId, string $emoji): void {
    $st = $pdo->prepare('SELECT room_id, kind FROM talk_messages WHERE id = ?');
    $st->execute([$msgId]);
    $m = $st->fetch();
    if (!$m || !talk_room_member($pdo, $uid, (int)$m['room_id'])) talk_fail('메시지가 없어요.', 404);
    if (in_array($m['kind'], ['system', 'deleted'], true)) talk_fail('여기에는 반응을 달 수 없어요.');
    if (!in_array($emoji, TALK_REACTIONS, true)) talk_fail('고를 수 있는 반응이 아니에요.');
    $st = $pdo->prepare('SELECT emoji FROM talk_reactions WHERE message_id = ? AND user_id = ?');
    $st->execute([$msgId, $uid]);
    if ($st->fetchColumn() === $emoji) $pdo->prepare('DELETE FROM talk_reactions WHERE message_id = ? AND user_id = ?')->execute([$msgId, $uid]);
    else $pdo->prepare('REPLACE INTO talk_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')->execute([$msgId, $uid, $emoji, talk_now()]);
    talk_event($pdo, (int)$m['room_id'], 'msg', $msgId);
}

// 방 요약: 이름, 사람(마지막으로 읽은 번호 포함), 마지막 메시지, 내가 안 읽은 수
function talk_rooms_view(PDO $pdo, int $uid, array $roomIds): array {
    if (!$roomIds) return [];
    $in = implode(',', array_fill(0, count($roomIds), '?'));
    $st = $pdo->prepare("SELECT r.id, r.group_id, r.kind, r.name, r.created_at, r.created_by, r.saki, r.photo_key, r.photo_by, COALESCE(u.nick, u.name) AS photo_by_name,
            n.id AS notice_id, n.body AS notice_body, n.user_id AS notice_user, COALESCE(nb.nick, nb.name) AS notice_by_name
        FROM talk_rooms r LEFT JOIN talk_users u ON u.id = r.photo_by
        LEFT JOIN talk_messages n ON n.id = r.notice_id AND n.kind = 'text' LEFT JOIN talk_users nb ON nb.id = r.notice_by
        WHERE r.id IN ($in)");
    $st->execute($roomIds);
    $rooms = [];
    foreach ($st->fetchAll() as $r) {
        $rooms[(int)$r['id']] = ['id' => (int)$r['id'], 'group_id' => (int)$r['group_id'], 'kind' => $r['kind'], 'name' => $r['name'],
            'created_at' => talk_iso($r['created_at']), 'created_by' => (int)$r['created_by'],
            // 사키 설정 (단체방만, 열쇠가 들어 있을 때 ready)
            'saki' => $r['kind'] === 'group' && function_exists('talk_saki_settings') ? talk_saki_settings($r['saki']) + ['ready' => talk_saki_ready()] : null,
            'photo' => $r['photo_key'], 'photo_by' => $r['photo_key'] ? $r['photo_by_name'] : null, 'members' => [], 'last' => null, 'unread' => 0, 'muted' => 0, 'pinned' => 0,
            'notice' => $r['notice_id'] ? ['id' => (int)$r['notice_id'], 'body' => $r['notice_body'], 'user_id' => (int)$r['notice_user'], 'by' => $r['notice_by_name']] : null];
    }
    $st = $pdo->prepare("SELECT m.room_id, m.user_id, m.last_read_id, m.muted, m.pinned, m.saki_relation, u.name, u.nick, u.photo_key, u.bubble, u.is_bot FROM talk_room_members m JOIN talk_users u ON u.id = m.user_id
        WHERE m.room_id IN ($in) ORDER BY m.joined_at, m.user_id");
    $st->execute($roomIds);
    foreach ($st->fetchAll() as $m) {
        $rid = (int)$m['room_id'];
        $rooms[$rid]['members'][] = ['id' => (int)$m['user_id'], 'name' => $m['name'], 'nick' => $m['nick'], 'photo' => $m['photo_key'], 'bubble' => $m['bubble'], 'last_read_id' => (int)$m['last_read_id']]
            + ((int)$m['is_bot'] ? ['bot' => 1] : []) + ((string)$m['saki_relation'] !== '' ? ['relation' => $m['saki_relation']] : []);
        if ((int)$m['user_id'] === $uid) { $rooms[$rid]['muted'] = (int)$m['muted']; $rooms[$rid]['pinned'] = (int)$m['pinned']; }
    }
    $st = $pdo->prepare("SELECT m.* FROM talk_messages m JOIN (SELECT room_id, MAX(id) mid FROM talk_messages WHERE room_id IN ($in) GROUP BY room_id) x ON m.id = x.mid");
    $st->execute($roomIds);
    foreach ($st->fetchAll() as $m) $rooms[(int)$m['room_id']]['last'] = talk_msg_view($m);
    $st = $pdo->prepare("SELECT m.room_id, COUNT(*) n FROM talk_messages m JOIN talk_room_members rm ON rm.room_id = m.room_id AND rm.user_id = ?
        WHERE m.room_id IN ($in) AND m.id > rm.last_read_id AND m.user_id <> ? AND m.kind <> 'system' GROUP BY m.room_id");
    $st->execute([$uid, ...$roomIds, $uid]);
    foreach ($st->fetchAll() as $r) $rooms[(int)$r['room_id']]['unread'] = (int)$r['n'];
    return array_values($rooms);
}

function talk_messages_where(PDO $pdo, string $where, array $args, int $limit): array {
    $st = $pdo->prepare("SELECT * FROM talk_messages WHERE $where ORDER BY id DESC LIMIT $limit");
    $st->execute($args);
    return talk_decorate($pdo, array_reverse(array_map('talk_msg_view', $st->fetchAll())));
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
    if ($rid !== false) { talk_dm_rejoin($pdo, (int)$rid, [$uid]); return (int)$rid; }
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

// 1:1 방에서 나갔던 사람을 다시 넣음 (안 읽은 수는 지금부터)
function talk_dm_rejoin(PDO $pdo, int $roomId, array $userIds): void {
    $st = $pdo->prepare('SELECT COALESCE(MAX(id), 0) FROM talk_messages WHERE room_id = ?');
    $st->execute([$roomId]);
    $last = (int)$st->fetchColumn();
    $add = $pdo->prepare('INSERT IGNORE INTO talk_room_members (room_id, user_id, last_read_id, joined_at) VALUES (?, ?, ?, ?)');
    $n = 0;
    foreach ($userIds as $u) { $add->execute([$roomId, $u, $last, talk_now()]); $n += $add->rowCount(); }
    if ($n) talk_event($pdo, $roomId, 'room');
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
function talk_send(PDO $pdo, int $uid, int $roomId, string $body, string $clientId, int $replyTo = 0): array {
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $body = rtrim(str_replace("\r\n", "\n", $body));
    if (trim($body) === '') talk_fail('빈 메시지는 보낼 수 없어요.');
    if (mb_strlen($body) > TALK_BODY_MAX) talk_fail('메시지는 ' . TALK_BODY_MAX . '자까지예요.');
    $clientId = preg_match('/^[A-Za-z0-9_-]{8,40}$/', $clientId) ? $clientId : null;
    // 같은 메시지를 다시 보낸 경우(연결이 끊겨 재시도): 처음 것을 돌려준다
    if ($clientId !== null) {
        $st = $pdo->prepare('SELECT * FROM talk_messages WHERE user_id = ? AND client_id = ?');
        $st->execute([$uid, $clientId]);
        if ($m = $st->fetch()) return talk_decorate($pdo, [talk_msg_view($m)])[0];
    }
    // 답장: 같은 방의 메시지일 때만
    if ($replyTo > 0) {
        $st = $pdo->prepare('SELECT 1 FROM talk_messages WHERE id = ? AND room_id = ?');
        $st->execute([$replyTo, $roomId]);
        if (!$st->fetchColumn()) $replyTo = 0;
    }
    $st = $pdo->prepare("SELECT dm_key FROM talk_rooms WHERE id = ? AND kind = 'dm'");
    $st->execute([$roomId]);
    if ($key = $st->fetchColumn()) talk_dm_rejoin($pdo, $roomId, array_map('intval', explode(':', $key)));
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO talk_messages (room_id, user_id, kind, body, client_id, created_at, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$roomId, $uid, 'text', $body, $clientId, talk_now(), $replyTo ?: null]);
    $id = (int)$pdo->lastInsertId();
    $pdo->prepare('UPDATE talk_room_members SET last_read_id = ?, typing_at = NULL WHERE room_id = ? AND user_id = ?')->execute([$id, $roomId, $uid]);
    talk_event($pdo, $roomId, 'msg', $id);
    $pdo->commit();
    if (function_exists('talk_push_message')) talk_after_response(fn() => talk_push_message($pdo, $roomId, $uid, $body));
    // 사키를 불렀으면 (또는 끼어들 때가 됐으면) 알림 다음에 SAKi Lite 를 부른다
    if (function_exists('talk_saki_after_send')) talk_saki_after_send($pdo, $roomId, $uid, $id, $body, $replyTo);
    if (random_int(1, 200) === 1) talk_cleanup_events($pdo);
    $st = $pdo->prepare('SELECT * FROM talk_messages WHERE id = ?');
    $st->execute([$id]);
    return talk_decorate($pdo, [talk_msg_view($st->fetch())])[0];
}

// ───── 입력 중 ─────
// 앱은 입력칸에 글자가 있는 동안 3초에 한 번 on=true, 지우거나 방을 나가면 on=false. 보내면 talk_send 가 끔
const TALK_TYPING_SECONDS = 8;

function talk_set_typing(PDO $pdo, int $uid, int $roomId, bool $on): void {
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $pdo->prepare('UPDATE talk_room_members SET typing_at = ? WHERE room_id = ? AND user_id = ?')->execute([$on ? talk_now() : null, $roomId, $uid]);
}

// 이 방에서 지금 입력 중인 다른 사람들 (나는 빼고)
function talk_typing(PDO $pdo, int $uid, int $roomId): array {
    $st = $pdo->prepare('SELECT user_id FROM talk_room_members WHERE room_id = ? AND user_id <> ? AND typing_at > ? ORDER BY typing_at');
    $st->execute([$roomId, $uid, gmdate('Y-m-d H:i:s', time() - TALK_TYPING_SECONDS)]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
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

// 방 안 글 검색: 최근 것부터 50개 (글자 그대로 찾음, 대소문자 무시)
function talk_search(PDO $pdo, int $uid, int $roomId, string $q): array {
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $q = trim($q);
    if (mb_strlen($q) < 1) return [];
    $like = '%' . addcslashes(mb_substr($q, 0, 50), '%_\\') . '%';
    return talk_messages_where($pdo, "room_id = ? AND kind = 'text' AND body LIKE ?", [$roomId, $like], 50);
}

// 변경 기록은 30일만 둔다 (그보다 오래 앱을 안 연 기기는 처음부터 다시 받음)
function talk_cleanup_events(PDO $pdo): void {
    $pdo->prepare('DELETE FROM talk_events WHERE created_at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 30 * 86400)]);
}

// ───── 방 설정 ─────
// 방 안내 글 ("○○님이 나갔어요" 같은 것). 보낸 사람은 actor, 안 읽은 수·알림에는 안 셈
function talk_system_msg(PDO $pdo, int $roomId, int $actor, string $text): void {
    $pdo->prepare('INSERT INTO talk_messages (room_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$roomId, $actor, 'system', $text, talk_now()]);
    talk_event($pdo, $roomId, 'msg', (int)$pdo->lastInsertId());
}

function talk_display_name(PDO $pdo, int $uid): string {
    $st = $pdo->prepare('SELECT COALESCE(nick, name) FROM talk_users WHERE id = ?');
    $st->execute([$uid]);
    return (string)$st->fetchColumn();
}

function talk_room_row(PDO $pdo, int $uid, int $roomId): array {
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $st = $pdo->prepare('SELECT * FROM talk_rooms WHERE id = ?');
    $st->execute([$roomId]);
    return $st->fetch();
}

// 나에게만: 알림 끄기·위에 고정
function talk_room_prefs(PDO $pdo, int $uid, int $roomId, array $b): void {
    talk_room_row($pdo, $uid, $roomId);
    foreach (['muted', 'pinned'] as $k) {
        if (array_key_exists($k, $b)) $pdo->prepare("UPDATE talk_room_members SET $k = ? WHERE room_id = ? AND user_id = ?")->execute([$b[$k] ? 1 : 0, $roomId, $uid]);
    }
    talk_event($pdo, $roomId, 'room');
}

// 여럿 방 이름 (모두에게 보임, 비우면 사람 이름으로)
function talk_room_rename(PDO $pdo, int $uid, int $roomId, string $name): void {
    $room = talk_room_row($pdo, $uid, $roomId);
    if ($room['kind'] !== 'group') talk_fail('1:1 방 이름은 상대 이름으로 보여요.');
    $name = trim(preg_replace('/\s+/u', ' ', $name));
    if (mb_strlen($name) > 40) talk_fail('방 이름은 40자까지예요.');
    if (preg_match('/[\x00-\x1F<>]/u', $name)) talk_fail('방 이름에 쓸 수 없는 글자가 있어요.');
    if ($name === (string)$room['name']) return;
    $pdo->prepare('UPDATE talk_rooms SET name = ? WHERE id = ?')->execute([$name === '' ? null : $name, $roomId]);
    talk_system_msg($pdo, $roomId, $uid, talk_display_name($pdo, $uid) . ($name === '' ? '님이 방 이름을 지웠어요.' : "님이 방 이름을 \"$name\"(으)로 바꿨어요."));
    talk_event($pdo, $roomId, 'room');
}

// 여럿 방에 같은 그룹 사람 초대
function talk_room_invite(PDO $pdo, int $uid, int $roomId, array $userIds): void {
    $room = talk_room_row($pdo, $uid, $roomId);
    if ($room['kind'] !== 'group') talk_fail('1:1 방에는 초대할 수 없어요. 새 채팅방을 만들어 주세요.');
    $st = $pdo->prepare('SELECT user_id FROM talk_room_members WHERE room_id = ?');
    $st->execute([$roomId]);
    $inRoom = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
    $ids = array_values(array_diff(array_unique(array_filter(array_map('intval', $userIds), fn($i) => $i > 0)), $inRoom));
    if (!$ids) talk_fail('초대할 사람을 골라 주세요.');
    foreach ($ids as $i) if (!talk_in_group($pdo, $i, (int)$room['group_id'])) talk_fail('같은 그룹 사람만 초대할 수 있어요.', 403);
    $pdo->beginTransaction();
    $st = $pdo->prepare('SELECT COALESCE(MAX(id), 0) FROM talk_messages WHERE room_id = ?');
    $st->execute([$roomId]);
    $last = (int)$st->fetchColumn();
    $add = $pdo->prepare('INSERT IGNORE INTO talk_room_members (room_id, user_id, last_read_id, joined_at) VALUES (?, ?, ?, ?)');
    foreach ($ids as $i) $add->execute([$roomId, $i, $last, talk_now()]);
    talk_system_msg($pdo, $roomId, $uid, talk_display_name($pdo, $uid) . '님이 ' . implode(', ', array_map(fn($i) => talk_display_name($pdo, $i) . '님', $ids)) . '을 초대했어요.');
    talk_event($pdo, $roomId, 'room');
    $pdo->commit();
}

// 나가기: 여럿 방은 안내 글을 남기고 나만 빠짐 (한 명만 남으면 방을 없앰).
// 1:1 방은 두 사람 모두에게서 방을 없앰 (메시지·사진·영상도 지움. 다시 대화하면 새 방)
function talk_room_leave(PDO $pdo, array $cfg, int $uid, int $roomId): void {
    $room = talk_room_row($pdo, $uid, $roomId);
    $pdo->beginTransaction();
    if ($room['kind'] === 'dm') {
        talk_room_destroy($pdo, $cfg, $roomId);
    } else {
        $pdo->prepare('DELETE FROM talk_room_members WHERE room_id = ? AND user_id = ?')->execute([$roomId, $uid]);
        // 사람이 한 명만 남으면 (사키 봇은 세지 않음)
        $st = $pdo->prepare('SELECT COUNT(*) FROM talk_room_members m JOIN talk_users u ON u.id = m.user_id WHERE m.room_id = ? AND u.is_bot = 0');
        $st->execute([$roomId]);
        if ((int)$st->fetchColumn() <= 1) talk_room_destroy($pdo, $cfg, $roomId);
        else talk_system_msg($pdo, $roomId, $uid, talk_display_name($pdo, $uid) . '님이 나갔어요.');
    }
    talk_event($pdo, $roomId, 'room');
    $pdo->commit();
}

// 방을 통째로 없앰. 방 사람들 앱은 다음 동기화의 room_ids 에 이 방이 없으니 지운다
function talk_room_destroy(PDO $pdo, array $cfg, int $roomId): void {
    // 사진·영상: 이 방 메시지가 쓰던 것과 이 방에 올리던 것. 다른 방에 전달된 파일은 남긴다
    $st = $pdo->prepare('SELECT mkey FROM talk_media_uses WHERE room_id = ? UNION SELECT mkey FROM talk_media WHERE room_id = ? AND deleted = 0');
    $st->execute([$roomId, $roomId]);
    $keys = $st->fetchAll(PDO::FETCH_COLUMN);
    $pdo->prepare('DELETE FROM talk_media_uses WHERE room_id = ?')->execute([$roomId]);
    talk_media_release($pdo, $cfg, $keys);
    $pdo->prepare('DELETE r FROM talk_reactions r JOIN talk_messages m ON m.id = r.message_id WHERE m.room_id = ?')->execute([$roomId]);
    $pdo->prepare('DELETE FROM talk_messages WHERE room_id = ?')->execute([$roomId]);
    $pdo->prepare('DELETE FROM talk_room_members WHERE room_id = ?')->execute([$roomId]);
    $pdo->prepare('DELETE FROM talk_rooms WHERE id = ?')->execute([$roomId]);
}

// 채팅방 대표 사진: 방 사람 누구나. 새로 올리면 예전 사진은 지워짐 (null 이면 지우기)
// 공지 올리기(그 방의 글 메시지)·내리기(0): 방 사람 누구나
function talk_room_notice(PDO $pdo, int $uid, int $roomId, int $msgId): void {
    talk_room_row($pdo, $uid, $roomId);
    if ($msgId > 0) {
        $st = $pdo->prepare("SELECT 1 FROM talk_messages WHERE id = ? AND room_id = ? AND kind = 'text'");
        $st->execute([$msgId, $roomId]);
        if (!$st->fetchColumn()) talk_fail('글 메시지만 공지로 올릴 수 있어요.');
    }
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE talk_rooms SET notice_id = ?, notice_by = ? WHERE id = ?')->execute([$msgId ?: null, $msgId ? $uid : null, $roomId]);
    talk_system_msg($pdo, $roomId, $uid, talk_display_name($pdo, $uid) . ($msgId ? '님이 공지를 올렸어요.' : '님이 공지를 내렸어요.'));
    talk_event($pdo, $roomId, 'room');
    $pdo->commit();
}

function talk_room_photo(PDO $pdo, int $uid, int $roomId, ?string $data): void {
    talk_room_row($pdo, $uid, $roomId);
    if ($data !== null) {
        if (strlen($data) > TALK_PHOTO_MAX) talk_fail('사진이 너무 커요.');
        if (talk_photo_type($data) === null) talk_fail('사진 파일이 아니에요.');
    }
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE talk_rooms SET photo = ?, photo_key = ?, photo_by = ? WHERE id = ?')
        ->execute([$data, $data === null ? null : bin2hex(random_bytes(12)), $data === null ? null : $uid, $roomId]);
    talk_system_msg($pdo, $roomId, $uid, talk_display_name($pdo, $uid) . ($data === null ? '님이 채팅방 사진을 지웠어요.' : '님이 채팅방 사진을 바꿨어요.'));
    talk_event($pdo, $roomId, 'room');
    $pdo->commit();
}
