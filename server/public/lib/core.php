<?php
// SAKi Talk 서버 공통: 설정 읽기, DB, 표 만들기, JSON 응답
// SAKI 와 같은 카페24 계정·DB 를 쓰므로 표 이름은 모두 talk_ 로 시작하고, 설정 파일도 따로 둔다 (/talk-private/).
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_SERVER_VERSION = 14;

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
    $php = "<?php\n// SAKi Talk 서버 설정 — DB 비밀번호가 들어 있어요. 다른 사람에게 보여 주지 마세요.\nreturn " . var_export($cfg, true) . ";\n";
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
        // 사람. 이름은 로그인 아이디라 서버 전체에서 하나
        "CREATE TABLE IF NOT EXISTS talk_users (
            id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
            is_admin TINYINT NOT NULL DEFAULT 0, disabled TINYINT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS talk_devices (
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(100) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE,
            created_at DATETIME NOT NULL, last_seen DATETIME NOT NULL, revoked TINYINT NOT NULL DEFAULT 0, INDEX (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS talk_login_fails (id INT AUTO_INCREMENT PRIMARY KEY, ip VARCHAR(64) NOT NULL, at DATETIME NOT NULL, INDEX (ip, at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        // 그룹: 같은 그룹 사람끼리만 서로 보인다
        "CREATE TABLE IF NOT EXISTS talk_groups (
            id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL, closed TINYINT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS talk_group_members (
            group_id INT NOT NULL, user_id INT NOT NULL, joined_at DATETIME NOT NULL, PRIMARY KEY (group_id, user_id), INDEX (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS talk_invites (
            id INT AUTO_INCREMENT PRIMARY KEY, group_id INT NOT NULL, code_hash CHAR(64) NOT NULL UNIQUE, code VARCHAR(16) NULL, uses_left INT NOT NULL,
            expires_at DATETIME NOT NULL, revoked TINYINT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL, INDEX (group_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        // 채팅방: dm(1:1, dm_key='작은ID:큰ID') 또는 group(여럿). 방은 한 그룹 안에 있다
        "CREATE TABLE IF NOT EXISTS talk_rooms (
            id INT AUTO_INCREMENT PRIMARY KEY, group_id INT NOT NULL, kind VARCHAR(8) NOT NULL, name VARCHAR(40) NULL,
            dm_key VARCHAR(24) NULL UNIQUE, created_by INT NOT NULL, created_at DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS talk_room_members (
            room_id INT NOT NULL, user_id INT NOT NULL, joined_at DATETIME NOT NULL, last_read_id BIGINT NOT NULL DEFAULT 0,
            muted TINYINT NOT NULL DEFAULT 0, pinned TINYINT NOT NULL DEFAULT 0, PRIMARY KEY (room_id, user_id), INDEX (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS talk_messages (
            id BIGINT AUTO_INCREMENT PRIMARY KEY, room_id INT NOT NULL, user_id INT NOT NULL, kind VARCHAR(8) NOT NULL DEFAULT 'text',
            body TEXT NOT NULL, client_id VARCHAR(40) NULL, created_at DATETIME NOT NULL,
            INDEX idx_room (room_id, id), UNIQUE KEY uq_client (user_id, client_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        // 동기화용 변경 기록: 앱은 sync?since=<마지막 번호> 로 자기 방의 새 변경만 받는다
        "CREATE TABLE IF NOT EXISTS talk_events (
            id BIGINT AUTO_INCREMENT PRIMARY KEY, room_id INT NOT NULL, kind VARCHAR(8) NOT NULL, ref_id BIGINT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL, INDEX idx_room (room_id, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ];
    // 3: 초대 코드를 관리 화면에서 언제든 다시 볼 수 있게 코드 자체도 저장 (그 전에 만든 코드는 비어 있음)
    $q[] = "ALTER TABLE talk_invites ADD COLUMN IF NOT EXISTS code VARCHAR(16) NULL AFTER code_hash";
    // 5: 이름(name)은 본명이자 로그인 아이디, 채팅에 보이는 이름은 닉네임 (비어 있으면 본명)
    $q[] = "ALTER TABLE talk_users ADD COLUMN IF NOT EXISTS nick VARCHAR(40) NULL AFTER name";
    // 6: 웹 푸시 알림. 기기마다 알림 주소, 앱을 보고 있는 기기(active_at 이 최근)에는 알림을 안 보냄
    $q[] = "CREATE TABLE IF NOT EXISTS talk_push_subs (
        id INT AUTO_INCREMENT PRIMARY KEY, device_id INT NOT NULL, endpoint TEXT NOT NULL, endpoint_hash CHAR(64) NOT NULL UNIQUE,
        p256dh VARCHAR(200) NOT NULL, auth VARCHAR(100) NOT NULL, created_at DATETIME NOT NULL, INDEX (device_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    $q[] = "ALTER TABLE talk_devices ADD COLUMN IF NOT EXISTS active_at DATETIME NULL";
    // 7: 알림은 그 방을 보고 있는 기기에만 안 보냄 (목록 화면이면 보냄)
    $q[] = "ALTER TABLE talk_devices ADD COLUMN IF NOT EXISTS active_room INT NOT NULL DEFAULT 0";
    // 8: 프로필 사진 (휴대폰에서 줄인 작은 사진을 DB 에, 주소는 바꿀 때마다 새 무작위 열쇠)
    $q[] = "ALTER TABLE talk_users ADD COLUMN IF NOT EXISTS photo MEDIUMBLOB NULL, ADD COLUMN IF NOT EXISTS photo_key VARCHAR(24) NULL";
    // 9: 채팅방 대표 사진 (방 사람 누구나 바꿈, 하나만: 새로 올리면 예전 것은 지워짐)
    $q[] = "ALTER TABLE talk_rooms ADD COLUMN IF NOT EXISTS photo MEDIUMBLOB NULL, ADD COLUMN IF NOT EXISTS photo_key VARCHAR(24) NULL, ADD COLUMN IF NOT EXISTS photo_by INT NULL";
    // 10: 사진·영상 (파일은 설정 폴더/media, 여기에는 정보와 영상 미리보기)
    $q[] = "CREATE TABLE IF NOT EXISTS talk_media (
        id INT AUTO_INCREMENT PRIMARY KEY, mkey CHAR(32) NOT NULL UNIQUE, room_id INT NOT NULL, user_id INT NOT NULL,
        kind VARCHAR(8) NOT NULL, mime VARCHAR(40) NOT NULL, size BIGINT NOT NULL, w INT NOT NULL DEFAULT 0, h INT NOT NULL DEFAULT 0,
        dur INT NOT NULL DEFAULT 0, thumb MEDIUMBLOB NULL, done TINYINT NOT NULL DEFAULT 0, deleted TINYINT NOT NULL DEFAULT 0,
        message_id BIGINT NULL, created_at DATETIME NOT NULL, INDEX (deleted, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    // 11: 기기 열쇠 (앱이 기기에 기억하는 무작위 값). 같은 기기에서 다시 로그인하면 예전 기기 줄을 끊어 쌓이지 않게
    $q[] = "ALTER TABLE talk_devices ADD COLUMN IF NOT EXISTS device_key CHAR(32) NULL, ADD INDEX IF NOT EXISTS idx_key (user_id, device_key)";
    // 12: 답장(어느 메시지에 답했는지)·반응(메시지마다 한 사람 이모지 하나)
    $q[] = "ALTER TABLE talk_messages ADD COLUMN IF NOT EXISTS reply_to BIGINT NULL";
    $q[] = "CREATE TABLE IF NOT EXISTS talk_reactions (
        message_id BIGINT NOT NULL, user_id INT NOT NULL, emoji VARCHAR(16) NOT NULL, created_at DATETIME NOT NULL,
        PRIMARY KEY (message_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    // 13: 방 공지 (방마다 글 메시지 하나를 위에 걸어 둠)
    $q[] = "ALTER TABLE talk_rooms ADD COLUMN IF NOT EXISTS notice_id BIGINT NULL, ADD COLUMN IF NOT EXISTS notice_by INT NULL";
    // 14: 입력 중 표시 (방 사람마다 마지막으로 글자를 친 시각, 몇 초 지나면 저절로 꺼짐. 변경 기록에는 안 남김)
    $q[] = "ALTER TABLE talk_room_members ADD COLUMN IF NOT EXISTS typing_at DATETIME NULL";
    foreach ($q as $sql) $pdo->exec($sql);
    // 4: 관리자는 모든 그룹에 (예전에 관리자 없이 생긴 그룹이 있을 수 있어서 한 번 맞춤)
    if (function_exists('talk_admin_in_all_groups')) talk_admin_in_all_groups($pdo);
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
