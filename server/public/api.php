<?php
// S.A.K.I Talk 서버 API
// 주소: /talk/api.php/<경로>  (PATH_INFO 가 안 되는 서버면 /talk/api.php?r=<경로>)
// 공유 호스팅에서 막히기 쉬운 PUT/DELETE 와 Authorization 헤더는 쓰지 않는다: 쓰기는 모두 POST, 인증은 X-Talk-Token.
declare(strict_types=1);
define('TALK', true);
require __DIR__ . '/lib/core.php';

header('X-Robots-Tag: noindex');

$route = trim((string)($_SERVER['PATH_INFO'] ?? ($_GET['r'] ?? '')), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$cfg = talk_config();
if ($route === 'health') {
    $out = ['ok' => true, 'name' => 'S.A.K.I Talk', 'version' => TALK_SERVER_VERSION, 'configured' => $cfg !== null];
    if ($cfg !== null) {
        try {
            talk_migrate_if_needed(talk_db($cfg));
            $out['db'] = true;
        } catch (Throwable $e) {
            $out['db'] = false;
        }
    }
    talk_json($out);
}
if ($cfg === null) talk_fail('아직 설정하지 않았어요. setup.php 를 먼저 열어 주세요.', 503);

try {
    $pdo = talk_db($cfg);
    talk_migrate_if_needed($pdo);
} catch (Throwable $e) {
    talk_fail('DB 에 연결하지 못했어요.', 500);
}

talk_fail('없는 주소예요.', 404);
