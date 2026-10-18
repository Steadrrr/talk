<?php
// S.A.K.I Talk 서버 설정 페이지
//  - 처음: DB 정보(SAKI 와 같은 카페24 DB 를 써도 됨, 표 이름이 talk_ 로 달라 섞이지 않음)와 관리자 이름·비밀번호를 넣으면
//    설정 파일(웹에서 안 열리는 곳)과 표를 만든다. 올린 지 24시간 안에만 처음 설정을 할 수 있다 (남이 먼저 설정하는 것을 막는 안전장치)
//  - 설정 후: 관리자 비밀번호로 들어와 서버 상태를 보고, 사진·영상 보관 설정을 바꾼다 (그룹·초대 코드는 1단계에서 이 화면에 더함)
declare(strict_types=1);
define('TALK', true);
require __DIR__ . '/lib/core.php';

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
        page_head('S.A.K.I Talk 처음 설정');
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
$act = (string)($_POST['act'] ?? '');
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
            $msg = '관리자 비밀번호를 바꿨어요.';
        }
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

page_head('S.A.K.I Talk 관리');
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
?>
<fieldset><legend>서버 상태</legend>
<p>웹앱 주소 <code><?= h($base) ?></code></p>
<p class="hint">관리자 <?= h((string)$cfg['admin_name']) ?> · 서버 버전 <?= TALK_SERVER_VERSION ?> · DB 연결 정상<?= is_array($deploy) ? ' · 배포 ' . h(substr((string)($deploy['sha'] ?? ''), 0, 7)) . ' (' . h((string)($deploy['at'] ?? '')) . ')' : '' ?></p>
<p class="hint">그룹 만들기와 초대 코드는 다음 업데이트(1단계)에서 이 화면에 생겨요.</p>
</fieldset>

<fieldset><legend>사진·영상 보관</legend>
<form method="post"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="act" value="media">
<label>전체 상한 (MB, 넘으면 오래된 것부터 지움) <input name="limit" type="number" value="<?= (int)$cfg['media_limit_mb'] ?>" min="50" max="5000"></label>
<label>사진 보관 (일) <input name="photo" type="number" value="<?= (int)$cfg['photo_days'] ?>" min="1" max="365"></label>
<label>영상 보관 (일) <input name="video" type="number" value="<?= (int)$cfg['video_days'] ?>" min="1" max="365"></label>
<button type="submit">바꾸기</button></form>
</fieldset>

<fieldset><legend>관리자 비밀번호 바꾸기</legend>
<form method="post" autocomplete="off"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="act" value="password">
<label>새 비밀번호 <input name="pw" type="password" required minlength="8"></label>
<label>한 번 더 <input name="pw2" type="password" required minlength="8"></label>
<button type="submit">바꾸기</button></form>
</fieldset>

<form method="post"><input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="act" value="logout"><button type="submit">관리 화면 나가기</button></form>
<?php
page_foot();

function page_head(string $title): void {
    echo '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>' . h($title) . '</title><style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1c1f24;--dim:#69707a;--ok:#1f8f4e;--bad:#c62828;--acc:#3b6cf6;--line:#e3e6ea}
@media (prefers-color-scheme:dark){:root{--bg:#15171b;--card:#1f2228;--fg:#eceef1;--dim:#9aa1ab;--ok:#5fd18d;--bad:#ff8a80;--acc:#7b9cff;--line:#2e333b}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:600px;margin:0 auto} h1{font-size:20px} fieldset{margin:12px 0;border:1px solid var(--line);border-radius:12px;background:var(--card)} legend{color:var(--acc);font-weight:600}
label{display:block;margin:8px 0;color:var(--dim)}
input{display:block;width:100%;box-sizing:border-box;margin-top:3px;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
button{font:inherit;cursor:pointer;color:#fff;background:var(--acc);border:0;border-radius:8px;padding:8px 16px;font-weight:600;margin-top:6px}
.hint{color:var(--dim);font-size:13px} .ok{color:var(--ok)} .err{color:var(--bad)} code{background:var(--bg);padding:2px 6px;border-radius:6px;user-select:all}
</style></head><body><main><h1>' . h($title) . '</h1>';
}
function page_foot(): void { echo '</main></body></html>'; }
