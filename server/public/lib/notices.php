<?php
// 공지사항 게시판: 모두에게 보이는 글 (그룹 상관없이). 채팅 목록 맨 위에 최신 한 줄, 누르면 게시판.
//  - admin: 관리 화면에서 쓴 글 (알림도 보낼 수 있음)
//  - auto: 배포마다 GitHub Actions 가 deploy.json 에 넣은 바뀐 점(커밋 제목들). 30분 안에 이어서 올라온 배포는 한 글로 모은다
declare(strict_types=1);
if (!defined('TALK')) { http_response_code(403); exit; }

const TALK_NOTICE_MERGE_SECONDS = 1800;

function talk_notice_view(array $n, bool $body = true): array {
    $v = ['id' => (int)$n['id'], 'kind' => $n['kind'], 'title' => $n['title'], 'at' => talk_iso($n['created_at']), 'updated' => talk_iso($n['updated_at'])];
    if ($body) $v['body'] = $n['body'];
    return $v;
}

// 맨 위 한 줄용 최신 글 (없으면 null)
function talk_notice_latest(PDO $pdo): ?array {
    $n = $pdo->query('SELECT * FROM talk_notices ORDER BY id DESC LIMIT 1')->fetch();
    return $n ? talk_notice_view($n, false) : null;
}

// 게시판 목록 (최신부터 30개씩, before 보다 오래된 것)
function talk_notice_list(PDO $pdo, int $before): array {
    $st = $pdo->prepare('SELECT * FROM talk_notices WHERE id < ? ORDER BY id DESC LIMIT 31');
    $st->execute([$before > 0 ? $before : PHP_INT_MAX]);
    $rows = $st->fetchAll();
    return ['notices' => array_map('talk_notice_view', array_slice($rows, 0, 30)), 'more' => count($rows) > 30];
}

function talk_notice_clean(string $title, string $body): array {
    $title = trim(preg_replace('/\s+/u', ' ', $title));
    $body = trim(str_replace("\r", '', $body));
    if ($title === '' || mb_strlen($title) > 100) throw new RuntimeException('제목을 1~100자로 넣어 주세요.');
    if (mb_strlen($body) > 5000) throw new RuntimeException('내용은 5000자까지예요.');
    return [$title, $body];
}

function talk_notice_add(PDO $pdo, string $title, string $body): int {
    [$title, $body] = talk_notice_clean($title, $body);
    $now = talk_now();
    $pdo->prepare("INSERT INTO talk_notices (kind, title, body, created_at, updated_at) VALUES ('admin', ?, ?, ?, ?)")->execute([$title, $body, $now, $now]);
    return (int)$pdo->lastInsertId();
}

// 관리자가 고치면 admin 글이 된다 (그 뒤 배포의 바뀐 점이 이 글에 더해지지 않게)
function talk_notice_edit(PDO $pdo, int $id, string $title, string $body): void {
    [$title, $body] = talk_notice_clean($title, $body);
    $pdo->prepare("UPDATE talk_notices SET kind = 'admin', title = ?, body = ?, updated_at = ? WHERE id = ?")->execute([$title, $body, talk_now(), $id]);
}

function talk_notice_delete(PDO $pdo, int $id): void {
    $pdo->prepare('DELETE FROM talk_notices WHERE id = ?')->execute([$id]);
}

// 새로 배포됐으면 (deploy.json 의 sha 가 처음 보는 것) 바뀐 점을 공지로. 동기화 때마다 부르지만 배포마다 한 번만 실제로 쓴다
function talk_release_notice(PDO $pdo, ?string $file = null): void {
    $d = json_decode((string)@file_get_contents($file ?? __DIR__ . '/../deploy.json'), true);
    $sha = is_array($d) ? (string)($d['sha'] ?? '') : '';
    if ($sha === '' || talk_meta_get($pdo, 'release_sha') === $sha) return;
    // 여러 요청이 동시에 와도 한 번만: release_sha 를 바꾸는 데 성공한 요청만 쓴다
    $pdo->exec("INSERT IGNORE INTO talk_meta (k, v) VALUES ('release_sha', '')");
    $st = $pdo->prepare("UPDATE talk_meta SET v = ? WHERE k = 'release_sha' AND v <> ?");
    $st->execute([$sha, $sha]);
    if ($st->rowCount() !== 1) return;
    $notes = [];
    foreach ((array)($d['notes'] ?? [$d['title'] ?? '']) as $line) {
        $line = trim(preg_replace('/\s+/u', ' ', (string)$line));
        if ($line !== '') $notes[] = mb_substr($line, 0, 300);
    }
    if (!$notes) return;
    // 30분 안에 올린 자동 공지가 맨 위에 있으면 거기에 더한다 (한꺼번에 반영된 수정은 한 글로)
    $last = $pdo->query('SELECT * FROM talk_notices ORDER BY id DESC LIMIT 1')->fetch();
    $now = talk_now();
    if ($last && $last['kind'] === 'auto' && strtotime($last['updated_at'] . ' UTC') > time() - TALK_NOTICE_MERGE_SECONDS) {
        $old = array_values(array_filter(explode("\n", $last['body']), fn($l) => $l !== ''));
        $all = array_values(array_unique(array_merge($old, array_map(fn($l) => "• $l", $notes))));
        $pdo->prepare('UPDATE talk_notices SET title = ?, body = ?, updated_at = ? WHERE id = ?')
            ->execute([talk_release_title($all), mb_substr(implode("\n", $all), 0, 5000), $now, $last['id']]);
    } else {
        $all = array_map(fn($l) => "• $l", $notes);
        $pdo->prepare("INSERT INTO talk_notices (kind, title, body, created_at, updated_at) VALUES ('auto', ?, ?, ?, ?)")
            ->execute([talk_release_title($all), implode("\n", $all), $now, $now]);
    }
}

function talk_release_title(array $lines): string {
    $first = ltrim($lines[0], '• ');
    $t = '업데이트: ' . $first;
    if (mb_strlen($t) > 80) $t = mb_substr($t, 0, 79) . '…';
    return count($lines) > 1 ? $t . ' 외 ' . (count($lines) - 1) . '개' : $t;
}
