<?php
// 웹 푸시 알림: 표준 Web Push 를 외부 라이브러리 없이 PHP openssl 로 (SAKI 의 lib/webpush.php 를 talk_ 이름으로 옮김).
//  - VAPID(RFC 8292): 서버 키는 처음 쓸 때 만들어 talk_meta 에 둔다
//  - 내용 암호화(RFC 8291, aes128gcm): 받는 기기만 열 수 있다
//  - 받는 곳은 알려진 알림 서비스 주소만 허용 (이 서버가 아무 주소로나 요청을 보내지 않게)
//  - 구독은 기기(talk_devices)마다 talk_push_subs 에. 로그아웃·끊긴 기기에는 안 보낸다
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];
// P-256 공개키를 OpenSSL 이 읽는 모양(SubjectPublicKeyInfo)으로 감쌀 때의 앞부분
const TALK_P256_SPKI = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

function talk_b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function talk_b64u_dec(string $s): string {
    $r = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
    if ($r === false) throw new RuntimeException('잘못된 base64url');
    return $r;
}

// 자동 검증용: php -S 를 띄울 때만 주는 환경 변수 (가짜 알림 서비스 주소)
function talk_push_test_prefix(): string { return (string)getenv('TALK_PUSH_TEST_PREFIX'); }

function talk_push_endpoint_ok(string $endpoint): bool {
    $test = talk_push_test_prefix();
    if ($test !== '' && str_starts_with($endpoint, $test)) return true;
    $u = parse_url($endpoint);
    if (!$u || ($u['scheme'] ?? '') !== 'https' || empty($u['host']) || isset($u['user']) || isset($u['port'])) return false;
    $host = strtolower($u['host']);
    foreach (TALK_PUSH_HOSTS as $h) if ($host === $h || str_ends_with($host, '.' . $h)) return true;
    return false;
}

// 공개키 점(65바이트, 04|x|y)
function talk_ec_point(array $details): string {
    $ec = $details['ec'];
    return "\x04" . str_pad($ec['x'], 32, "\0", STR_PAD_LEFT) . str_pad($ec['y'], 32, "\0", STR_PAD_LEFT);
}
function talk_ec_public_key(string $point) {
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode(hex2bin(TALK_P256_SPKI) . $point), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $k = openssl_pkey_get_public($pem);
    if ($k === false) throw new RuntimeException('받는 기기의 공개키가 올바르지 않아요.');
    return $k;
}
function talk_ec_new() {
    $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if ($k === false) throw new RuntimeException('이 서버의 PHP 가 타원곡선 키를 만들지 못해요 (openssl).');
    return $k;
}

// 서버 키 (없으면 만든다, talk_meta 'vapid'): ['pem' => 개인키, 'public' => base64url 공개키]
function talk_vapid(PDO $pdo): array {
    $v = json_decode((string)talk_meta_get($pdo, 'vapid'), true);
    if (is_array($v) && isset($v['pem'], $v['public'])) return $v;
    $k = talk_ec_new();
    openssl_pkey_export($k, $pem);
    $v = ['pem' => $pem, 'public' => talk_b64u(talk_ec_point(openssl_pkey_get_details($k)))];
    // 동시에 두 요청이 만들면 먼저 넣은 것을 쓴다
    $pdo->prepare("INSERT IGNORE INTO talk_meta (k, v) VALUES ('vapid', ?)")->execute([json_encode($v)]);
    return json_decode((string)talk_meta_get($pdo, 'vapid'), true);
}

// ES256 서명: OpenSSL 의 DER 서명을 JWT 가 쓰는 r|s (64바이트)로
function talk_der_to_raw(string $der): string {
    $p = 2;
    if (ord($der[1]) & 0x80) $p += ord($der[1]) & 0x7f;
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$p + 1]);
        $int = ltrim(substr($der, $p + 2, $len), "\0");
        $out .= str_pad($int, 32, "\0", STR_PAD_LEFT);
        $p += 2 + $len;
    }
    return $out;
}

function talk_vapid_header(array $vapid, string $endpoint, string $subject): string {
    $u = parse_url($endpoint);
    $origin = "{$u['scheme']}://{$u['host']}" . (isset($u['port']) ? ":{$u['port']}" : '');
    $head = talk_b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $claims = talk_b64u(json_encode(['aud' => $origin, 'exp' => time() + 12 * 3600, 'sub' => $subject], JSON_UNESCAPED_SLASHES));
    if (!openssl_sign("$head.$claims", $der, $vapid['pem'], OPENSSL_ALGO_SHA256)) throw new RuntimeException('서명하지 못했어요.');
    return "vapid t=$head.$claims." . talk_b64u(talk_der_to_raw($der)) . ", k={$vapid['public']}";
}

/**
 * RFC 8291 암호화 (aes128gcm, 레코드 하나). $ephemeral·$salt 는 검증용으로만 넘긴다.
 * @return string 보낼 본문 (머리 + 암호문)
 */
function talk_push_encrypt(string $payload, string $p256dhB64, string $authB64, $ephemeral = null, ?string $salt = null): string {
    $uaPublic = talk_b64u_dec($p256dhB64);
    $authSecret = talk_b64u_dec($authB64);
    if (strlen($uaPublic) !== 65 || $uaPublic[0] !== "\x04" || strlen($authSecret) < 16) throw new RuntimeException('받는 기기의 키가 올바르지 않아요.');
    $ephemeral ??= talk_ec_new();
    $salt ??= random_bytes(16);
    $asPublic = talk_ec_point(openssl_pkey_get_details($ephemeral));
    $ecdh = openssl_pkey_derive(talk_ec_public_key($uaPublic), $ephemeral, 32);
    if ($ecdh === false) throw new RuntimeException('키를 맞추지 못했어요.');
    $ecdh = str_pad($ecdh, 32, "\0", STR_PAD_LEFT);
    $ikm = hash_hkdf('sha256', $ecdh, 32, "WebPush: info\0" . $uaPublic . $asPublic, $authSecret);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
    $ct = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    if ($ct === false) throw new RuntimeException('암호화하지 못했어요.');
    return $salt . pack('N', 4096) . chr(65) . $asPublic . $ct . $tag;
}

// 하나 보내기 → HTTP 상태 (0 = 연결 실패)
function talk_push_send_one(array $vapid, array $sub, string $payload, string $subject, string $topic = ''): int {
    $body = talk_push_encrypt($payload, $sub['p256dh'], $sub['auth']);
    $headers = [
        'Authorization: ' . talk_vapid_header($vapid, $sub['endpoint'], $subject),
        'Content-Encoding: aes128gcm',
        'Content-Type: application/octet-stream',
        'TTL: 86400',
        'Urgency: normal',
    ];
    if ($topic !== '') $headers[] = 'Topic: ' . substr(preg_replace('/[^A-Za-z0-9_-]/', '', $topic), 0, 32);
    $ch = curl_init($sub['endpoint']);
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_PROTOCOLS => talk_push_test_prefix() !== '' ? CURLPROTO_HTTP | CURLPROTO_HTTPS : CURLPROTO_HTTPS, CURLOPT_FOLLOWLOCATION => false,
    ]);
    curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return $code;
}

// 이 서버 주소 (VAPID 의 sub: 애플은 https 주소나 mailto 를 요구)
function talk_push_subject(): string {
    $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
    return "https://$host/";
}


// 이 기기의 알림 주소 저장 (같은 주소가 다른 기기·계정에 있었으면 옮김)
function talk_push_subscribe(PDO $pdo, int $deviceId, array $b): void {
    $endpoint = (string)($b['endpoint'] ?? '');
    $p256 = (string)($b['keys']['p256dh'] ?? '');
    $auth = (string)($b['keys']['auth'] ?? '');
    if (strlen($endpoint) > 1000 || !talk_push_endpoint_ok($endpoint)) talk_fail('알림 주소가 올바르지 않아요.');
    if (!preg_match('/^[A-Za-z0-9_-]{80,100}$/', $p256) || !preg_match('/^[A-Za-z0-9_-]{16,40}$/', $auth)) talk_fail('알림 키가 올바르지 않아요.');
    $pdo->prepare('INSERT INTO talk_push_subs (device_id, endpoint, endpoint_hash, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE device_id = VALUES(device_id), p256dh = VALUES(p256dh), auth = VALUES(auth)')
        ->execute([$deviceId, $endpoint, hash('sha256', $endpoint), $p256, $auth, talk_now()]);
}

function talk_push_unsubscribe(PDO $pdo, int $deviceId, string $endpoint): void {
    if ($endpoint === '') $pdo->prepare('DELETE FROM talk_push_subs WHERE device_id = ?')->execute([$deviceId]);
    else $pdo->prepare('DELETE FROM talk_push_subs WHERE device_id = ? AND endpoint_hash = ?')->execute([$deviceId, hash('sha256', $endpoint)]);
}

// 앱을 보고 있는 기기 (최근 15초 안에 동기화했고 숨기지 않음) 에는 알림을 안 보낸다
const TALK_ACTIVE_SECONDS = 15;

// 새 메시지 알림: 방 사람 중 보낸 사람·알림 끈 방·지금 앱을 보고 있는 기기를 빼고
function talk_push_message(PDO $pdo, int $roomId, int $senderId, string $text): array {
    $out = ['sent' => 0, 'failed' => 0, 'total' => 0];
    $st = $pdo->prepare('SELECT r.kind, r.name, COALESCE(u.nick, u.name) AS who FROM talk_rooms r JOIN talk_users u ON u.id = ? WHERE r.id = ?');
    $st->execute([$senderId, $roomId]);
    $room = $st->fetch();
    if (!$room) return $out;
    $st = $pdo->prepare('SELECT s.* FROM talk_push_subs s JOIN talk_devices d ON d.id = s.device_id
        JOIN talk_room_members m ON m.user_id = d.user_id AND m.room_id = ? JOIN talk_users u ON u.id = d.user_id
        WHERE d.revoked = 0 AND u.disabled = 0 AND m.muted = 0 AND d.user_id <> ?
          AND (d.active_at IS NULL OR d.active_at < ?)');
    $st->execute([$roomId, $senderId, gmdate('Y-m-d H:i:s', time() - TALK_ACTIVE_SECONDS)]);
    $subs = $st->fetchAll();
    $out['total'] = count($subs);
    if (!$subs) return $out;
    $text = preg_replace('/\s+/u', ' ', $text);
    $payload = json_encode([
        'title' => mb_substr($room['kind'] === 'dm' ? $room['who'] : ($room['name'] ?: $room['who']), 0, 60),
        'body' => mb_substr($room['kind'] === 'dm' || !$room['name'] ? $text : "{$room['who']}: $text", 0, 200),
        'room' => $roomId,
        'tag' => "room-$roomId",
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $vapid = talk_vapid($pdo);
    $subject = talk_push_subject();
    foreach ($subs as $s) {
        try { $code = talk_push_send_one($vapid, $s, $payload, $subject, "room$roomId"); } catch (Throwable $e) { $code = 0; }
        if ($code >= 200 && $code < 300) $out['sent']++;
        else {
            $out['failed']++;
            if ($code === 404 || $code === 410) $pdo->prepare('DELETE FROM talk_push_subs WHERE id = ?')->execute([$s['id']]);
        }
    }
    return $out;
}

// 응답을 먼저 돌려보내고 (보낸 사람이 기다리지 않게) 그다음 알림을 보낸다
function talk_after_response(callable $fn): void {
    register_shutdown_function(function () use ($fn) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        ignore_user_abort(true);
        try { $fn(); } catch (Throwable $e) { error_log('talk push: ' . $e->getMessage()); }
    });
}
