<?php
// SAKi Talk 서버 설정 페이지
//  - 처음: DB 정보(SAKI 와 같은 카페24 DB 를 써도 됨, 표 이름이 talk_ 로 달라 섞이지 않음)와 관리자 이름·비밀번호를 넣으면
//    설정 파일(웹에서 안 열리는 곳)과 표를 만든다. 올린 지 24시간 안에만 처음 설정을 할 수 있다 (남이 먼저 설정하는 것을 막는 안전장치)
//  - 설정 후: 관리자 비밀번호로 들어와 그룹·초대 코드·사람·기기를 관리하고, 사진·영상 보관 설정을 바꾼다
declare(strict_types=1);
define('TALK', true);
require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/accounts.php';
require __DIR__ . '/lib/chat.php';
require __DIR__ . '/lib/media.php';
require __DIR__ . '/lib/push.php';
require __DIR__ . '/lib/notices.php';
require __DIR__ . '/lib/backup.php';

// DB 시각(UTC) → 한국 시간으로 보여 주기 (한국은 서머타임 없음)
function kst(?string $utc): string { return $utc ? gmdate('Y-m-d H:i:s', strtotime($utc . ' UTC') + 9 * 3600) : ''; }

const SETUP_WINDOW_HOURS = 24;
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'self'; style-src 'unsafe-inline'; form-action 'self'");
session_name('talk_setup');
session_start(['cookie_httponly' => true, 'cookie_samesite' => 'Strict', 'cookie_secure' => !empty($_SERVER['HTTPS'])]);

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$local = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);

function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES); }
function csrf(): string { if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16)); return $_SESSION['csrf']; }
function csrf_ok(): bool { return hash_equals((string)($_SESSION['csrf'] ?? ''), (string)($_POST['csrf'] ?? '')); }

// 설정 파일을 둘 곳: 웹 폴더(www) 바깥이 가장 안전, 안 되면 이 폴더 안 private (웹 접근 차단)
function choose_private_dir(): string {
    $root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    $outside = $root !== '' ? dirname($root) . '/talk-private' : '';
    foreach (array_filter([$outside, __DIR__ . '/private']) as $d) {
        if ((is_dir($d) || @mkdir($d, 0700, true)) && is_writable($d)) {
            if (str_starts_with($d, __DIR__)) {
                @file_put_contents("$d/.htaccess", "Require all denied\nDeny from all\n");
                @file_put_contents("$d/index.html", '');
            }
            return $d;
        }
    }
    throw new RuntimeException('설정 파일을 둘 폴더를 만들 수 없어요.');
}

function check_new_password(): string {
    $pw = (string)($_POST['pw'] ?? '');
    if (mb_strlen($pw) < 8) throw new RuntimeException('비밀번호는 8자 이상으로 해 주세요.');
    if ($pw !== (string)($_POST['pw2'] ?? '')) throw new RuntimeException('비밀번호 두 칸이 서로 달라요.');
    return $pw;
}

$cfg = talk_config();
$msg = '';
$err = '';

// ───── 처음 설정 ─────
if ($cfg === null) {
    // 올린 시각: FTP 가 원본 수정 시각을 유지해도 서버에 들어온 시각(ctime)은 올린 때로 남는다
    $expired = time() - (int)filectime(__FILE__) > SETUP_WINDOW_HOURS * 3600;
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && !$expired) {
        try {
            if (!$https && !$local) throw new RuntimeException('https:// 주소로 열어 주세요.');
            if (!csrf_ok()) throw new RuntimeException('페이지를 새로 고친 뒤 다시 시도해 주세요.');
            $name = trim((string)($_POST['name'] ?? ''));
            if ($name === '' || mb_strlen($name) > 20) throw new RuntimeException('관리자 이름을 1~20자로 넣어 주세요.');
            $pw = check_new_password();
            $new = [
                'db_host' => trim((string)($_POST['dbh'] ?? 'localhost')) ?: 'localhost',
                'db_name' => trim((string)($_POST['dbn'] ?? '')),
                'db_user' => trim((string)($_POST['dbu'] ?? '')),
                'db_pass' => (string)($_POST['dbp'] ?? ''),
                'admin_name' => $name,
                'admin_hash' => password_hash($pw, PASSWORD_DEFAULT),
                'media_limit_mb' => 400,
                'photo_days' => 14,
                'video_days' => 3,
                'created_at' => gmdate('c'),
            ];
            try { $pdo = talk_db($new); } catch (Throwable $e) { throw new RuntimeException('DB 에 연결하지 못했어요. 카페24 관리 화면의 DB 정보를 확인해 주세요.'); }
            talk_migrate($pdo);
            $dir = choose_private_dir();
            talk_write_config($dir, $new);
            file_put_contents(__DIR__ . '/config-path.php', "<?php\n// 설정 파일이 있는 폴더 위치 (비밀 정보 없음)\nreturn " . var_export($dir, true) . ";\n", LOCK_EX);
            talk_forget_cached(__DIR__ . '/config-path.php');
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            $cfg = talk_config();
            $msg = '설정을 마쳤어요! ' . (str_starts_with($dir, __DIR__) ? '(설정 파일은 이 폴더 안 private 에 두고 웹 접근을 막았어요)' : '(설정 파일은 웹에서 열리지 않는 곳에 뒀어요)');
        } catch (Throwable $e) {
            $err = $e->getMessage();
        }
    }
    if ($cfg === null) {
        page_head('SAKi Talk 처음 설정');
        if (!$https && !$local) echo '<p class="err">지금 http 로 열었어요. 비밀번호가 암호화 없이 전송되니 https:// 주소로 다시 열어 주세요.</p>';
        if ($expired) {
            echo '<p class="err">이 설정 페이지를 올린 지 ' . SETUP_WINDOW_HOURS . '시간이 지나 처음 설정이 잠겼어요. (남이 먼저 설정하지 못하게 하는 안전장치)<br>setup.php 를 다시 올린 뒤 바로 설정해 주세요.</p>';
        } else {
            if ($err) echo '<p class="err">' . h($err) . '</p>';
            ?>
<form method="post" autocomplete="off">
<input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
<fieldset><legend>DB (카페24 관리 화면 → 나의서비스관리 → DB 정보)</legend>
<p class="hint">SAKI 와 같은 DB 를 넣어도 돼요. 메신저 표는 이름이 talk_ 로 시작해서 SAKI 표와 섞이지 않아요.</p>
<label>호스트 <input name="dbh" value="localhost"></label>
<label>DB 이름 <input name="dbn" required placeholder="보통 카페24 아이디"></label>
<label>DB 아이디 <input name="dbu" required placeholder="보통 카페24 아이디"></label>
<label>DB 비밀번호 <input name="dbp" type="password" required></label>
</fieldset>
<fieldset><legend>관리자 (그룹을 만들고 초대 코드를 나눠 주는 사람)</legend>
<label>이름 <input name="name" required maxlength="20" placeholder="예: 일래"></label>
<label>비밀번호 <input name="pw" type="password" required minlength="8"></label>
<label>한 번 더 <input name="pw2" type="password" required minlength="8"></label>
</fieldset>
<button type="submit">설정하기</button>
</form>
<?php
        }
        page_foot();
        exit;
    }
}

// ───── 관리 (설정 후) ─────
$pdo = talk_db($cfg);
talk_migrate_if_needed($pdo);
talk_ensure_admin($pdo, $cfg);
$invite = null; // [그룹 이름, 코드] — 방금 만든 코드를 위에 크게 보여 줌 (아래 그룹 목록에도 계속 보임)
$act = (string)($_POST['act'] ?? '');
// 앱에서 "SAKi Talk 관리" 로 열면: 한 번 쓰는 표로 바로 로그인하고 주소에서 표를 지움
if (isset($_GET['ticket'])) {
    $t = json_decode((string)talk_meta_get($pdo, 'admin_ticket'), true);
    $pdo->prepare("DELETE FROM talk_meta WHERE k = 'admin_ticket'")->execute();
    if (is_array($t) && ($t['exp'] ?? 0) >= time() && hash_equals((string)$t['hash'], hash('sha256', (string)$_GET['ticket']))) {
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
    }
    header('Location: setup.php');
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && !$msg) {
    try {
        if (!csrf_ok()) throw new RuntimeException('페이지를 새로 고친 뒤 다시 시도해 주세요.');
        if ($act === 'login') {
            if (!$https && !$local) throw new RuntimeException('https:// 주소로 열어 주세요.');
            check_admin_password($pdo, $cfg, (string)($_POST['pw'] ?? ''));
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
        } elseif (empty($_SESSION['admin'])) {
            throw new RuntimeException('먼저 로그인해 주세요.');
        } elseif ($act === 'logout') {
            $_SESSION = [];
        } elseif ($act === 'media') {
            $cfg['media_limit_mb'] = max(50, min(5000, (int)($_POST['limit'] ?? 400)));
            $cfg['photo_days'] = max(1, min(365, (int)($_POST['photo'] ?? 14)));
            $cfg['video_days'] = max(1, min(365, (int)($_POST['video'] ?? 3)));
            talk_write_config($cfg['private_dir'], $cfg);
            $msg = '사진·영상 보관 설정을 바꿨어요.';
        } elseif ($act === 'password') {
            $cfg['admin_hash'] = password_hash(check_new_password(), PASSWORD_DEFAULT);
            talk_write_config($cfg['private_dir'], $cfg);
            // 관리자는 메신저 로그인도 같은 비밀번호
            $pdo->prepare('UPDATE talk_users SET password_hash = ? WHERE is_admin = 1')->execute([$cfg['admin_hash']]);
            $msg = '관리자 비밀번호를 바꿨어요. (메신저 로그인 비밀번호도 같이 바뀌어요)';
        } elseif ($act === 'group_new') {
            $gname = trim((string)($_POST['name'] ?? ''));
            if ($gname === '' || mb_strlen($gname) > 40) throw new RuntimeException('그룹 이름을 1~40자로 넣어 주세요.');
            $pdo->prepare('INSERT INTO talk_groups (name, created_at) VALUES (?, ?)')->execute([$gname, talk_now()]);
            $gid = (int)$pdo->lastInsertId();
            talk_admin_in_all_groups($pdo); // 관리자는 모든 그룹에
            $msg = "그룹 \"$gname\" 을 만들었어요. 아래에서 초대 코드를 만들어 나눠 주세요.";
        } elseif ($act === 'group_close' || $act === 'group_open') {
            $pdo->prepare('UPDATE talk_groups SET closed = ? WHERE id = ?')->execute([$act === 'group_close' ? 1 : 0, (int)($_POST['id'] ?? 0)]);
            $msg = $act === 'group_close' ? '그룹을 닫았어요. (그룹 사람들끼리 서로 안 보이고 방도 숨겨져요. 다시 열 수 있어요)' : '그룹을 다시 열었어요.';
        } elseif ($act === 'invite') {
            $gid = (int)($_POST['group'] ?? 0);
            $st = $pdo->prepare('SELECT name FROM talk_groups WHERE id = ? AND closed = 0');
            $st->execute([$gid]);
            $gname = $st->fetchColumn();
            if ($gname === false) throw new RuntimeException('그룹을 찾지 못했어요.');
            $invite = [$gname, talk_new_invite($pdo, $gid, (int)($_POST['uses'] ?? 1), (int)($_POST['days'] ?? 7))];
        } elseif ($act === 'invite_revoke') {
            $pdo->prepare('UPDATE talk_invites SET revoked = 1 WHERE id = ?')->execute([(int)($_POST['id'] ?? 0)]);
            $msg = '초대 코드를 없앴어요.';
        } elseif ($act === 'user_groups') {
            talk_set_user_groups($pdo, (int)($_POST['id'] ?? 0), array_map('intval', (array)($_POST['groups'] ?? [])));
            $msg = '그룹을 바꿨어요. (앱은 몇 초 안에 새 친구 목록을 받아요)';
        } elseif ($act === 'member_remove') {
            $pdo->prepare('DELETE m FROM talk_group_members m JOIN talk_users u ON u.id = m.user_id WHERE m.group_id = ? AND m.user_id = ? AND u.is_admin = 0')
                ->execute([(int)($_POST['group'] ?? 0), (int)($_POST['id'] ?? 0)]);
            $msg = '그룹에서 뺐어요. (이미 있던 방의 대화는 그대로 남아요)';
        } elseif ($act === 'user_off' || $act === 'user_on') {
            $pdo->prepare('UPDATE talk_users SET disabled = ? WHERE id = ? AND is_admin = 0')->execute([$act === 'user_off' ? 1 : 0, (int)($_POST['id'] ?? 0)]);
            $msg = $act === 'user_off' ? '이 사람을 멈췄어요. (로그인이 바로 끊기고 다른 사람에게 안 보여요)' : '다시 쓸 수 있게 했어요.';
        } elseif ($act === 'user_pw') {
            $uid = (int)($_POST['id'] ?? 0);
            $pw = '';
            for ($i = 0; $i < 8; $i++) $pw .= 'abcdefghjkmnpqrstuvwxyz23456789'[random_int(0, 30)];
            $u = $pdo->prepare('UPDATE talk_users SET password_hash = ? WHERE id = ? AND is_admin = 0');
            $u->execute([password_hash($pw, PASSWORD_DEFAULT), $uid]);
            if ($u->rowCount() === 0) throw new RuntimeException('사람을 찾지 못했어요.');
            $pdo->prepare('UPDATE talk_devices SET revoked = 1 WHERE user_id = ?')->execute([$uid]);
            $msg = "새 비밀번호: $pw — 이 화면을 나가면 다시 볼 수 없어요. 그 사람에게 알려 주고, 로그인 후 바꾸라고 해 주세요.";
        } elseif ($act === 'device_revoke') {
            talk_revoke_device($pdo, (int)($_POST['id'] ?? 0));
            $msg = '기기 로그인을 끊었어요.';
        } elseif ($act === 'devices_prune') {
            $st = $pdo->prepare('SELECT id FROM talk_devices WHERE revoked = 0 AND last_seen < ?');
            $st->execute([gmdate('Y-m-d H:i:s', time() - 7 * 86400)]);
            $ids = $st->fetchAll(PDO::FETCH_COLUMN);
            foreach ($ids as $id) talk_revoke_device($pdo, (int)$id);
            $msg = count($ids) . '개 기기를 끊었어요.';
        } elseif ($act === 'notice_new') {
            talk_notice_add($pdo, (string)($_POST['title'] ?? ''), (string)($_POST['body'] ?? ''));
            $msg = '공지를 올렸어요. 앱을 켜 둔 사람은 몇 초 안에 채팅 목록 위에서 봐요.';
            if (!empty($_POST['push'])) {
                $r = talk_push_notice($pdo, trim((string)$_POST['title']));
                $msg .= " 알림: {$r['total']}개 기기 중 {$r['sent']}개로 보냄.";
            }
        } elseif ($act === 'notice_edit') {
            talk_notice_edit($pdo, (int)($_POST['id'] ?? 0), (string)($_POST['title'] ?? ''), (string)($_POST['body'] ?? ''));
            $msg = '공지를 고쳤어요.';
        } elseif ($act === 'notice_delete') {
            talk_notice_delete($pdo, (int)($_POST['id'] ?? 0));
            $msg = '공지를 지웠어요.';
        } elseif ($act === 'backup_txt' || $act === 'backup_json') {
            talk_backup_download($pdo, $act === 'backup_json' ? 'json' : 'txt');
        }
        if (in_array($act, ['group_new', 'group_close', 'group_open', 'member_remove', 'user_off', 'user_on', 'user_groups'], true)) talk_groups_changed($pdo);
    } catch (Throwable $e) {
        $err = $e->getMessage();
    }
}

// 관리 화면 로그인: 15분에 5번 틀리면 잠금 (실패 기록은 talk_meta 에 IP 별로)
function check_admin_password(PDO $pdo, array $cfg, string $pw): void {
    $key = 'login_fail:' . substr(hash('sha256', talk_client_ip()), 0, 40);
    $fails = array_values(array_filter(json_decode((string)talk_meta_get($pdo, $key), true) ?: [], fn($t) => is_int($t) && $t > time() - 900));
    if (count($fails) >= 5) throw new RuntimeException('비밀번호를 여러 번 틀렸어요. 15분 뒤에 다시 시도해 주세요.');
    if (!password_verify($pw, (string)$cfg['admin_hash'])) {
        $fails[] = time();
        talk_meta_set($pdo, $key, json_encode($fails));
        throw new RuntimeException('비밀번호가 맞지 않아요.');
    }
}

page_head('SAKi Talk 관리');
if ($msg) echo '<p class="ok">' . h($msg) . '</p>';
if ($err) echo '<p class="err">' . h($err) . '</p>';
if (empty($_SESSION['admin'])) {
    ?>
<form method="post"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="act" value="login">
<fieldset><legend>관리 화면 로그인</legend><label>관리자 비밀번호 <input name="pw" type="password" required autofocus></label></fieldset>
<button type="submit">들어가기</button></form>
<?php
    page_foot();
    exit;
}
$base = ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/';
$deploy = json_decode((string)@file_get_contents(__DIR__ . '/deploy.json'), true);
$groups = $pdo->query('SELECT id, name, closed FROM talk_groups ORDER BY closed, id')->fetchAll();
$members = [];
foreach ($pdo->query('SELECT m.group_id, u.id, u.name, u.nick, u.is_admin FROM talk_group_members m JOIN talk_users u ON u.id = m.user_id ORDER BY u.name')->fetchAll() as $r) $members[(int)$r['group_id']][] = $r;
$invites = [];
$st = $pdo->prepare('SELECT id, group_id, code, uses_left, expires_at FROM talk_invites WHERE revoked = 0 AND uses_left > 0 AND expires_at > ? ORDER BY id');
$st->execute([talk_now()]);
foreach ($st->fetchAll() as $r) $invites[(int)$r['group_id']][] = $r;
$userGroups = [];
foreach ($pdo->query('SELECT user_id, group_id FROM talk_group_members')->fetchAll() as $r) $userGroups[(int)$r['user_id']][(int)$r['group_id']] = true;
$users = $pdo->query('SELECT u.id, u.name, u.nick, u.is_admin, u.disabled, u.created_at, (SELECT COUNT(*) FROM talk_devices d WHERE d.user_id = u.id AND d.revoked = 0) devs FROM talk_users u ORDER BY u.id')->fetchAll();
$devs = $pdo->query('SELECT d.id, d.name, d.last_seen, d.active_at, d.active_room, (SELECT COUNT(*) FROM talk_push_subs s WHERE s.device_id = d.id) subs, u.name AS owner FROM talk_devices d JOIN talk_users u ON u.id = d.user_id WHERE d.revoked = 0 ORDER BY u.id, d.last_seen DESC')->fetchAll();
$counts = $pdo->query('SELECT (SELECT COUNT(*) FROM talk_rooms) r, (SELECT COUNT(*) FROM talk_messages) m')->fetch();
$copy = fn(string $text, string $label) => '<button type="button" class="sub" data-copy="' . h($text) . '">' . h($label) . '</button>';
$hidden = fn(string $act, array $extra = []) => '<input type="hidden" name="csrf" value="' . h(csrf()) . '"><input type="hidden" name="act" value="' . h($act) . '">'
    . implode('', array_map(fn($k, $v) => '<input type="hidden" name="' . h($k) . '" value="' . h((string)$v) . '">', array_keys($extra), $extra));
?>
<fieldset><legend>서버 상태</legend>
<p>웹앱 주소 <code><?= h($base) ?></code></p>
<p class="hint">관리자 <?= h((string)$cfg['admin_name']) ?> (메신저에도 이 이름과 관리자 비밀번호로 로그인) · 서버 버전 <?= TALK_SERVER_VERSION ?> · 방 <?= (int)$counts['r'] ?>개 · 메시지 <?= (int)$counts['m'] ?>개<?= is_array($deploy) ? ' · 배포 ' . h(substr((string)($deploy['sha'] ?? ''), 0, 7)) . ' (' . h((string)($deploy['at'] ?? '')) . ')' : '' ?></p>
</fieldset>

<?php if ($invite): ?>
<div class="secret"><b>초대 코드를 만들었어요 — 복사해서 나눠 주세요</b><br>그룹 <?= h($invite[0]) ?> 초대 코드 <code><?= h($invite[1]) ?></code>
<br>초대 링크 <code><?= h($base . '#invite=' . $invite[1]) ?></code>
<div class="btns"><?= $copy($invite[1], '코드 복사') ?><?= $copy($base . '#invite=' . $invite[1], '링크 복사') ?><?= $copy($base . 'guide/#invite=' . $invite[1], '안내+초대 링크 복사') ?></div>
<span class="hint">링크를 열면 가입 화면에 코드가 채워져 있어요. 안내+초대 링크는 가입·앱 설치 방법 페이지가 먼저 열려요. 이미 가입한 사람은 앱의 설정 → 초대 코드 넣기. 아래 그룹 목록에서 언제든 다시 볼 수 있어요.</span></div>
<?php endif; ?>

<details class="menu" id="m-groups"<?= $invite ? ' open' : '' ?>><summary>그룹 <span class="hint">그룹 <?= count($groups) ?>개 · 사람 <?= count($users) ?>명</span></summary>
<fieldset><legend>그룹 (같은 그룹 사람끼리만 서로 보여요)</legend>
<?php if (!$groups) echo '<p class="hint">아직 없어요. 먼저 그룹을 만들어 주세요 (예: 가족, 친구).</p>'; ?>
<?php foreach ($groups as $g): $gid = (int)$g['id']; ?>
<div class="group">
<form method="post" class="row"><?= $hidden((int)$g['closed'] ? 'group_open' : 'group_close', ['id' => $gid]) ?>
<span><b><?= h($g['name']) ?></b><?= (int)$g['closed'] ? ' <span class="err">닫힘</span>' : '' ?> <span class="hint"><?= count($members[$gid] ?? []) ?>명</span></span>
<button type="submit" class="sub"><?= (int)$g['closed'] ? '다시 열기' : '닫기' ?></button></form>
<?php foreach ($members[$gid] ?? [] as $m): ?>
<form method="post" class="row"><?= $hidden('member_remove', ['group' => $gid, 'id' => (int)$m['id']]) ?>
<span class="hint">└ <?= h($m['name']) ?><?= $m['nick'] ? ' · ' . h($m['nick']) : '' ?><?= (int)$m['is_admin'] ? ' (관리자)' : '' ?></span>
<?php if (!(int)$m['is_admin']): ?><button type="submit" class="sub">그룹에서 빼기</button><?php endif; ?></form>
<?php endforeach; ?>
<?php foreach ($invites[$gid] ?? [] as $i): ?>
<form method="post" class="row"><?= $hidden('invite_revoke', ['id' => (int)$i['id']]) ?>
<span class="hint">└ 초대 코드 <?= $i['code'] ? '<code>' . h($i['code']) . '</code> · 링크 <code>' . h($base . '#invite=' . $i['code']) . '</code>' : '#' . (int)$i['id'] . ' (예전에 만든 코드라 다시 볼 수 없어요)' ?>
<br>└ 남은 횟수 <?= (int)$i['uses_left'] ?> · <?= h(kst($i['expires_at'])) ?> 까지</span>
<span class="btns"><?php if ($i['code']): ?><?= $copy($i['code'], '코드 복사') ?><?= $copy($base . '#invite=' . $i['code'], '링크 복사') ?><?= $copy($base . 'guide/#invite=' . $i['code'], '안내+초대 링크 복사') ?><?php endif; ?><button type="submit" class="sub">없애기</button></span></form>
<?php endforeach; ?>
<?php if (!(int)$g['closed']): ?>
<form method="post" class="row"><?= $hidden('invite', ['group' => $gid]) ?>
<label>쓸 수 있는 횟수 <input name="uses" type="number" value="1" min="1" max="50"></label>
<label>며칠 동안 <input name="days" type="number" value="7" min="1" max="90"></label>
<button type="submit">초대 코드 만들기</button></form>
<?php endif; ?>
</div>
<?php endforeach; ?>
<form method="post" class="row"><?= $hidden('group_new') ?><label>새 그룹 이름 <input name="name" required maxlength="40" placeholder="예: 가족"></label><button type="submit">그룹 만들기</button></form>
</fieldset>

<fieldset><legend>사람 (그룹을 체크하고 저장하면 여러 그룹에 한꺼번에 넣고 빼요)</legend>
<?php foreach ($users as $u): ?>
<div class="row"><span><b><?= h($u['name']) ?></b><?= $u['nick'] ? ' · ' . h($u['nick']) : '' ?> <span class="hint"><?= (int)$u['is_admin'] ? '관리자' : '사용자' ?> · 기기 <?= (int)$u['devs'] ?>개 · 가입 <?= h(substr(kst($u['created_at']), 0, 10)) ?><?= (int)$u['disabled'] ? ' · <span class="err">멈춤</span>' : '' ?></span></span>
<?php if (!(int)$u['is_admin']): ?><span class="btns">
<form method="post"><?= $hidden('user_pw', ['id' => (int)$u['id']]) ?><button type="submit" class="sub">새 비밀번호</button></form>
<form method="post"><?= $hidden((int)$u['disabled'] ? 'user_on' : 'user_off', ['id' => (int)$u['id']]) ?><button type="submit" class="sub"><?= (int)$u['disabled'] ? '다시 켜기' : '멈추기' ?></button></form>
</span><?php endif; ?></div>
<?php if (!(int)$u['is_admin'] && $groups): ?>
<form method="post" class="row ugroups"><?= $hidden('user_groups', ['id' => (int)$u['id']]) ?>
<span class="checks"><?php foreach ($groups as $g): ?><label class="check"><input type="checkbox" name="groups[]" value="<?= (int)$g['id'] ?>"<?= isset($userGroups[(int)$u['id']][(int)$g['id']]) ? ' checked' : '' ?>> <?= h($g['name']) ?><?= (int)$g['closed'] ? ' (닫힘)' : '' ?></label><?php endforeach; ?></span>
<button type="submit" class="sub">그룹 저장</button></form>
<?php elseif ((int)$u['is_admin']): ?><p class="hint">└ 관리자는 모든 그룹에 들어가 있어요.</p><?php endif; ?>
<?php endforeach; ?>
</fieldset>
</details>

<details class="menu" id="m-logs"><summary>접속 로그 <span class="hint">기기 <?= count($devs) ?>개</span></summary>
<details class="menu sub" id="m-devices"><summary>기기 접속 기록 (<?= count($devs) ?>개)</summary>
<fieldset><legend>로그인한 기기</legend>
<p class="hint">같은 휴대폰에서 다시 로그인하면 예전 줄은 저절로 끊기고, 60일 넘게 안 쓴 기기도 저절로 끊겨요.</p>
<form method="post"><?= $hidden('devices_prune') ?><button type="submit" class="sub">7일 넘게 안 쓴 기기 모두 끊기</button></form>
<?php if (!$devs) echo '<p class="hint">아직 없어요.</p>'; ?>
<?php foreach ($devs as $d): ?>
<form method="post" class="row"><?= $hidden('device_revoke', ['id' => (int)$d['id']]) ?>
<span><?= h($d['owner']) ?> · <?= h($d['name']) ?> <span class="hint">#<?= (int)$d['id'] ?> · 알림 <?= (int)$d['subs'] ? '<b class="ok">켬</b>' : '꺼짐' ?> · 마지막 <?= h(kst($d['last_seen'])) ?><?= $d['active_at'] ? ' · 앱 봄 ' . h(kst($d['active_at'])) . ($d['active_room'] ? " (방 {$d['active_room']})" : ' (목록)') : '' ?></span></span><button type="submit" class="sub">로그인 끊기</button></form>
<?php endforeach; ?>
</fieldset>
</details>

<details class="menu sub" id="m-push"><summary>알림 기록 (최근 30개)</summary>
<fieldset><legend>알림 기록</legend>
<?php $plog = json_decode((string)talk_meta_get($pdo, 'push_log'), true) ?: []; if (!$plog) echo '<p class="hint">아직 보낸 알림이 없어요.</p>'; ?>
<?php foreach ($plog as $l): ?>
<div class="row"><span><?= h(kst($l['at'])) ?> · <?= h($l['what']) ?> <span class="hint">· <?= (int)$l['sent'] ?>/<?= (int)$l['total'] ?> 성공<?= isset($l['ms']) ? ' · 서버에서 넘기기까지 ' . number_format($l['ms'] / 1000, 1) . '초' : '' ?><?= $l['results'] ? ' · ' . h(implode(', ', $l['results'])) : '' ?></span></span></div>
<?php endforeach; ?>
</fieldset>
</details>
</details>

<details class="menu" id="m-data"><summary>사진·영상·백업</summary>
<fieldset><legend>사진·영상 보관</legend>
<?php talk_media_cleanup($pdo, $cfg); $mu = talk_media_usage($pdo); $mc = $pdo->query("SELECT kind, COUNT(*) n, COALESCE(SUM(size), 0) s FROM talk_media WHERE deleted = 0 AND done = 1 GROUP BY kind")->fetchAll(PDO::FETCH_UNIQUE); ?>
<p>지금 <b><?= number_format($mu / 1048576, 1) ?>MB</b> / <?= (int)$cfg['media_limit_mb'] ?>MB 사용 <span class="hint">· 사진 <?= (int)($mc['photo']['n'] ?? 0) ?>장 <?= number_format(($mc['photo']['s'] ?? 0) / 1048576, 1) ?>MB · 영상 <?= (int)($mc['video']['n'] ?? 0) ?>개 <?= number_format(($mc['video']['s'] ?? 0) / 1048576, 1) ?>MB</span></p>
<form method="post"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="act" value="media">
<label>전체 상한 (MB, 넘으면 오래된 것부터 지움) <input name="limit" type="number" value="<?= (int)$cfg['media_limit_mb'] ?>" min="50" max="5000"></label>
<label>사진 보관 (일) <input name="photo" type="number" value="<?= (int)$cfg['photo_days'] ?>" min="1" max="365"></label>
<label>영상 보관 (일) <input name="video" type="number" value="<?= (int)$cfg['video_days'] ?>" min="1" max="365"></label>
<button type="submit">바꾸기</button></form>
</fieldset>

<fieldset><legend>백업 내려받기</legend>
<p class="hint">모든 방의 대화를 파일 하나로 내려받아요. 사진·영상 파일과 비밀번호는 들어 있지 않아요. 가끔 한 번씩 받아 두세요.</p>
<form method="post" class="row"><?= $hidden('backup_txt') ?><button type="submit">대화 기록 (.txt, 읽기용)</button></form>
<form method="post" class="row"><?= $hidden('backup_json') ?><button type="submit" class="sub">전체 자료 (.json, 옮기기용)</button></form>
</fieldset>
</details>

<?php $notices = talk_notice_list($pdo, 0)['notices']; ?>
<details class="menu" id="m-notices"><summary>공지사항 <span class="hint"><?= count($notices) ?>개</span></summary>
<fieldset><legend>새 공지</legend>
<p class="hint">모두의 채팅 목록 맨 위에 최신 공지 한 줄이 보이고, 누르면 공지사항 게시판이 열려요. 배포할 때마다 바뀐 점은 저절로 올라가요 (30분 안에 이어진 배포는 한 글로 모음).</p>
<form method="post"><?= $hidden('notice_new') ?>
<label>제목 <input name="title" required maxlength="100" placeholder="예: 사진 보내기가 빨라졌어요"></label>
<label>내용 <textarea name="body" maxlength="5000" rows="4"></textarea></label>
<label class="check"><input type="checkbox" name="push" value="1"> 알림(푸시)도 보내기</label>
<button type="submit">공지 올리기</button></form>
</fieldset>
<?php foreach ($notices as $n): ?>
<details class="menu sub"><summary><?= h($n['title']) ?> <span class="hint"><?= $n['kind'] === 'auto' ? '자동 · ' : '' ?><?= h(substr($n['updated'], 0, 10)) ?></span></summary>
<form method="post"><?= $hidden('notice_edit', ['id' => $n['id']]) ?>
<label>제목 <input name="title" required maxlength="100" value="<?= h($n['title']) ?>"></label>
<label>내용 <textarea name="body" maxlength="5000" rows="5"><?= h($n['body']) ?></textarea></label>
<button type="submit">고치기</button></form>
<form method="post"><?= $hidden('notice_delete', ['id' => $n['id']]) ?><button type="submit" class="sub">지우기</button></form>
</details>
<?php endforeach; ?>
</details>

<details class="menu" id="m-admin"><summary>관리자</summary>
<fieldset><legend>관리자 비밀번호 바꾸기</legend>
<form method="post" autocomplete="off"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="act" value="password">
<label>새 비밀번호 <input name="pw" type="password" required minlength="8"></label>
<label>한 번 더 <input name="pw2" type="password" required minlength="8"></label>
<button type="submit">바꾸기</button></form>
</fieldset>
</details>

<form method="post"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="act" value="logout"><button type="submit">관리 화면 나가기</button></form>
<?php
page_foot();

function page_head(string $title): void {
    echo '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="./icon-192.png"><title>' . h($title) . '</title><style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1c1f24;--dim:#69707a;--ok:#1f8f4e;--bad:#c62828;--acc:#e8508e;--line:#e3e6ea}
@media (prefers-color-scheme:dark){:root{--bg:#15171b;--card:#1f2228;--fg:#eceef1;--dim:#9aa1ab;--ok:#5fd18d;--bad:#ff8a80;--acc:#ff8fbd;--line:#2e333b}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:600px;margin:0 auto} h1{font-size:20px} fieldset{margin:12px 0;border:1px solid var(--line);border-radius:12px;background:var(--card)} legend{color:var(--acc);font-weight:600}
label{display:block;margin:8px 0;color:var(--dim)}
input,textarea{display:block;width:100%;box-sizing:border-box;margin-top:3px;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
button{font:inherit;cursor:pointer;color:#fff;background:var(--acc);border:0;border-radius:8px;padding:8px 16px;font-weight:600;margin-top:6px}
.row{display:flex;gap:8px;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding:6px 0;flex-wrap:wrap} .row label{flex:1;min-width:120px;margin:0}
.btns{display:flex;gap:6px} .checks{display:flex;flex-wrap:wrap;gap:4px 14px;flex:1} label.check{display:flex;align-items:center;gap:4px;margin:0;color:var(--fg)} label.check input{width:auto;margin:0} .ugroups{border-top:0;padding-top:0} .group{border:1px solid var(--line);border-radius:10px;padding:4px 10px;margin:8px 0} button.sub{background:transparent;color:var(--acc);border:1px solid var(--acc);padding:5px 10px}
.secret{border:2px solid var(--ok);border-radius:12px;padding:12px;margin:10px 0;font-size:16px;background:var(--card)} .secret code{font-size:17px}
details.menu{margin:12px 0;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:0 10px} details.menu>summary{cursor:pointer;padding:12px 2px;font-weight:600;color:var(--acc)} details.menu.sub{background:var(--bg);margin:8px 0} details.menu fieldset{border:0;margin:0 0 8px;padding:0 2px}
.hint{color:var(--dim);font-size:13px} .back{margin:calc(env(safe-area-inset-top) + 4px) 0 0} .back a{color:var(--acc);text-decoration:none;font-weight:600} .ok{color:var(--ok)} .err{color:var(--bad)} code{background:var(--bg);padding:2px 6px;border-radius:6px;user-select:all;overflow-wrap:anywhere}fieldset{min-width:0}
</style></head><body><main><p class="back"><a href="./">← SAKi Talk 으로</a></p><h1>' . h($title) . '</h1>';
}
function page_foot(): void { echo '</main><script src="./setup.js"></script></body></html>'; }
