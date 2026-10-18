<?php
// 백업 내려받기 (관리 화면): 대화를 파일 하나로. 사진·영상 파일은 넣지 않음(용량), 비밀번호·로그인 정보도 넣지 않음.
//  - txt: 사람이 읽는 대화 기록 (방마다, 시각은 한국 시간)
//  - json: 표 그대로 (나중에 다른 곳으로 옮기거나 다시 넣을 때)

function talk_backup_download(PDO $pdo, string $format): never {
    @set_time_limit(300);
    $stamp = gmdate('Ymd-His', time() + 9 * 3600);
    $json = $format === 'json';
    header('Content-Type: ' . ($json ? 'application/json' : 'text/plain') . '; charset=utf-8');
    header('Content-Disposition: attachment; filename="saki-talk-backup-' . $stamp . ($json ? '.json' : '.txt') . '"');
    header('Cache-Control: no-store');
    $users = $pdo->query('SELECT id, name, nick, is_admin, disabled, created_at FROM talk_users ORDER BY id')->fetchAll();
    $groups = $pdo->query('SELECT * FROM talk_groups ORDER BY id')->fetchAll();
    $rooms = $pdo->query('SELECT id, group_id, kind, name, created_at, notice_id FROM talk_rooms ORDER BY id')->fetchAll();
    $members = $pdo->query('SELECT room_id, user_id, joined_at FROM talk_room_members ORDER BY room_id, user_id')->fetchAll();
    if ($json) {
        echo '{"app":"SAKi Talk","exported_at":', json_encode(gmdate('c')), ',"server_version":', TALK_SERVER_VERSION;
        foreach (['users' => $users, 'groups' => $groups, 'rooms' => $rooms, 'room_members' => $members] as $k => $rows) echo ',', json_encode($k), ':', json_encode($rows, JSON_UNESCAPED_UNICODE);
        $gm = $pdo->query('SELECT * FROM talk_group_members ORDER BY group_id, user_id')->fetchAll();
        echo ',"group_members":', json_encode($gm, JSON_UNESCAPED_UNICODE);
        echo ',"reactions":', json_encode($pdo->query('SELECT message_id, user_id, emoji, created_at FROM talk_reactions ORDER BY message_id')->fetchAll(), JSON_UNESCAPED_UNICODE);
        echo ',"messages":[';
        $first = true;
        talk_backup_each($pdo, 0, function (array $m) use (&$first) {
            echo $first ? '' : ',', json_encode($m, JSON_UNESCAPED_UNICODE);
            $first = false;
        });
        echo ']}';
        exit;
    }
    $name = [];
    foreach ($users as $u) $name[(int)$u['id']] = $u['nick'] ? "{$u['nick']}({$u['name']})" : $u['name'];
    $byRoom = [];
    foreach ($members as $m) $byRoom[(int)$m['room_id']][] = $name[(int)$m['user_id']] ?? '?';
    echo "SAKi Talk 대화 백업 · ", gmdate('Y-m-d H:i', time() + 9 * 3600), " (한국 시간)\n";
    echo "사진·영상 파일은 들어 있지 않아요.\n";
    foreach ($rooms as $r) {
        $rid = (int)$r['id'];
        $title = $r['name'] ?: implode(', ', $byRoom[$rid] ?? []);
        echo "\n==================== [", $r['kind'] === 'dm' ? '1:1' : '여럿', "] ", $title, " (방 ", $rid, ") ====================\n";
        echo "사람: ", implode(', ', $byRoom[$rid] ?? []), "\n\n";
        talk_backup_each($pdo, $rid, function (array $m) use ($name) {
            $at = gmdate('Y-m-d H:i', strtotime($m['created_at'] . ' UTC') + 9 * 3600);
            $who = $name[(int)$m['user_id']] ?? '나간 사람';
            $body = match ($m['kind']) {
                'photo' => '[사진]', 'video' => '[동영상]', 'deleted' => '[삭제된 메시지]',
                default => str_replace("\n", "\n    ", $m['body']),
            };
            echo $m['kind'] === 'system' ? "{$at} · {$body}\n" : "{$at} {$who}: {$body}\n";
        });
    }
    exit;
}

// 메시지를 번호 순서로 2000개씩 읽어서 하나씩 넘김 (메모리를 적게 쓰려고)
function talk_backup_each(PDO $pdo, int $roomId, callable $fn): void {
    $after = 0;
    $sql = 'SELECT id, room_id, user_id, kind, body, reply_to, created_at FROM talk_messages WHERE id > ?' . ($roomId ? ' AND room_id = ?' : '') . ' ORDER BY id LIMIT 2000';
    $st = $pdo->prepare($sql);
    do {
        $st->execute($roomId ? [$after, $roomId] : [$after]);
        $rows = $st->fetchAll();
        foreach ($rows as $m) { $fn($m); $after = (int)$m['id']; }
        flush();
    } while (count($rows) === 2000);
}
