<?php
// 네이버 지도·장소: 위치 보내기(동 이름·지도 사진)와 장소 검색
//  - 지도 열쇠: 네이버 클라우드 Maps 의 Client ID·Secret (naver_map_id·naver_map_secret). Reverse Geocoding·Geocoding·Static Map
//  - 검색 열쇠: 네이버 클라우드 NAVER API HUB 의 지역 검색 Client ID·Secret (naver_search_id·naver_search_secret). 가게·건물 이름으로 찾기
//    (개발자센터 검색 API 는 2026-07-31 부터 새로 신청이 막혀서 API HUB 로. 머리는 Maps 와 같은 x-ncp-apigw-*)
//  - 열쇠는 설정 파일에만. 서버에서 네이버로만 보내고 앱·응답·로그에는 내보내지 않는다 (관리 화면은 ID 끝 4자만)
//  - 무료 이용량: Maps 는 대표 계정 하나에 매달 (Reverse Geocoding·Geocoding·Static Map 각 300만 건), API HUB 검색은 하루 25,000건
//  - 장소 메시지(kind 'place') 본문: {lat, lng, name, addr, road, cat, here, map}. map 은 지도 사진 열쇠(talk_maps), 못 받았으면 null

const TALK_NAVER_URL = 'https://maps.apigw.ntruss.com/';
const TALK_NAVER_SEARCH_URL = 'https://naverapihub.apigw.ntruss.com/';

function talk_naver_test_url(): string { return (string)getenv('TALK_NAVER_TEST_URL'); }

function talk_naver_ready(array $cfg): bool {
    return (string)($cfg['naver_map_id'] ?? '') !== '' && (string)($cfg['naver_map_secret'] ?? '') !== '';
}
function talk_naver_search_ready(array $cfg): bool {
    return (string)($cfg['naver_search_id'] ?? '') !== '' && (string)($cfg['naver_search_secret'] ?? '') !== '';
}

// 네이버 부르기 (GET). $which: 'map' (Maps) 또는 'search' (API HUB). [HTTP 상태, 응답 글, 오류 글]
function talk_naver_get(array $cfg, string $which, string $path, array $query, int $timeout = 8): array {
    $test = talk_naver_test_url();
    $base = $test ?: ($which === 'map' ? TALK_NAVER_URL : TALK_NAVER_SEARCH_URL);
    $k = $which === 'map' ? 'naver_map_' : 'naver_search_';
    $head = ['x-ncp-apigw-api-key-id: ' . ($cfg[$k . 'id'] ?? ''), 'x-ncp-apigw-api-key: ' . ($cfg[$k . 'secret'] ?? '')];
    // Static Map 은 Application 에 넣은 Web 서비스 URL 과 맞춰 보는 경우가 있어서 우리 주소를 같이 보냄
    $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($host !== '') $head[] = "Referer: https://$host/";
    $ch = curl_init($base . $path . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $head,
        CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => $test !== '' ? CURLPROTO_HTTP | CURLPROTO_HTTPS : CURLPROTO_HTTPS,
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = $raw === false ? curl_error($ch) : '';
    curl_close($ch);
    return [$code, is_string($raw) ? $raw : '', $err];
}

// 오류 응답에서 사람이 읽을 말 (열쇠는 빼고)
function talk_naver_error(array $cfg, int $code, string $raw, string $err): string {
    $j = json_decode($raw, true);
    $s = $err ?: (string)($j['error']['message'] ?? $j['errorMessage'] ?? $j['status']['message'] ?? '');
    foreach (['naver_map_id', 'naver_map_secret', 'naver_search_id', 'naver_search_secret'] as $k) if ((string)($cfg[$k] ?? '') !== '') $s = str_replace((string)$cfg[$k], '(열쇠)', $s);
    return mb_substr($s, 0, 200);
}

// 좌표 → 주소. ['area' => '서울특별시 중구 태평로1가', 'dong' => '태평로1가', 'addr' => 지번 주소, 'road' => 도로명 주소]
//  못 찾으면 null + 상태 (관리 화면 확인용 [$code, $err])
function talk_naver_reverse(array $cfg, float $lat, float $lng, ?array &$why = null): ?array {
    [$code, $raw, $err] = talk_naver_get($cfg, 'map', 'map-reversegeocode/v2/gc', ['coords' => sprintf('%.7F,%.7F', $lng, $lat), 'orders' => 'legalcode,addr,roadaddr', 'output' => 'json']);
    $why = [$code, $code === 200 ? '' : talk_naver_error($cfg, $code, $raw, $err)];
    $res = json_decode($raw, true);
    if ($code !== 200 || !is_array($res)) return null;
    $out = ['area' => '', 'dong' => '', 'addr' => '', 'road' => ''];
    foreach ($res['results'] ?? [] as $r) {
        $g = $r['region'] ?? [];
        $n = fn($a) => trim((string)($g[$a]['name'] ?? ''));
        $land = $r['land'] ?? [];
        $num = trim((string)($land['number1'] ?? '')) . (trim((string)($land['number2'] ?? '')) !== '' ? '-' . trim((string)$land['number2']) : '');
        $join = fn(array $p) => implode(' ', array_filter(array_map('trim', $p), fn($s) => $s !== ''));
        $kind = (string)($r['name'] ?? '');
        if ($kind === 'legalcode') {
            $out['area'] = $join([$n('area1'), $n('area2'), $n('area3'), $n('area4')]);
            $out['dong'] = $n('area4') !== '' ? $n('area4') : $n('area3');
        } elseif ($kind === 'addr') {
            $out['addr'] = $join([$n('area1'), $n('area2'), $n('area3'), $n('area4'), (($land['type'] ?? '') === '2' ? '산 ' : '') . $num]);
        } elseif ($kind === 'roadaddr') {
            $bld = trim((string)($land['addition0']['value'] ?? ''));
            $out['road'] = $join([$n('area1'), $n('area2'), (string)($land['name'] ?? ''), $num]) . ($bld !== '' ? " ($bld)" : '');
        }
    }
    if ($out['area'] === '' && $out['addr'] !== '') $out['area'] = $out['addr'];
    if ($out['area'] === '') { $why = [200, '이 자리의 주소가 없어요 (바다나 나라 밖일 수 있어요).']; return null; }
    return $out;
}

// 지도 사진 (가운데 핀 하나). JPEG 글 또는 null
function talk_naver_static(array $cfg, float $lat, float $lng): ?string {
    $pos = sprintf('%.7F %.7F', $lng, $lat);
    [$code, $raw] = talk_naver_get($cfg, 'map', 'map-static/v2/raster', [
        'w' => 400, 'h' => 200, 'scale' => 2, 'level' => 16, 'format' => 'jpg', 'lang' => 'ko',
        'center' => sprintf('%.7F,%.7F', $lng, $lat), 'markers' => "type:d|size:mid|pos:$pos",
    ], 10);
    if ($code !== 200 || talk_photo_type($raw) === null || strlen($raw) > 2_000_000) return null;
    return $raw;
}

// 장소 검색: 가게·건물 이름(검색 API 지역, 5개까지) + 주소(Geocoding, 3개까지)
//  [{name, cat, addr, road, tel, lat, lng}]
function talk_place_search(array $cfg, string $q): array {
    $q = trim(mb_substr(preg_replace('/\s+/u', ' ', $q), 0, 60));
    if ($q === '') return [];
    if (!talk_naver_search_ready($cfg) && !talk_naver_ready($cfg)) talk_fail('관리 화면에 네이버 열쇠가 없어서 장소를 찾을 수 없어요.', 503);
    $out = [];
    $clean = fn($s) => trim(html_entity_decode(strip_tags((string)$s), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    if (talk_naver_search_ready($cfg)) {
        [$code, $raw, $err] = talk_naver_get($cfg, 'search', 'search/v1/local', ['query' => $q, 'display' => 5, 'start' => 1, 'sort' => 'random']);
        $res = json_decode($raw, true);
        if ($code === 200 && is_array($res)) {
            foreach ($res['items'] ?? [] as $it) {
                $x = (float)($it['mapx'] ?? 0); $y = (float)($it['mapy'] ?? 0);
                // WGS84. 정수 글(× 10,000,000)로 오면 나눔
                if (abs($x) > 1000) { $x /= 1e7; $y /= 1e7; }
                if (!talk_place_ok($y, $x)) continue;
                $out[] = ['name' => mb_substr($clean($it['title'] ?? ''), 0, 60), 'cat' => mb_substr($clean($it['category'] ?? ''), 0, 40),
                    'addr' => mb_substr($clean($it['address'] ?? ''), 0, 120), 'road' => mb_substr($clean($it['roadAddress'] ?? ''), 0, 120),
                    'tel' => mb_substr($clean($it['telephone'] ?? ''), 0, 20), 'lat' => round($y, 7), 'lng' => round($x, 7)];
            }
        } elseif (!talk_naver_ready($cfg)) {
            talk_fail('장소를 찾지 못했어요: ' . ($code === 401 ? '검색 열쇠가 맞지 않아요.' : "HTTP $code " . talk_naver_error($cfg, $code, $raw, $err)), 502);
        }
    }
    if (talk_naver_ready($cfg)) {
        [$code, $raw] = talk_naver_get($cfg, 'map', 'map-geocode/v2/geocode', ['query' => $q]);
        $res = json_decode($raw, true);
        if ($code === 200 && is_array($res)) {
            foreach (array_slice($res['addresses'] ?? [], 0, 3) as $a) {
                $lat = (float)($a['y'] ?? 0); $lng = (float)($a['x'] ?? 0);
                if (!talk_place_ok($lat, $lng)) continue;
                $road = $clean($a['roadAddress'] ?? ''); $jibun = $clean($a['jibunAddress'] ?? '');
                $out[] = ['name' => mb_substr($road ?: $jibun, 0, 60), 'cat' => '주소', 'addr' => mb_substr($jibun, 0, 120), 'road' => mb_substr($road, 0, 120),
                    'tel' => '', 'lat' => round($lat, 7), 'lng' => round($lng, 7)];
            }
        }
    }
    return $out;
}

function talk_place_ok(float $lat, float $lng): bool {
    return $lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180 && !($lat == 0.0 && $lng == 0.0);
}

// 보내기 전 미리 보기: 지금 자리의 주소
function talk_place_lookup(array $cfg, float $lat, float $lng): array {
    if (!talk_place_ok($lat, $lng)) talk_fail('위치가 이상해요.');
    if (!talk_naver_ready($cfg)) return ['area' => '', 'dong' => '', 'addr' => '', 'road' => ''];
    return talk_naver_reverse($cfg, $lat, $lng) ?? ['area' => '', 'dong' => '', 'addr' => '', 'road' => ''];
}

// 위치·장소 보내기. here: 내 위치 (이름은 서버가 동 이름으로), 아니면 검색에서 고른 장소
function talk_place_send(PDO $pdo, array $cfg, int $uid, array $b): array {
    $roomId = (int)($b['room_id'] ?? 0);
    if (!talk_room_member($pdo, $uid, $roomId)) talk_fail('이 방에 들어가 있지 않아요.', 403);
    $lat = (float)($b['lat'] ?? 0); $lng = (float)($b['lng'] ?? 0);
    if (!talk_place_ok($lat, $lng)) talk_fail('위치가 이상해요.');
    $clientId = (string)($b['client_id'] ?? '');
    // 재전송이면 지도를 다시 받지 않게 먼저 확인 (talk_media_post 가 처음 것을 돌려줌)
    if (preg_match('/^[A-Za-z0-9_-]{8,40}$/', $clientId)) {
        $st = $pdo->prepare('SELECT * FROM talk_messages WHERE user_id = ? AND client_id = ?');
        $st->execute([$uid, $clientId]);
        if ($old = $st->fetch()) return talk_decorate($pdo, [talk_msg_view($old)])[0];
    }
    $here = !empty($b['here']);
    $s = fn($k, $n) => mb_substr(trim(preg_replace('/\s+/u', ' ', (string)($b[$k] ?? ''))), 0, $n);
    $body = ['lat' => round($lat, 7), 'lng' => round($lng, 7), 'name' => $here ? '' : $s('name', 60), 'addr' => $here ? '' : $s('addr', 120),
        'road' => $here ? '' : $s('road', 120), 'cat' => $here ? '' : $s('cat', 40), 'here' => $here, 'map' => null];
    if (!$here && $body['name'] === '') talk_fail('장소 이름이 없어요.');
    if (talk_naver_ready($cfg)) {
        if ($here || ($body['addr'] === '' && $body['road'] === '')) {
            $r = talk_naver_reverse($cfg, $lat, $lng);
            if ($r) {
                if ($here) $body['name'] = $r['area'];
                $body['addr'] = $r['addr'] ?: $r['area'];
                $body['road'] = $r['road'];
            }
        }
        if (($img = talk_naver_static($cfg, $lat, $lng)) !== null) {
            $key = bin2hex(random_bytes(12));
            $pdo->prepare('INSERT INTO talk_maps (mkey, data, created_at) VALUES (?, ?, ?)')->execute([$key, $img, talk_now()]);
            $body['map'] = $key;
        }
    }
    if ($here && $body['name'] === '') $body['name'] = '내 위치';
    $text = $here ? '위치를 보냈어요: ' . $body['name'] : '장소를 보냈어요: ' . $body['name'];
    return talk_media_post($pdo, $cfg, $uid, $roomId, 'place', $body, [], $clientId, $text);
}

// 장소 메시지 본문들의 지도 사진 열쇠
function talk_map_keys(array $bodies): array {
    $keys = [];
    foreach ($bodies as $b) {
        $k = json_decode((string)$b, true)['map'] ?? null;
        if (is_string($k) && preg_match('/^[a-f0-9]{24}$/', $k)) $keys[$k] = true;
    }
    return array_keys($keys);
}
// 지도 사진은 아무 장소 메시지도 안 쓰게 되면 지움 (전달한 곳은 같은 열쇠를 같이 씀)
function talk_maps_release(PDO $pdo, array $keys): void {
    $used = $pdo->prepare("SELECT 1 FROM talk_messages WHERE kind = 'place' AND body LIKE ? LIMIT 1");
    $del = $pdo->prepare('DELETE FROM talk_maps WHERE mkey = ?');
    foreach ($keys as $k) {
        $used->execute(['%"map":"' . $k . '"%']);
        if (!$used->fetchColumn()) $del->execute([$k]);
    }
}

// 지도 사진 내려 주기 (로그인 없이 무작위 열쇠로: <img> 는 머리를 못 붙임)
function talk_map_serve(PDO $pdo, string $key): never {
    $st = $pdo->prepare('SELECT data FROM talk_maps WHERE mkey = ?');
    $st->execute([$key]);
    $data = $st->fetchColumn();
    if (!$data) talk_fail('지도가 없어요.', 404);
    header('Content-Type: ' . (talk_photo_type($data) ?? 'application/octet-stream'));
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Content-Length: ' . strlen($data));
    echo $data;
    exit;
}

// 관리 화면 "확인": 서울시청 좌표로 지도 열쇠를, "서울시청" 으로 검색 열쇠를 한 번 불러 본다
function talk_naver_check(PDO $pdo, array $cfg): string {
    $place = talk_naver_reverse($cfg, 37.5666103, 126.9783882, $why);
    [$code, $err] = $why;
    if ($place !== null) $s = "잘 됨 (서울시청 → {$place['area']})";
    elseif ($code === 401) $s = 'Client ID 나 Secret 이 맞지 않아요. 네이버 클라우드 콘솔의 Application 인증 정보를 다시 확인해 주세요.';
    elseif ($code === 403 || $code === 429) $s = "HTTP $code: Application 에 Reverse Geocoding 이 체크돼 있는지, 이용 신청이 끝났는지 확인해 주세요. $err";
    elseif ($code === 0) $s = '네이버에 연결하지 못했어요: ' . $err;
    else $s = "HTTP $code $err";
    if ($place !== null) $s .= talk_naver_static($cfg, 37.5666103, 126.9783882) !== null ? ' · 지도 사진 잘 됨' : ' · 지도 사진은 안 됨 (Application 에 Static Map 체크와 Web 서비스 URL 확인)';
    talk_meta_set($pdo, 'naver_status', json_encode(['at' => talk_now(), 'text' => mb_substr($s, 0, 300)], JSON_UNESCAPED_UNICODE));
    return $s;
}

function talk_naver_search_check(PDO $pdo, array $cfg): string {
    [$code, $raw, $err] = talk_naver_get($cfg, 'search', 'search/v1/local', ['query' => '서울시청', 'display' => 1]);
    $res = json_decode($raw, true);
    if ($code === 200 && is_array($res)) $s = '잘 됨 ("서울시청" 검색 ' . count($res['items'] ?? []) . '개)';
    elseif ($code === 401) $s = 'Client ID 나 Secret 이 맞지 않아요. 네이버 클라우드 콘솔 NAVER API HUB → Application 의 인증 정보를 다시 확인해 주세요.';
    elseif ($code === 403) $s = 'HTTP 403: Application 에 "지역 검색" 이 체크돼 있는지, API HUB 이용 신청이 끝났는지 확인해 주세요. ' . talk_naver_error($cfg, $code, $raw, $err);
    elseif ($code === 0) $s = '네이버에 연결하지 못했어요: ' . $err;
    else $s = "HTTP $code " . talk_naver_error($cfg, $code, $raw, $err);
    talk_meta_set($pdo, 'naver_search_status', json_encode(['at' => talk_now(), 'text' => mb_substr($s, 0, 300)], JSON_UNESCAPED_UNICODE));
    return $s;
}
