<?php
// SAKi Lite 연동: 단체방의 "사키" 봇.
// 누가 사키를 부르면(또는 "가끔 끼어들기" 방에서 대화가 쌓이면) 그 방의 최근 대화를 SAKI 서버의 Lite 에 보내 답을 받아 봇 메시지로 올린다.
//  - 두뇌·비용·말투는 SAKI 쪽. 여기서는 언제 부를지(방 설정)와 받은 답을 어떻게 올릴지만 정한다
//  - 열쇠(설정 파일의 saki_lite_key)는 서버에서 서버로만 보낸다. 앱·응답·로그·관리 화면에 열쇠를 내보내지 않는다 (관리 화면은 끝 4자만)
//  - 사람 메시지 응답을 먼저 돌려준 뒤(talk_after_response) 부른다: 검색이 들어가면 답까지 5~20초
//  - SAKI 쪽 파일·표(/www/saki/, saki_)는 건드리지 않는다. 오가는 것은 HTTP 요청뿐
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_SAKI_URL = 'https://mysaki.mycafe24.com/saki/api.php/';
const TALK_SAKI_PERSONALITIES = ['calm' => '차분', 'lively' => '활발', 'quiet' => '조용', 'tsundere' => '츤데레'];
// 방 설정 기본값: 끔, 활발, 반말, 부를 때만, 끼어들기 최소 간격 10분, 반응 달기 켬
const TALK_SAKI_DEFAULTS = ['on' => 0, 'personality' => 'lively', 'polite' => 0, 'freq' => 'called', 'gap' => 10, 'react' => 1];
const TALK_SAKI_CONTEXT = 30;      // Lite 에 보내는 최근 메시지 수 (Lite 가 받는 최대 30개, 글은 모두 합쳐 약 6000자까지만 읽음)
const TALK_SAKI_BUSY_SECONDS = 60; // 한 방에 동시에 하나만: 부르는 중 표시가 이보다 오래되면 무효
const TALK_SAKI_SUMMARY_MAX = 300;      // 하루 요약 때 보내는 메시지 수 (Lite 가 summary 때 받는 최대)
const TALK_SAKI_SUMMARY_CHARS = 30000;  // 하루 요약 때 글 합계 (넘는 앞부분은 버림)
const TALK_SAKI_SUMMARY_MIN = 30;       // 오늘 대화가 이보다 적으면 최근 24시간으로
const TALK_SAKI_RELATION_MAX = 40;      // 사키에게 알려 줄 관계: 사람마다
const TALK_SAKI_MEMBERS_CHARS = 500;    // 관계: 방 전체 합계

// 사키가 앱 사용법을 물으면 참고하는 SAKi Talk 기능 설명 (1500자 안쪽, 일반 글). 기능이 바뀌면 같이 고친다.
// 사키 자신과 Project S.A.K.I 소개는 SAKI 쪽 프롬프트에 들어 있다
const TALK_SAKI_APP = 'SAKi Talk: 가족·친구 10명 안쪽이 쓰는 광고 없는 메신저 웹앱. 홈 화면에 추가해 앱처럼 씀. '
    . '그룹(가족·친구 등)마다 초대 코드로 가입하고 같은 그룹 사람끼리만 보임. 한 사람이 여러 그룹에 있을 수 있음. '
    . '친구 프로필의 1:1 대화, 채팅 탭의 + (새 채팅방)에서 한 명을 고르면 1:1, 여러 명이면 단체방. '
    . '글·사진(14일 보관)·영상(3일 보관, 60초까지) 보내기. 사진·영상은 휴대폰에서 줄여서 올림. '
    . '사진을 여러 장 고르면 한 묶음(30장까지)으로 가서 채팅에 콜라주와 장수가 보이고, 누르면 좌우로 넘겨 봄(위에 현재장/총장수). 방 설정(☰) 맨 위 "채팅방 사진 보기"에서 이 방 사진을 격자로 모아 보고 눌러 크게·좌우로 넘김. '
    . '메시지를 길게 누르면 반응·답장·복사·전달·공지로 올리기·삭제. 전달은 같은 그룹의 채팅방이나 친구 이름으로만(다른 그룹으로는 안 됨), 크게 본 사진을 길게 눌러 그 한 장만 전달·저장도 됨. 방 안 검색, 입력 중 표시, 메시지 옆 읽지 않은 사람 수. '
    . '웹 푸시 알림: 방마다 알림 끄기, 설정 탭의 "정신병 방지(연속알림 차단)"를 켜면 한 방에 1분 안에 3개 이상 몰아서 올라올 때부터 조용히 받음. '
    . '방 설정에서 방 사진·이름 바꾸기·친구 초대·나가기, 프로필에서 사진·닉네임 바꾸기. 설정 탭 "채팅방 꾸미기"에서 내 말풍선 색(다른 사람 화면에도 그 색으로 보임, 보는 사람이 "친구가 정한 색으로 보기"를 끄면 자기가 고른 상대 말풍선 색), 배경 색·배경화면 사진(기기마다). 채팅 목록 맨 위에 공지사항(바뀐 점). 새 버전은 저절로 새로고침. '
    . '사키: 단체방 설정에서 방장·관리자가 초대하고 성격(차분·활발·조용·츤데레)·존댓말·대답 빈도(부를 때만/가끔 끼어들기)·반응 달기를 정함. '
    . '방 사람마다 "사키에게 알려 줄 관계"를 적을 수 있음. 글에 "사키"를 넣거나 사키 말에 답장하면 대답함. '
    . '"사키야 오늘 무슨 얘기 했어?"처럼 요약·정리를 부탁하면 오늘 대화를 요약함. "사키야 매뉴얼 보여줘"면 사용법 페이지 링크. '
    . '사키는 하루 쓸 수 있는 양이 정해져 있어 다 쓰면 그날은 쉼. 관리자는 일래.';

// 자동 검증용: php -S 를 띄울 때만 주는 환경 변수 (가짜 Lite 서버 주소, http 허용)
function talk_saki_test_url(): string { return (string)getenv('TALK_SAKI_TEST_URL'); }
function talk_saki_base(): string { return talk_saki_test_url() ?: TALK_SAKI_URL; }

// 열쇠가 들어 있어 사키를 쓸 수 있는지 (방 설정 화면에 사키 칸을 보일지)
function talk_saki_ready(): bool {
    static $ready = null;
    return $ready ??= ((string)(talk_config()['saki_lite_key'] ?? '')) !== '';
}

// 열쇠를 넣거나 지우면 모든 단체방 정보를 다시 내려보낸다 (앱이 방마다 사키 칸을 보일지 다시 정하게)
function talk_saki_rooms_changed(PDO $pdo): void {
    foreach ($pdo->query("SELECT id FROM talk_rooms WHERE kind = 'group'")->fetchAll(PDO::FETCH_COLUMN) as $rid) talk_event($pdo, (int)$rid, 'room');
}

function talk_saki_settings(?string $json): array {
    $s = json_decode((string)$json, true);
    $s = (is_array($s) ? array_intersect_key($s, TALK_SAKI_DEFAULTS) : []) + TALK_SAKI_DEFAULTS;
    return [
        'on' => $s['on'] ? 1 : 0,
        'personality' => isset(TALK_SAKI_PERSONALITIES[$s['personality']]) ? $s['personality'] : TALK_SAKI_DEFAULTS['personality'],
        'polite' => $s['polite'] ? 1 : 0,
        'freq' => $s['freq'] === 'chime' ? 'chime' : 'called',
        'gap' => max(5, min(120, (int)$s['gap'])),
        'react' => $s['react'] ? 1 : 0,
    ];
}

// 봇 사용자: 로그인 불가(비밀번호 없음·기기 없음), 그룹 친구 목록에는 안 나오고 "사키 초대"를 켠 방에만 멤버로 들어간다
function talk_saki_bot(PDO $pdo): int {
    static $id = null;
    if ($id !== null) return $id;
    $v = $pdo->query('SELECT id FROM talk_users WHERE is_bot = 1 ORDER BY id LIMIT 1')->fetchColumn();
    if ($v !== false) return $id = (int)$v;
    // 이름(로그인 아이디)은 서버 전체에서 하나라, 이미 "사키"라는 사람이 있으면 다른 이름으로 (채팅에 보이는 닉네임은 "사키")
    $st = $pdo->prepare('SELECT 1 FROM talk_users WHERE name = ?');
    $st->execute(['사키']);
    $name = $st->fetchColumn() ? '사키봇' . random_int(100, 999) : '사키';
    // 프로필 사진: SAKi 핑크 아이콘 (웹앱 빌드에 들어 있는 것)
    $photo = @file_get_contents(dirname(__DIR__) . '/icon-192.png');
    $photo = is_string($photo) && strlen($photo) <= TALK_PHOTO_MAX && talk_photo_type($photo) ? $photo : null;
    $pdo->prepare('INSERT INTO talk_users (name, nick, password_hash, is_bot, created_at, photo, photo_key) VALUES (?, ?, ?, 1, ?, ?, ?)')
        ->execute([$name, '사키', '!', talk_now(), $photo, $photo === null ? null : bin2hex(random_bytes(12))]);
    return $id = (int)$pdo->lastInsertId();
}

// 방 설정 바꾸기 (방장·관리자만, 단체방만). 초대를 켜면 봇이 방에 들어가고, 끄면 나간다
function talk_saki_set(PDO $pdo, array $me, int $roomId, array $b): array {
    $room = talk_room_row($pdo, $me['id'], $roomId);
    if ($room['kind'] !== 'group') talk_fail('사키는 단체방에만 부를 수 있어요.');
    $manager = (int)$room['created_by'] === $me['id'] || $me['is_admin'];
    $old = talk_saki_settings($room['saki']);
    // 사키에게 알려 줄 관계: 내 것은 내가, 다른 사람 것은 방장·관리자가
    if (array_key_exists('relation', $b)) {
        $who = (int)($b['relation_user'] ?? $me['id']);
        if ($who !== $me['id'] && !$manager) talk_fail('다른 사람의 관계는 방장이나 관리자만 적을 수 있어요.', 403);
        $text = mb_substr(trim(preg_replace('/[\x00-\x1F\x7F\[\]<>]+/u', ' ', (string)$b['relation'])), 0, TALK_SAKI_RELATION_MAX);
        $st = $pdo->prepare('UPDATE talk_room_members m JOIN talk_users u ON u.id = m.user_id SET m.saki_relation = ? WHERE m.room_id = ? AND m.user_id = ? AND u.is_bot = 0');
        $st->execute([$text === '' ? null : $text, $roomId, $who]);
        talk_event($pdo, $roomId, 'room');
        if (!array_intersect_key($b, TALK_SAKI_DEFAULTS)) return $old;
    }
    if (!$manager) talk_fail('사키 설정은 방장이나 관리자만 바꿀 수 있어요.', 403);
    $new = $old;
    if (array_key_exists('on', $b)) $new['on'] = $b['on'] ? 1 : 0;
    if (array_key_exists('personality', $b)) {
        if (!isset(TALK_SAKI_PERSONALITIES[$b['personality']])) talk_fail('고를 수 있는 성격이 아니에요.');
        $new['personality'] = $b['personality'];
    }
    if (array_key_exists('freq', $b)) {
        if (!in_array($b['freq'], ['called', 'chime'], true)) talk_fail('대답 빈도를 다시 골라 주세요.');
        $new['freq'] = $b['freq'];
    }
    if (array_key_exists('gap', $b)) $new['gap'] = max(5, min(120, (int)$b['gap']));
    foreach (['polite', 'react'] as $k) if (array_key_exists($k, $b)) $new[$k] = $b[$k] ? 1 : 0;
    if ($new['on'] && !$old['on'] && !talk_saki_ready()) talk_fail('아직 사키를 부를 수 없어요. 관리자가 관리 화면에 SAKi Lite 열쇠를 넣어야 해요.', 503);
    $bot = talk_saki_bot($pdo);
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE talk_rooms SET saki = ? WHERE id = ?')->execute([json_encode($new), $roomId]);
    if ($new['on'] !== $old['on']) {
        if ($new['on']) {
            $st = $pdo->prepare('SELECT COALESCE(MAX(id), 0) FROM talk_messages WHERE room_id = ?');
            $st->execute([$roomId]);
            $pdo->prepare('INSERT IGNORE INTO talk_room_members (room_id, user_id, last_read_id, joined_at) VALUES (?, ?, ?, ?)')->execute([$roomId, $bot, (int)$st->fetchColumn(), talk_now()]);
            talk_system_msg($pdo, $roomId, $me['id'], '사키가 들어왔어요.');
        } else {
            $pdo->prepare('DELETE FROM talk_room_members WHERE room_id = ? AND user_id = ?')->execute([$roomId, $bot]);
            talk_system_msg($pdo, $roomId, $me['id'], '사키가 나갔어요.');
        }
    }
    talk_event($pdo, $roomId, 'room');
    $pdo->commit();
    return $new;
}

// 사키를 불렀는지: 글에 "사키"(또는 봇 닉네임)가 들어 있음. "@사키", "사키야", "사키씨" 도 모두 포함
function talk_saki_called(string $body, string $botName): bool {
    return mb_stripos($body, '사키') !== false || ($botName !== '' && mb_stripos($body, $botName) !== false);
}

// 사용법(매뉴얼)을 보여 달라는 말인지
function talk_saki_wants_manual(string $body): bool {
    return (bool)preg_match('/매뉴얼|메뉴얼|사용법|설명서|도움말|manual/iu', $body);
}

// 하루 요약을 부탁하는 말인지
function talk_saki_wants_summary(string $body): bool {
    return (bool)preg_match('/요약|정리|무슨\s*(얘기|이야기)/u', $body);
}

// 사용법 페이지 주소 (이 서버의 /talk/manual/)
function talk_saki_manual_url(): string {
    $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'mysaki.mycafe24.com'));
    $dir = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/talk/api.php'))), '/');
    return "https://$host$dir/manual/";
}

// 링크와 같이 올릴 한 줄: 방 설정의 성격·존댓말에 맞춰
function talk_saki_manual_text(array $s): string {
    $lines = [
        'calm' => ['SAKi Talk 사용법이야. 천천히 읽어 봐.', 'SAKi Talk 사용법이에요. 천천히 읽어 보세요.'],
        'lively' => ['짠! SAKi Talk 사용법 가져왔어!', '짠! SAKi Talk 사용법 가져왔어요!'],
        'quiet' => ['…사용법, 여기.', '…사용법, 여기 있어요.'],
        'tsundere' => ['흥, 이번만 알려 주는 거야. 사용법은 여기.', '흥, 이번만 알려 드리는 거예요. 사용법은 여기요.'],
    ];
    return $lines[$s['personality']][$s['polite'] ? 1 : 0] ?? $lines['lively'][0];
}

// 사람이 메시지를 보낸 직후 (talk_send): 부를 조건이면 응답을 돌려준 뒤 Lite 를 부르게 걸어 둔다
function talk_saki_after_send(PDO $pdo, int $roomId, int $uid, int $msgId, string $body, int $replyTo): void {
    $st = $pdo->prepare('SELECT kind, name, saki FROM talk_rooms WHERE id = ?');
    $st->execute([$roomId]);
    $room = $st->fetch();
    if (!$room || $room['kind'] !== 'group') return;
    $s = talk_saki_settings($room['saki']);
    if (!$s['on']) return;
    $bot = talk_saki_bot($pdo);
    if ($uid === $bot) return; // 봇 메시지는 절대 다시 부르기를 일으키지 않는다
    $called = talk_saki_called($body, talk_display_name($pdo, $bot));
    if (!$called && $replyTo > 0) {
        $st = $pdo->prepare('SELECT user_id FROM talk_messages WHERE id = ?');
        $st->execute([$replyTo]);
        $called = (int)$st->fetchColumn() === $bot;
    }
    // "사키야 매뉴얼 보여줘": Lite 를 부르지 않고 바로 사용법 페이지 링크 (돈 안 듦)
    if ($called && talk_saki_wants_manual($body)) {
        $text = talk_saki_manual_text($s);
        $url = talk_saki_manual_url();
        talk_after_response(fn() => talk_saki_post($pdo, $roomId, $bot, $msgId, $text, [['kind' => 'page', 'title' => 'SAKi Talk 사용법', 'url' => $url]], ''));
        return;
    }
    // "사키야 오늘 무슨 얘기 했어?", "사키 정리해 줘": 하루 요약
    $mode = $called ? (talk_saki_wants_summary($body) ? 'summary' : 'called') : ($s['freq'] === 'chime' ? 'chime' : '');
    if ($mode === '') return;
    $cfg = talk_config();
    if ((string)($cfg['saki_lite_key'] ?? '') === '') return;
    talk_after_response(fn() => talk_saki_run($pdo, $cfg, $roomId, $bot, $msgId, $mode, $s, (string)$room['name']));
}

// 조용할 때 대답 ("가끔 끼어들기" 방): 사람이 글을 올리고 5분 동안 아무도 말이 없으면 그 대화를 보고 한 번 대답한다.
// cron 이 없어서, 방 사람 누군가의 앱이 동기화할 때(응답 뒤) 살핀다. 앱이 모두 닫혀 있었으면 다음에 누가 열 때 (1시간 지난 글은 안 함)
const TALK_SAKI_QUIET_SECONDS = 300;
const TALK_SAKI_QUIET_MAX = 3600;

function talk_saki_quiet_check(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("SELECT r.id, r.name, r.saki FROM talk_rooms r JOIN talk_room_members m ON m.room_id = r.id AND m.user_id = ?
        WHERE r.kind = 'group' AND r.saki LIKE '%\"freq\":\"chime\"%'");
    $st->execute([$uid]);
    $rooms = array_filter($st->fetchAll(), fn($r) => talk_saki_settings($r['saki'])['on'] && talk_saki_settings($r['saki'])['freq'] === 'chime');
    if (!$rooms) return;
    $cfg = talk_config();
    if ((string)($cfg['saki_lite_key'] ?? '') === '') return;
    $bot = talk_saki_bot($pdo);
    foreach ($rooms as $r) {
        $rid = (int)$r['id'];
        $st = $pdo->prepare("SELECT id, user_id, created_at FROM talk_messages WHERE room_id = ? AND kind IN ('text', 'photo', 'video') ORDER BY id DESC LIMIT 1");
        $st->execute([$rid]);
        $last = $st->fetch();
        if (!$last || (int)$last['user_id'] === $bot) continue; // 마지막이 사키 말이면 이미 대답함
        $age = time() - strtotime($last['created_at'] . ' UTC');
        if ($age < TALK_SAKI_QUIET_SECONDS || $age > TALK_SAKI_QUIET_MAX) continue;
        if ((int)talk_meta_get($pdo, "saki_quiet:$rid") >= (int)$last['id']) continue; // 이 글에는 이미 한 번 해 봄
        talk_meta_set($pdo, "saki_quiet:$rid", (string)$last['id']);
        // 대답을 바라는 경우라 called 로 (chime 은 대부분 pass)
        talk_after_response(fn() => talk_saki_run($pdo, $cfg, $rid, $bot, (int)$last['id'], 'called', talk_saki_settings($r['saki']), (string)$r['name']));
        return; // 한 번에 한 방만
    }
}

// 오늘 (한국 날짜)
function talk_saki_day(): string { return gmdate('Y-m-d', time() + 9 * 3600); }

// 한 방에 동시에 하나만: 부르는 중 표시 잡기 (60초 지난 표시는 무효). 이미 부르는 중이면 false
function talk_saki_lock(PDO $pdo, int $roomId): bool {
    $now = time();
    $st = $pdo->prepare('INSERT INTO talk_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = IF(CAST(v AS UNSIGNED) < ?, VALUES(v), v)');
    $st->execute(["saki_busy:$roomId", (string)$now, $now - TALK_SAKI_BUSY_SECONDS]);
    return $st->rowCount() > 0;
}

// 끼어들기 조건: 사키가 마지막으로 말한 지(또는 마지막으로 끼어들기를 물어본 지) 최소 간격이 지났고, 그 뒤로 사람 메시지가 3개 이상
function talk_saki_chime_due(PDO $pdo, int $roomId, int $bot, int $gapMin): bool {
    $st = $pdo->prepare("SELECT id, created_at FROM talk_messages WHERE room_id = ? AND user_id = ? AND kind = 'text' ORDER BY id DESC LIMIT 1");
    $st->execute([$roomId, $bot]);
    $lastBot = $st->fetch() ?: ['id' => 0, 'created_at' => null];
    $last = max($lastBot['created_at'] ? strtotime($lastBot['created_at'] . ' UTC') : 0, (int)talk_meta_get($pdo, "saki_chime:$roomId"));
    if ($last > time() - $gapMin * 60) return false;
    $st = $pdo->prepare("SELECT COUNT(*) FROM talk_messages WHERE room_id = ? AND id > ? AND user_id <> ? AND kind IN ('text', 'photo', 'video') AND created_at >= ?");
    $st->execute([$roomId, (int)$lastBot['id'], $bot, gmdate('Y-m-d H:i:s', $last)]);
    return (int)$st->fetchColumn() >= 3;
}

// Lite 에 보낼 대화: 오래된 것 → 최근, 사진·영상은 "(사진)"·"(영상)", 지운 것·안내 글은 뺌, 이름은 닉네임만, 보낸 시각(한국 HH:MM)
//  - 보통: 최근 30개
//  - 하루 요약: 오늘(한국 0시부터) 대화, 적으면 최근 24시간. 300개·글 합계 30000자까지 (넘으면 앞부분을 버림)
// → [메시지들, 요약 기간 이름]
function talk_saki_context(PDO $pdo, int $roomId, int $bot, bool $summary = false): array {
    $sql = "SELECT m.user_id, m.kind, m.body, m.created_at, COALESCE(u.nick, u.name) AS who FROM talk_messages m LEFT JOIN talk_users u ON u.id = m.user_id
        WHERE m.room_id = ? AND m.kind IN ('text', 'photo', 'video')";
    $range = '';
    if ($summary) {
        $day = talk_saki_day();
        $dayStart = gmdate('Y-m-d H:i:s', strtotime("$day 00:00:00 UTC") - 9 * 3600);
        $st = $pdo->prepare("SELECT COUNT(*) FROM talk_messages WHERE room_id = ? AND kind IN ('text', 'photo', 'video') AND created_at >= ?");
        $st->execute([$roomId, $dayStart]);
        if ((int)$st->fetchColumn() >= TALK_SAKI_SUMMARY_MIN) {
            $since = $dayStart;
            $range = sprintf('오늘 (%d월 %d일)', (int)substr($day, 5, 2), (int)substr($day, 8, 2));
        } else {
            $since = gmdate('Y-m-d H:i:s', time() - 86400);
            $range = '최근 24시간';
        }
        $st = $pdo->prepare("$sql AND m.created_at >= ? ORDER BY m.id DESC LIMIT " . TALK_SAKI_SUMMARY_MAX);
        $st->execute([$roomId, $since]);
    } else {
        $st = $pdo->prepare("$sql ORDER BY m.id DESC LIMIT " . TALK_SAKI_CONTEXT);
        $st->execute([$roomId]);
    }
    $out = [];
    $chars = 0;
    foreach ($st->fetchAll() as $m) { // 최근 → 오래된 순서로 담고 나중에 뒤집음
        $text = $m['kind'] === 'photo' ? '(사진)' : ($m['kind'] === 'video' ? '(영상)' : mb_substr((string)$m['body'], 0, 600));
        if ($summary && $out && ($chars += mb_strlen($text)) > TALK_SAKI_SUMMARY_CHARS) break;
        $one = ['name' => mb_substr((string)($m['who'] ?? '나간 사람'), 0, 20) ?: '나간 사람', 'text' => $text,
            'at' => gmdate('H:i', strtotime($m['created_at'] . ' UTC') + 9 * 3600)];
        if ((int)$m['user_id'] === $bot) $one['bot'] = true;
        $out[] = $one;
    }
    $out = array_reverse($out);
    // 마지막은 사람의 메시지여야 한다
    while ($out && !empty(end($out)['bot'])) array_pop($out);
    return [$out, $range];
}

// 방 사람(봇 제외)과 적어 둔 관계. 아무도 안 적었으면 null (칸을 보내지 않음). 12명까지, 관계 글은 합쳐 500자까지
function talk_saki_members(PDO $pdo, int $roomId): ?array {
    $st = $pdo->prepare('SELECT COALESCE(u.nick, u.name) AS who, m.saki_relation FROM talk_room_members m JOIN talk_users u ON u.id = m.user_id
        WHERE m.room_id = ? AND u.is_bot = 0 ORDER BY m.joined_at, m.user_id LIMIT 12');
    $st->execute([$roomId]);
    $rows = $st->fetchAll();
    if (!array_filter($rows, fn($r) => (string)$r['saki_relation'] !== '')) return null;
    $out = [];
    $left = TALK_SAKI_MEMBERS_CHARS;
    foreach ($rows as $r) {
        $one = ['name' => mb_substr((string)$r['who'], 0, 20)];
        $rel = trim(preg_replace('/[\x00-\x1F\x7F\[\]<>]+/u', ' ', (string)$r['saki_relation']));
        $rel = mb_substr($rel, 0, min(TALK_SAKI_RELATION_MAX, $left));
        if ($rel !== '') { $one['relation'] = $rel; $left -= mb_strlen($rel); }
        $out[] = $one;
    }
    return $out;
}

// Lite 부르기 → [HTTP 상태(0 = 연결 실패), 응답 JSON(없으면 null), 연결 오류 글]
function talk_saki_call(array $cfg, string $what, array $body, int $timeout = 60): array {
    $key = (string)($cfg['saki_lite_key'] ?? '');
    if ($key === '') return [0, null, '열쇠가 없어요.'];
    $json = $body ? json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '{}';
    $base = talk_saki_base();
    $send = function (string $url) use ($key, $json, $timeout): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $json, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Saki-Lite-Key: ' . $key],
            CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => talk_saki_test_url() !== '' ? CURLPROTO_HTTP | CURLPROTO_HTTPS : CURLPROTO_HTTPS,
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = $raw === false ? curl_error($ch) : '';
        curl_close($ch);
        $res = is_string($raw) ? json_decode($raw, true) : null;
        return [$code, is_array($res) ? $res : null, $err];
    };
    $r = $send($base . 'lite/' . $what);
    // PATH_INFO 가 안 되는 서버면 ?r= 로 한 번 더
    if ($r[0] === 404 && $r[1] === null) $r = $send(rtrim($base, '/') . '?r=lite/' . $what);
    return $r;
}

// 관리 화면에 보여 줄 마지막 결과 (열쇠는 넣지 않음)
function talk_saki_note(PDO $pdo, array $cfg, string $what, array $r): void {
    [$code, $res, $err] = $r;
    $msg = $res['error'] ?? $err;
    $key = (string)($cfg['saki_lite_key'] ?? '');
    if ($key !== '') $msg = str_replace($key, '(열쇠)', (string)$msg);
    $note = ['at' => talk_now(), 'what' => $what, 'code' => $code, 'error' => mb_substr((string)$msg, 0, 200)];
    foreach (['why', 'spent', 'cap', 'limited', 'on', 'model', 'requests'] as $k) if (isset($res[$k]) && is_scalar($res[$k])) $note[$k] = $res[$k];
    talk_meta_set($pdo, 'saki_status', json_encode($note, JSON_UNESCAPED_UNICODE));
}

// 상태 글 (관리 화면): HTTP 상태 → 사람이 읽는 말
function talk_saki_status_text(array $n): string {
    $code = (int)($n['code'] ?? 0);
    if ($code === 200) {
        $s = isset($n['on']) && !$n['on'] ? '꺼짐' : '잘 됨';
        if (isset($n['spent'], $n['cap'])) $s .= sprintf(' · 오늘 $%.3f / $%.2f', (float)$n['spent'], (float)$n['cap']);
        if (isset($n['requests'])) $s .= ' · 오늘 요청 ' . (int)$n['requests'] . '번';
        if (!empty($n['limited'])) $s .= ' · 오늘 상한에 닿음';
        if (!empty($n['why'])) $s .= ' · ' . $n['why'];
        return $s;
    }
    if ($code === 401) return 'SAKi Lite 열쇠가 맞지 않아요. SAKI 관리 화면에서 새 열쇠를 만들어 다시 넣어 주세요.';
    if ($code === 503) return '꺼짐 (SAKI 쪽에서 SAKi Lite 를 꺼 뒀어요)';
    if ($code === 0) return '연결하지 못했어요: ' . ($n['error'] ?? '');
    return "HTTP $code " . ($n['error'] ?? '');
}

// 관리 화면 "상태 확인": lite/status
function talk_saki_check(PDO $pdo, array $cfg, int $timeout = 15): array {
    $r = talk_saki_call($cfg, 'status', [], $timeout);
    talk_saki_note($pdo, $cfg, 'status', $r);
    $n = json_decode((string)talk_meta_get($pdo, 'saki_status'), true);
    // 사용량 칸에 보일 마지막 상태 확인 (대답 결과로 덮이지 않게 따로)
    talk_meta_set($pdo, 'saki_usage', json_encode($n + ['day' => is_string($r[1]['day'] ?? null) ? $r[1]['day'] : talk_saki_day()], JSON_UNESCAPED_UNICODE));
    return $n;
}

// 관리 화면 사용량: SAKI 서버의 오늘 사용량(2분 넘게 지났으면 새로 물어봄) + 이 서버에서 센 방별 사키 대답 수
function talk_saki_usage(PDO $pdo, array $cfg): array {
    $u = json_decode((string)talk_meta_get($pdo, 'saki_usage'), true);
    if (!is_array($u) || strtotime($u['at'] . ' UTC') < time() - 120) {
        talk_saki_check($pdo, $cfg, 5);
        $u = json_decode((string)talk_meta_get($pdo, 'saki_usage'), true);
    }
    $bot = talk_saki_bot($pdo);
    $dayStart = gmdate('Y-m-d H:i:s', strtotime(talk_saki_day() . ' 00:00:00 UTC') - 9 * 3600); // 한국 날짜 0시
    $st = $pdo->prepare("SELECT r.id, COALESCE(r.name, '(이름 없는 방)') AS name, SUM(m.created_at >= ?) AS today, COUNT(*) AS week
        FROM talk_messages m JOIN talk_rooms r ON r.id = m.room_id WHERE m.user_id = ? AND m.kind = 'text' AND m.created_at >= ?
        GROUP BY r.id ORDER BY today DESC, week DESC");
    $st->execute([$dayStart, $bot, gmdate('Y-m-d H:i:s', time() - 7 * 86400)]);
    return ['lite' => $u, 'rooms' => $st->fetchAll()];
}

// 받은 링크: https 만, 4개까지, 제목은 일반 글로
function talk_saki_links(mixed $links): ?array {
    if (!is_array($links)) return null;
    $out = [];
    foreach ($links as $l) {
        if (count($out) >= 4) break;
        if (!is_array($l)) continue;
        $url = trim((string)($l['url'] ?? ''));
        $u = parse_url($url);
        if (!str_starts_with($url, 'https://') || strlen($url) > 2000 || !$u || empty($u['host']) || isset($u['user']) || isset($u['pass'])
            || preg_match('/[\x00-\x20"<>\\\\]/', $url)) continue;
        $title = mb_substr(trim(preg_replace('/\s+/u', ' ', (string)($l['title'] ?? ''))), 0, 100);
        $kind = in_array($l['kind'] ?? '', ['page', 'youtube', 'naver'], true) ? $l['kind'] : 'page';
        $out[] = ['kind' => $kind, 'title' => $title !== '' ? $title : strtolower($u['host']), 'url' => $url];
    }
    return $out ?: null;
}

function talk_saki_typing(PDO $pdo, int $roomId, int $bot, bool $on): void {
    // 답까지 20초 넘게 걸릴 수 있어 입력 중 표시(8초면 꺼짐)를 앞으로 60초 켜 둔다
    $pdo->prepare('UPDATE talk_room_members SET typing_at = ? WHERE room_id = ? AND user_id = ?')
        ->execute([$on ? gmdate('Y-m-d H:i:s', time() + TALK_SAKI_BUSY_SECONDS) : null, $roomId, $bot]);
}

// 응답을 돌려준 뒤: Lite 부르고 → 봇 메시지·링크·반응 올리기
function talk_saki_run(PDO $pdo, array $cfg, int $roomId, int $bot, int $msgId, string $mode, array $s, string $roomName): void {
    @set_time_limit(90);
    $day = talk_saki_day();
    if (talk_meta_get($pdo, "saki_limited:$roomId") === $day) return; // 오늘 상한 거절 말을 이미 올린 방: 그날은 안 부름
    if ($mode === 'chime' && !talk_saki_chime_due($pdo, $roomId, $bot, $s['gap'])) return;
    if (!talk_saki_lock($pdo, $roomId)) return; // 부르는 중에 온 부르기는 버림 (다음 부르기가 최근 대화를 다 보냄)
    try {
        if ($mode === 'chime') talk_meta_set($pdo, "saki_chime:$roomId", (string)time());
        [$messages, $range] = talk_saki_context($pdo, $roomId, $bot, $mode === 'summary');
        if (!$messages) return;
        talk_saki_typing($pdo, $roomId, $bot, true);
        $req = [
            'personality' => $s['personality'], 'polite' => (bool)$s['polite'], 'mode' => $mode,
            'name' => mb_substr(talk_display_name($pdo, $bot), 0, 20), 'room' => mb_substr($roomName, 0, 40),
        ];
        if ($members = talk_saki_members($pdo, $roomId)) $req['members'] = $members;
        if ($mode === 'summary') $req['range'] = $range;
        if ($mode === 'called') {
            $req['app'] = TALK_SAKI_APP;
            // 하루 사용량 90% 안내: 방마다 하루 한 번만 (안내를 붙였다는 답을 받으면 그날은 그만)
            if (talk_meta_get($pdo, "saki_budget:$roomId") !== $day) $req['budget_notice'] = true;
        }
        $req['messages'] = $messages;
        $r = talk_saki_call($cfg, 'reply', $req);
        talk_saki_note($pdo, $cfg, 'reply', $r);
        talk_saki_typing($pdo, $roomId, $bot, false);
        [$code, $res, $err] = $r;
        if ($code !== 200 || !$res || empty($res['ok'])) {
            error_log("talk saki: 방 $roomId HTTP $code " . mb_substr((string)($res['error'] ?? $err), 0, 200));
            return;
        }
        $text = trim((string)($res['text'] ?? ''));
        if (!empty($res['pass']) || $text === '') return;
        if (!empty($res['limited'])) talk_meta_set($pdo, "saki_limited:$roomId", $day);
        if (!empty($res['budget_noticed'])) talk_meta_set($pdo, "saki_budget:$roomId", $day);
        // Claude 쪽 오류 말("잘 안 되네…")은 같은 방에서 연달아 나오면 첫 번째만
        if (($res['why'] ?? '') === 'claude-error') {
            if (talk_meta_get($pdo, "saki_err:$roomId") !== null) return;
            talk_meta_set($pdo, "saki_err:$roomId", '1');
        } else {
            $pdo->prepare('DELETE FROM talk_meta WHERE k = ?')->execute(["saki_err:$roomId"]);
        }
        talk_saki_post($pdo, $roomId, $bot, $msgId, mb_substr($text, 0, TALK_BODY_MAX), talk_saki_links($res['links'] ?? null), $s['react'] ? (string)($res['reaction'] ?? '') : '');
    } finally {
        talk_saki_typing($pdo, $roomId, $bot, false);
        $pdo->prepare('DELETE FROM talk_meta WHERE k = ?')->execute(["saki_busy:$roomId"]);
    }
}

// 봇 메시지 저장 (+ 링크), 부른 메시지에 반응, 사람 메시지와 똑같이 웹 푸시
function talk_saki_post(PDO $pdo, int $roomId, int $bot, int $msgId, string $text, ?array $links, string $emoji): void {
    $st = $pdo->prepare('SELECT 1 FROM talk_room_members WHERE room_id = ? AND user_id = ?');
    $st->execute([$roomId, $bot]);
    if (!$st->fetchColumn()) return; // 그사이 사키 초대를 껐거나 방이 없어짐
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO talk_messages (room_id, user_id, kind, body, created_at, links) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$roomId, $bot, 'text', $text, talk_now(), $links ? json_encode($links, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null]);
    $id = (int)$pdo->lastInsertId();
    $pdo->prepare('UPDATE talk_room_members SET last_read_id = ? WHERE room_id = ? AND user_id = ?')->execute([$id, $roomId, $bot]);
    talk_event($pdo, $roomId, 'msg', $id);
    $emoji = trim($emoji);
    if ($emoji !== '' && mb_strlen($emoji) <= 8 && !preg_match('/[\x00-\x7F]/', $emoji)) {
        $st = $pdo->prepare("SELECT 1 FROM talk_messages WHERE id = ? AND room_id = ? AND kind NOT IN ('system', 'deleted')");
        $st->execute([$msgId, $roomId]);
        if ($st->fetchColumn()) {
            $pdo->prepare('REPLACE INTO talk_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')->execute([$msgId, $bot, $emoji, talk_now()]);
            talk_event($pdo, $roomId, 'msg', $msgId);
        }
    }
    $pdo->commit();
    if (function_exists('talk_push_message')) talk_push_message($pdo, $roomId, $bot, $text);
}
