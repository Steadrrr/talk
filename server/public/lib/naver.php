<?php
// 네이버 지도 (네이버 클라우드 Maps): 위치 보내기에 쓸 Client ID·Secret
//  - 열쇠는 설정 파일의 naver_map_id·naver_map_secret 에만. 서버에서 네이버로만 보내고 앱·응답·로그에는 내보내지 않는다 (관리 화면은 ID 끝 4자만)
//  - 무료 이용량은 대표 계정 하나에 매달 (Reverse Geocoding 300만 건 등). 요금은 네이버 클라우드 콘솔에서 본다

const TALK_NAVER_URL = 'https://maps.apigw.ntruss.com/';

function talk_naver_test_url(): string { return (string)getenv('TALK_NAVER_TEST_URL'); }

function talk_naver_ready(array $cfg): bool {
    return (string)($cfg['naver_map_id'] ?? '') !== '' && (string)($cfg['naver_map_secret'] ?? '') !== '';
}

// 좌표 → "서울특별시 중구 태평로1가" 같은 읍면동까지의 이름. [HTTP 상태, 이름 또는 null, 오류 글]
function talk_naver_place(array $cfg, float $lat, float $lng, int $timeout = 8): array {
    $q = http_build_query(['coords' => sprintf('%.7F,%.7F', $lng, $lat), 'orders' => 'legalcode,admcode', 'output' => 'json']);
    $ch = curl_init((talk_naver_test_url() ?: TALK_NAVER_URL) . 'map-reversegeocode/v2/gc?' . $q);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['x-ncp-apigw-api-key-id: ' . ($cfg['naver_map_id'] ?? ''), 'x-ncp-apigw-api-key: ' . ($cfg['naver_map_secret'] ?? '')],
        CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => talk_naver_test_url() !== '' ? CURLPROTO_HTTP | CURLPROTO_HTTPS : CURLPROTO_HTTPS,
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = $raw === false ? curl_error($ch) : '';
    curl_close($ch);
    $res = is_string($raw) ? json_decode($raw, true) : null;
    if ($code !== 200 || !is_array($res)) return [$code, null, $err ?: (string)($res['error']['message'] ?? $res['status']['message'] ?? '')];
    foreach ($res['results'] ?? [] as $r) {
        $parts = [];
        foreach (['area1', 'area2', 'area3'] as $a) {
            $n = trim((string)($r['region'][$a]['name'] ?? ''));
            if ($n !== '') $parts[] = $n;
        }
        if ($parts) return [200, implode(' ', $parts), ''];
    }
    return [200, null, '이 자리의 주소가 없어요 (바다나 나라 밖일 수 있어요).'];
}

// 관리 화면 "확인": 서울시청 좌표로 한 번 불러 본다
function talk_naver_check(PDO $pdo, array $cfg): string {
    [$code, $place, $err] = talk_naver_place($cfg, 37.5666103, 126.9783882);
    if ($code === 200 && $place !== null) $s = "잘 됨 (서울시청 → $place)";
    elseif ($code === 401) $s = 'Client ID 나 Secret 이 맞지 않아요. 네이버 클라우드 콘솔의 Application 인증 정보를 다시 확인해 주세요.';
    elseif ($code === 403 || $code === 429) $s = "HTTP $code: Application 에 Reverse Geocoding 이 체크돼 있는지, 이용 신청이 끝났는지 확인해 주세요. $err";
    elseif ($code === 0) $s = '네이버에 연결하지 못했어요: ' . $err;
    else $s = "HTTP $code $err";
    foreach (['naver_map_id', 'naver_map_secret'] as $k) if ((string)($cfg[$k] ?? '') !== '') $s = str_replace((string)$cfg[$k], '(열쇠)', $s);
    talk_meta_set($pdo, 'naver_status', json_encode(['at' => talk_now(), 'text' => mb_substr($s, 0, 300)], JSON_UNESCAPED_UNICODE));
    return $s;
}
