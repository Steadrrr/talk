<?php
// SAKi Talk 링크 미리보기: 글 속 첫 주소의 제목·설명·대표 사진(og:image)
//  - 보낸 사람에게 응답을 먼저 돌려준 뒤(talk_after_response) 서버가 그 페이지를 한 번 받아 <meta> 만 읽는다
//  - 결과는 talk_messages.preview(JSON)에 넣고 'msg' 변경 기록 → 모두의 화면이 다음 동기화(2초)에 카드를 붙임
//  - 같은 주소는 talk_link_previews 에 7일 (못 읽은 것은 하루) 보관해서 다시 받지 않음
//  - 사진은 서버에 저장하지 않고 그 사이트의 https 주소를 그대로 씀 (디스크·트래픽 안 씀, 앱은 referrer 없이 부름)
//  - 집 안 주소(127.*, 10.*, 192.168.* 등)로는 가지 않음
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_LINK_MAX_BYTES = 600000;   // 페이지는 앞쪽 600KB 까지만 (<head> 면 충분)
const TALK_LINK_TIMEOUT = 5;          // 초
const TALK_LINK_UA = 'Mozilla/5.0 (compatible; SAKiTalkBot/1.0; link preview; +https://talk.projectsaki.com/)';

// 글 속 첫 주소 (web/links.js 와 같은 규칙: 끝의 문장부호는 뺌, www. 로 시작하면 https://)
function talk_link_first_url(string $text): ?string {
    if (!preg_match_all('~\b(?:https?://|www\.)[A-Za-z0-9\-._\~:/?#[\]@!$&\'()*+,;=%]+~i', $text, $mm)) return null;
    foreach ($mm[0] as $u) {
        for (;;) {
            $c = substr($u, -1);
            if ($c !== '' && strpbrk($c, '.,!?;:\'"') !== false) $u = substr($u, 0, -1);
            elseif ($c === ')' && substr_count($u, '(') < substr_count($u, ')')) $u = substr($u, 0, -1);
            elseif ($c === ']' && !str_contains($u, '[')) $u = substr($u, 0, -1);
            else break;
        }
        if (strlen($u) < 5 || preg_match('~^www\.$~i', $u)) continue;
        if (stripos($u, 'www.') === 0) $u = 'https://' . $u;
        if (strlen($u) > 2000) continue;
        return $u;
    }
    return null;
}

// 보낸 뒤·고친 뒤: 응답을 돌려준 다음 미리보기를 만들어 메시지에 붙인다 (주소가 없어졌으면 뗀다)
function talk_link_preview_later(PDO $pdo, int $roomId, int $msgId, string $body): void {
    $url = talk_link_first_url($body);
    if ($url === null) {
        $u = $pdo->prepare('UPDATE talk_messages SET preview = NULL WHERE id = ? AND preview IS NOT NULL');
        $u->execute([$msgId]);
        if ($u->rowCount() > 0) talk_event($pdo, $roomId, 'msg', $msgId);
        return;
    }
    talk_after_response(function () use ($pdo, $roomId, $msgId, $body, $url) {
        $p = talk_link_preview($pdo, $url);
        $json = $p ? json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
        // 그사이 글이 또 고쳐졌으면 손대지 않음 (그때의 일이 따로 붙임)
        $u = $pdo->prepare("UPDATE talk_messages SET preview = ? WHERE id = ? AND kind = 'text' AND body = ? AND NOT (preview <=> ?)");
        $u->execute([$json, $msgId, $body, $json]);
        if ($u->rowCount() > 0) talk_event($pdo, $roomId, 'msg', $msgId);
    });
}

// 주소 하나의 미리보기 (보관해 둔 것이 있으면 그것). 읽을 것이 없으면 null
function talk_link_preview(PDO $pdo, string $url): ?array {
    $h = sha1($url);
    $st = $pdo->prepare('SELECT data, fetched_at FROM talk_link_previews WHERE uhash = ?');
    $st->execute([$h]);
    if ($row = $st->fetch()) {
        $age = time() - strtotime($row['fetched_at'] . ' UTC');
        if ($age < ($row['data'] === null ? 86400 : 7 * 86400)) return $row['data'] === null ? null : json_decode($row['data'], true);
    }
    try { $p = talk_link_fetch_preview($url); } catch (Throwable $e) { $p = null; }
    $pdo->prepare('REPLACE INTO talk_link_previews (uhash, url, data, fetched_at) VALUES (?, ?, ?, ?)')
        ->execute([$h, $url, $p ? json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null, talk_now()]);
    if (random_int(1, 50) === 1) $pdo->prepare('DELETE FROM talk_link_previews WHERE fetched_at < ?')->execute([gmdate('Y-m-d H:i:s', time() - 30 * 86400)]);
    return $p;
}

function talk_link_fetch_preview(string $url): ?array {
    // 유튜브: 페이지 대신 oEmbed (동의 화면 없이 제목·썸네일)
    if (preg_match('~^https?://(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})~', $url, $yt)) {
        $r = talk_link_get('https://www.youtube.com/oembed?format=json&url=' . rawurlencode('https://www.youtube.com/watch?v=' . $yt[1]));
        $j = $r && $r['code'] === 200 ? json_decode($r['body'], true) : null;
        return talk_link_clean([
            'url' => $url, 'site' => 'YouTube',
            'title' => is_array($j) ? (string)($j['title'] ?? '') : '',
            'desc' => is_array($j) ? (string)($j['author_name'] ?? '') : '',
            'image' => 'https://i.ytimg.com/vi/' . $yt[1] . '/hqdefault.jpg',
        ], $url);
    }
    $r = talk_link_get($url);
    if (!$r || $r['code'] < 200 || $r['code'] >= 300) return null;
    $type = strtolower($r['type']);
    // 주소가 바로 사진이면 그 사진을 카드로
    if (preg_match('~^image/(jpeg|png|gif|webp|avif)~', $type)) {
        return talk_link_clean(['url' => $url, 'title' => '', 'desc' => '', 'image' => $r['url'], 'site' => (string)parse_url($r['url'], PHP_URL_HOST)], $r['url']);
    }
    if ($type !== '' && !str_contains($type, 'html')) return null;
    $html = talk_link_utf8($r['body'], $type);
    $meta = talk_link_meta($html);
    $title = $meta['og:title'] ?? $meta['twitter:title'] ?? '';
    if ($title === '' && preg_match('~<title[^>]*>(.*?)</title>~is', $html, $t)) $title = html_entity_decode($t[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return talk_link_clean([
        'url' => $url,
        'title' => $title,
        'desc' => $meta['og:description'] ?? $meta['twitter:description'] ?? $meta['description'] ?? '',
        'image' => $meta['og:image'] ?? $meta['og:image:url'] ?? $meta['og:image:secure_url'] ?? $meta['twitter:image'] ?? $meta['twitter:image:src'] ?? '',
        'site' => $meta['og:site_name'] ?? (string)parse_url($r['url'], PHP_URL_HOST),
    ], $r['url']);
}

// 글자 다듬기·길이 자르기, 사진 주소는 https 만 (http 는 https 로 바꿔 봄, 안 뜨면 앱이 사진만 숨김)
function talk_link_clean(array $p, string $base): ?array {
    $one = fn(string $s, int $n) => mb_substr(trim(preg_replace('/\s+/u', ' ', $s)), 0, $n);
    $img = trim($p['image']);
    if ($img !== '') {
        $img = talk_link_abs($img, $base);
        if ($img !== null && str_starts_with($img, 'http://')) $img = 'https://' . substr($img, 7);
        if ($img === null || !str_starts_with($img, 'https://') || strlen($img) > 1000 || preg_match('/[\x00-\x20"<>\\\\]/', $img)) $img = '';
    }
    $out = ['url' => $p['url'], 'title' => $one($p['title'], 100), 'desc' => $one($p['desc'], 160), 'image' => $img,
        'site' => preg_replace('/^www\./', '', $one($p['site'], 40))];
    if ($out['title'] === '' && $out['image'] === '') return null;
    return $out;
}

// 상대 주소 → 절대 주소
function talk_link_abs(string $u, string $base): ?string {
    if (preg_match('~^https?://~i', $u)) return $u;
    $b = parse_url($base);
    if (!$b || empty($b['host'])) return null;
    $scheme = $b['scheme'] ?? 'https';
    if (str_starts_with($u, '//')) return $scheme . ':' . $u;
    $root = $scheme . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
    if (str_starts_with($u, '/')) return $root . $u;
    if (preg_match('~^[a-z][a-z0-9+.-]*:~i', $u)) return null;   // data:, javascript: 등
    $dir = preg_replace('~/[^/]*$~', '/', $b['path'] ?? '/');
    return $root . ($dir === '' ? '/' : $dir) . $u;
}

// <meta property|name=… content=…> 들 (앞에 나온 것이 이김)
function talk_link_meta(string $html): array {
    $end = stripos($html, '</head>');
    if ($end !== false) $html = substr($html, 0, $end);
    $out = [];
    preg_match_all('~<meta\s[^>]*>~i', $html, $mm);
    foreach ($mm[0] as $tag) {
        $a = [];
        preg_match_all('~([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))~', $tag, $at, PREG_SET_ORDER);
        foreach ($at as $x) $a[strtolower($x[1])] = $x[2] !== '' ? $x[2] : (($x[3] ?? '') !== '' ? $x[3] : ($x[4] ?? ''));
        $k = strtolower($a['property'] ?? $a['name'] ?? $a['itemprop'] ?? '');
        if ($k === '' || !isset($a['content']) || isset($out[$k])) continue;
        $out[$k] = html_entity_decode($a['content'], ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    return $out;
}

// 한국 사이트 중에는 EUC-KR(CP949) 인 곳이 있음
function talk_link_utf8(string $body, string $type): string {
    $cs = '';
    if (preg_match('~charset=["\']?([\w-]+)~i', $type, $m)) $cs = strtolower($m[1]);
    elseif (preg_match('~<meta[^>]+charset=["\']?([\w-]+)~i', substr($body, 0, 4000), $m)) $cs = strtolower($m[1]);
    if (in_array($cs, ['euc-kr', 'ks_c_5601-1987', 'cp949', 'x-windows-949', 'ms949'], true)) return (string)@mb_convert_encoding($body, 'UTF-8', 'CP949');
    if ($cs !== '' && !in_array($cs, ['utf-8', 'utf8'], true) && in_array(strtoupper($cs), array_map('strtoupper', mb_list_encodings()), true)) {
        return (string)@mb_convert_encoding($body, 'UTF-8', $cs);
    }
    if (!mb_check_encoding($body, 'UTF-8')) return (string)@mb_convert_encoding($body, 'UTF-8', 'CP949');
    return $body;
}

// 바깥 주소인지: 이름을 IP 로 바꿔 사설·예약 주소면 거절. 고른 IP 로만 접속 (중간에 바뀌지 않게)
function talk_link_resolve(string $host): ?string {
    if (filter_var($host, FILTER_VALIDATE_IP)) $ips = [$host];
    else {
        $ips = @gethostbynamel($host) ?: [];
    }
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return null;
    }
    return $ips[0] ?? null;
}

// GET (넘겨주기는 4번까지, 매번 주소를 다시 살핌). 시험 때는 TALK_LINK_TEST_PREFIX 로 시작하는 주소만 집 안이어도 허용
function talk_link_get(string $url): ?array {
    if (!function_exists('curl_init')) return null;
    for ($hop = 0; $hop < 5; $hop++) {
        $u = parse_url($url);
        if (!$u || empty($u['host']) || !in_array(strtolower($u['scheme'] ?? ''), ['http', 'https'], true) || isset($u['user'])) return null;
        $host = strtolower(trim($u['host'], '[]'));
        $port = (int)($u['port'] ?? (strtolower($u['scheme']) === 'https' ? 443 : 80));
        $prefix = (string)getenv('TALK_LINK_TEST_PREFIX');
        $test = $prefix !== '' && str_starts_with($url, $prefix);
        $ip = $test ? (filter_var($host, FILTER_VALIDATE_IP) ? $host : (@gethostbyname($host) ?: null)) : talk_link_resolve($host);
        if ($ip === null || (!$test && !in_array($port, [80, 443, 8080, 8443], true))) return null;
        $body = '';
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RESOLVE => [$host . ':' . $port . ':' . (str_contains($ip, ':') ? "[$ip]" : $ip)],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => TALK_LINK_TIMEOUT,
            CURLOPT_USERAGENT => TALK_LINK_UA,
            CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5', 'Accept-Language: ko-KR,ko;q=0.9,en;q=0.6'],
            CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$body) {
                $body .= $chunk;
                return strlen($body) > TALK_LINK_MAX_BYTES ? 0 : strlen($chunk);   // 넘으면 그만 받음 (앞부분으로 충분)
            },
        ]);
        curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $type = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $loc = (string)(curl_getinfo($ch, CURLINFO_REDIRECT_URL) ?: '');
        curl_close($ch);
        if ($code >= 300 && $code < 400 && $loc !== '') { $url = $loc; continue; }
        if ($code === 0) return null;
        return ['code' => $code, 'type' => $type, 'body' => $body, 'url' => $url];
    }
    return null;
}
