<?php
// 한글 맞춤법 검사: 아이폰이 웹 화면의 한글은 맞춤법을 안 봐 줘서 서버가 대신 묻는다.
// 다음(카카오) 맞춤법 검사기 → 안 되면 네이버 맞춤법 검사기. 둘 다 정식 API 가 아니라 화면을 읽는 방식이라
// 모양이 바뀌면 빈 결과를 돌려준다(입력칸은 그냥 조용). 같은 글은 7일 동안 다시 묻지 않음 (talk_spell_cache).
// 돌려주는 것: 조각 목록 [{t: "그대로인 글"}, {from: "틀린 말", to: "고칠 말"}, ...] — 이어 붙이면 원래 글/고친 글이 된다.
defined('TALK') || exit;

const TALK_SPELL_MAX = 500;      // 이보다 긴 글은 앞부분만 검사 (네이버는 주소 길이 한도가 있음)
const TALK_SPELL_TIMEOUT = 4;
const TALK_SPELL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function talk_spell_urls(): array {
    $t = (string)getenv('TALK_SPELL_TEST_URL');
    if ($t !== '') return ['daum' => $t . 'daum', 'naver_key' => $t . 'naver-key', 'naver' => $t . 'naver'];
    return [
        'daum' => 'https://dic.daum.net/grammar_checker.do',
        'naver_key' => 'https://search.naver.com/search.naver?query=%EB%A7%9E%EC%B6%A4%EB%B2%95+%EA%B2%80%EC%82%AC%EA%B8%B0',
        'naver' => 'https://m.search.naver.com/p/csearch/ocontent/util/SpellerProxy',
    ];
}

function talk_spell_check(PDO $pdo, string $text): array {
    $text = mb_substr(str_replace("\r", '', $text), 0, TALK_SPELL_MAX);
    if (trim($text) === '' || !preg_match('/[가-힣]/u', $text)) return [['t' => $text]];
    $h = sha1($text);
    $st = $pdo->prepare('SELECT segs FROM talk_spell_cache WHERE h = ? AND at > NOW() - INTERVAL 7 DAY');
    $st->execute([$h]);
    $hit = $st->fetchColumn();
    if ($hit !== false) return json_decode((string)$hit, true) ?: [['t' => $text]];

    $fixes = talk_spell_daum($text);
    if ($fixes === null) $fixes = talk_spell_naver($pdo, $text);
    if ($fixes === null) return [['t' => $text]];   // 둘 다 안 됨: 기억하지 않고 다음에 다시
    $segs = talk_spell_segments($text, $fixes);
    $pdo->prepare('INSERT INTO talk_spell_cache (h, segs, at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE segs = VALUES(segs), at = NOW()')
        ->execute([$h, json_encode($segs, JSON_UNESCAPED_UNICODE)]);
    if (random_int(1, 50) === 1) $pdo->exec('DELETE FROM talk_spell_cache WHERE at < NOW() - INTERVAL 7 DAY');
    return $segs;
}

// 고칠 곳들을 글 안에서 앞에서부터 차례로 찾아 조각으로 나눈다 (못 찾은 것은 버림)
function talk_spell_segments(string $text, array $fixes): array {
    $segs = [];
    $off = 0;
    foreach ($fixes as [$from, $to]) {
        if ($from === '' || $from === $to) continue;
        $i = strpos($text, $from, $off);
        if ($i === false) continue;
        if ($i > $off) $segs[] = ['t' => substr($text, $off, $i - $off)];
        $segs[] = ['from' => $from, 'to' => $to];
        $off = $i + strlen($from);
    }
    if ($off < strlen($text)) $segs[] = ['t' => substr($text, $off)];
    return $segs;
}

function talk_spell_http(string $url, ?string $post = null, array $headers = []): ?string {
    if (!function_exists('curl_init')) return null;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => TALK_SPELL_TIMEOUT,
        CURLOPT_USERAGENT => TALK_SPELL_UA,
        CURLOPT_HTTPHEADER => array_merge(['Accept-Language: ko-KR,ko;q=0.9'], $headers),
        CURLOPT_ENCODING => '',
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    ]);
    if ($post !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $post);
    }
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ($body === false || $code !== 200) ? null : (string)$body;
}

function talk_spell_attr(string $tag, string $name): string {
    return preg_match('/\b' . preg_quote($name, '/') . '="([^"]*)"/', $tag, $m) ? html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8') : '';
}

// 다음: POST sentence= → 틀린 곳마다 data-error-input / data-error-output 이 붙은 태그. null = 검사기를 못 씀
function talk_spell_daum(string $text): ?array {
    $body = talk_spell_http(talk_spell_urls()['daum'], http_build_query(['sentence' => $text]), ['Content-Type: application/x-www-form-urlencoded']);
    if ($body === null || !str_contains($body, '맞춤법 검사기 본문')) return null;
    preg_match_all('/<[^>]*data-error-input="[^>]*>/u', $body, $tags);
    $out = [];
    foreach ($tags[0] as $tag) $out[] = [talk_spell_attr($tag, 'data-error-input'), talk_spell_attr($tag, 'data-error-output')];
    return $out;
}

// 네이버: 검색 화면에서 passportKey 를 얻어(talk_meta 에 보관, 안 맞으면 한 번 새로) SpellerProxy 를 부름
function talk_spell_naver(PDO $pdo, string $text): ?array {
    $urls = talk_spell_urls();
    for ($try = 0; $try < 2; $try++) {
        $key = $try === 0 ? talk_meta_get($pdo, 'spell_naver_key') : null;
        if (!$key) {
            $page = talk_spell_http($urls['naver_key']);
            if ($page === null || !preg_match('/passportKey=([a-f0-9]+)/', $page, $m)) return null;
            $key = $m[1];
            talk_meta_set($pdo, 'spell_naver_key', $key);
        }
        $body = talk_spell_http($urls['naver'] . '?' . http_build_query(['_callback' => 'jQuery', 'q' => $text, 'where' => 'nexearch', 'color_blindness' => 0, 'passportKey' => $key]),
            null, ['Referer: https://search.naver.com/']);
        if ($body === null) return null;
        if (str_contains($body, '유효한 키가 아닙니다')) { talk_meta_set($pdo, 'spell_naver_key', ''); continue; }
        $a = strpos($body, '(');
        $b = strrpos($body, ')');
        $json = ($a !== false && $b > $a) ? json_decode(substr($body, $a + 1, $b - $a - 1), true) : null;
        $res = $json['message']['result'] ?? null;
        if (!is_array($res)) return null;
        if ((int)($res['errata_count'] ?? 0) === 0) return [];
        preg_match_all("/<span class='result_underline'>(.*?)<\/span>/su", (string)($res['origin_html'] ?? ''), $from);
        preg_match_all("/<em class='[a-z]+_text'>(.*?)<\/em>/su", (string)($res['html'] ?? ''), $to);
        $out = [];
        $dec = fn(string $s) => html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $s)), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        for ($i = 0, $n = min(count($from[1]), count($to[1])); $i < $n; $i++) $out[] = [$dec($from[1][$i]), $dec($to[1][$i])];
        return $out;
    }
    return null;
}
