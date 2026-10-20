<?php
// 한 번 쓰는 읽기 전용 집계: 사키 방별 메시지 수·부르기 수 (최근 7일, KST). 올린 뒤 바로 지운다.
declare(strict_types=1);
define('TALK', true);
require __DIR__ . '/lib/core.php';
if (!hash_equals('__TOKEN__', (string)($_GET['t'] ?? ''))) { http_response_code(404); exit; }
header('Content-Type: application/json; charset=utf-8');
$pdo = talk_db(talk_config());
$pdo->exec('SET SESSION TRANSACTION READ ONLY');
$bot = (int)$pdo->query('SELECT id FROM talk_users WHERE is_bot = 1 ORDER BY id LIMIT 1')->fetchColumn();
$st = $pdo->prepare('SELECT COALESCE(NULLIF(nick, \'\'), name) FROM talk_users WHERE id = ?');
$st->execute([$bot]);
$botName = (string)$st->fetchColumn();
$todayKst = gmdate('Y-m-d', time() + 9 * 3600);
$days = [];
for ($i = 7; $i >= 1; $i--) $days[] = gmdate('Y-m-d', strtotime("$todayKst UTC") - $i * 86400);
$from = gmdate('Y-m-d H:i:s', strtotime("{$days[0]} 00:00:00 UTC") - 9 * 3600);
$to = gmdate('Y-m-d H:i:s', strtotime("$todayKst 00:00:00 UTC") - 9 * 3600);
$rooms = [];
foreach ($pdo->query("SELECT r.id, r.name, r.saki, (SELECT COUNT(*) FROM talk_room_members m WHERE m.room_id = r.id) members,
        (SELECT COUNT(*) FROM talk_room_members m WHERE m.room_id = r.id AND m.user_id = $bot) bot_in
        FROM talk_rooms r WHERE r.kind = 'group' ORDER BY r.id")->fetchAll() as $r) {
    $s = json_decode((string)$r['saki'], true) ?: [];
    if (empty($s['on']) && !(int)$r['bot_in']) continue;
    $per = array_fill_keys($days, ['msgs' => 0, 'calls' => 0, 'saki_msgs' => 0]);
    $q = $pdo->prepare("SELECT m.user_id, m.kind, m.body, m.created_at, p.user_id reply_user FROM talk_messages m
        LEFT JOIN talk_messages p ON p.id = m.reply_to WHERE m.room_id = ? AND m.created_at >= ? AND m.created_at < ? AND m.kind <> 'system'");
    $q->execute([(int)$r['id'], $from, $to]);
    foreach ($q->fetchAll() as $m) {
        $d = gmdate('Y-m-d', strtotime($m['created_at'] . ' UTC') + 9 * 3600);
        if (!isset($per[$d])) continue;
        if ((int)$m['user_id'] === $bot) { $per[$d]['saki_msgs']++; continue; }
        $per[$d]['msgs']++;
        $b = (string)$m['body'];
        if (mb_stripos($b, '사키') !== false || ($botName !== '' && mb_stripos($b, $botName) !== false) || (int)$m['reply_user'] === $bot) $per[$d]['calls']++;
    }
    $rooms[] = ['id' => (int)$r['id'], 'name' => $r['name'], 'members' => (int)$r['members'], 'saki_on' => !empty($s['on']), 'bot_in' => (bool)(int)$r['bot_in'],
        'freq' => $s['freq'] ?? 'called', 'days' => $per];
}
echo json_encode(['bot' => $bot, 'bot_name' => $botName, 'days' => $days, 'rooms' => $rooms], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
