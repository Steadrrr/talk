<?php
// S.A.K.I Talk 서버 공통: 설정 읽기, DB, 표 만들기, JSON 응답
// SAKI 와 같은 카페24 계정·DB 를 쓰므로 표 이름은 모두 talk_ 로 시작하고, 설정 파일도 따로 둔다 (/talk-private/).
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_SERVER_VERSION = 1;

// 설정 파일(DB 비밀번호)이 있는 폴더. 공개 폴더에는 그 "위치"만 적어 둔다 (config-path.php)
function talk_private_dir(): ?string {
    $p = dirname(__DIR__) . '/config-path.php';
    if (!is_file($p)) return null;
    $d = require $p;
    return is_string($d) && is_dir($d) ? $d : null;
}

function talk_config(): ?array {
    $d = talk_private_dir();
    if ($d === null || !is_file("$d/config.php")) return null;
    $c = require "$d/config.php";
    if (!is_array($c)) return null;
    $c['private_dir'] = $d;
    return $c + [
        'media_limit_mb' => 400, // 사진·영상 전체 상한 (넘으면 오래된 것부터 지움)
        'photo_days' => 14,
        'video_days' => 3,
    ];
}

function talk_write_config(string $dir, array $cfg): void {
    unset($cfg['private_dir']);
    $php = "<?php\n// S.A.K.I Talk 서버 설정 — DB 비밀번호가 들어 있어요. 다른 사람에게 보여 주지 마세요.\nreturn " . var_export($cfg, true) . ";\n";
    $tmp = "$dir/config.php.tmp";
    if (file_put_contents($tmp, $php, LOCK_EX) === false) throw new RuntimeException('설정 파일을 쓸 수 없어요.');
    @chmod($tmp, 0600);
    rename($tmp, "$dir/config.php");
    talk_forget_cached("$dir/config.php");
}

// PHP 코드 캐시(OPcache)가 켜진 서버에서는 방금 바꾼 .php 설정 파일 대신 캐시된 예전 내용을 몇 초간 읽을 수 있다
function talk_forget_cached(string $file): void {
    if (function_exists('opcache_invalidate')) @opcache_invalidate($file, true);
    clearstatcache(true, $file);
}

function talk_db(array $cfg): PDO {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'],
        $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false],
    );
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

// 표 만들기. 단계가 늘면 여기에 CREATE TABLE IF NOT EXISTS 를 더한다 (서버 업데이트 후 첫 요청에서 저절로 생김)
function talk_migrate(PDO $pdo): void {
    $q = [
        "CREATE TABLE IF NOT EXISTS talk_meta (k VARCHAR(64) PRIMARY KEY, v MEDIUMTEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ];
    foreach ($q as $sql) $pdo->exec($sql);
    talk_meta_set($pdo, 'schema', (string)TALK_SERVER_VERSION);
}

function talk_meta_get(PDO $pdo, string $k): ?string {
    $st = $pdo->prepare('SELECT v FROM talk_meta WHERE k = ?');
    $st->execute([$k]);
    $v = $st->fetchColumn();
    return $v === false ? null : (string)$v;
}

function talk_meta_set(PDO $pdo, string $k, string $v): void {
    $pdo->prepare('INSERT INTO talk_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute([$k, $v]);
}

// 서버 코드가 바뀐 뒤 처음 한 번만 표를 맞춘다 (매 요청마다 CREATE TABLE 을 돌리지 않게)
function talk_migrate_if_needed(PDO $pdo): void {
    try {
        if (talk_meta_get($pdo, 'schema') === (string)TALK_SERVER_VERSION) return;
    } catch (PDOException $e) {
        // talk_meta 가 아직 없음
    }
    talk_migrate($pdo);
}

function talk_now(): string { return gmdate('Y-m-d H:i:s'); }

function talk_json(mixed $data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function talk_fail(string $msg, int $code = 400): never {
    talk_json(['ok' => false, 'error' => $msg], $code);
}

function talk_body(int $max = 100_000): array {
    $raw = file_get_contents('php://input', false, null, 0, $max + 1);
    if ($raw === false || $raw === '') return [];
    if (strlen($raw) > $max) talk_fail('요청이 너무 커요.', 413);
    $j = json_decode($raw, true);
    if (!is_array($j)) talk_fail('JSON 형식이 아니에요.');
    return $j;
}

function talk_client_ip(): string {
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64);
}
