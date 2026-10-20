// SAKi Talk 서버 시험: 카페24 와 같은 폴더 구조(www/talk)로 server/public 을 복사해 php -S + MariaDB 로 띄우고 API·설정 화면을 확인한다.
// 필요: php(pdo_mysql), MariaDB. DB 는 환경 변수 TALK_TEST_DB=호스트:DB:아이디:비밀번호 (기본 localhost:talktest:talk:talkpass)
// 멈춰 있으면: service mariadb start
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const [dbHost, dbName, dbUser, dbPass] = (process.env.TALK_TEST_DB || 'localhost:talktest:talk:talkpass').split(':');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}/talk`;

// DB 준비 (root 로 접속할 수 있을 때만 만들어 준다. 안 되면 이미 있다고 보고 진행)
try {
  execFileSync('mariadb', ['-uroot', '-e',
    `DROP DATABASE IF EXISTS ${dbName}; CREATE DATABASE ${dbName} CHARACTER SET utf8mb4;
     CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPass}';
     GRANT ALL ON ${dbName}.* TO '${dbUser}'@'localhost';`], { stdio: 'pipe' });
} catch (e) {
  console.log('(DB 를 새로 만들지 못함, 있는 DB 로 진행)', String(e.stderr || e.message).trim());
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-test-'));
const www = path.join(tmp, 'www');
fs.cpSync(path.resolve('server/public'), path.join(www, 'talk'), { recursive: true });
for (const f of ['config-path.php']) fs.rmSync(path.join(www, 'talk', f), { force: true });
fs.rmSync(path.join(www, 'talk', 'private'), { recursive: true, force: true });

// 가짜 알림 서비스: 서버가 보낸 웹 푸시를 받아 둔다 (TALK_PUSH_TEST_PREFIX 로 이 주소만 허용)
const pushes = [];
const pushServer = http.createServer((rq, rs) => {
  const chunks = [];
  rq.on('data', (c) => chunks.push(c));
  rq.on('end', () => { pushes.push({ path: rq.url, headers: rq.headers, body: Buffer.concat(chunks) }); rs.writeHead(201); rs.end(); });
});
await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
const PUSH_PREFIX = `http://127.0.0.1:${pushServer.address().port}/push/`;

// 가짜 SAKi Lite: X-Saki-Lite-Key 를 확인하고 문서(saki-lite-연동.md)의 응답 모양을 돌려준다. lite.mode 로 pass·limited·401·503 흉내
const SAKI_KEY = crypto.randomBytes(36).toString('base64url'); // 48자
const lite = { mode: 'reply', calls: [], pathInfo: true, budget: false, remember: 'ok' }; // remember: ok·limited·error // budget: 90% 를 넘은 척 (budget_notice 를 받으면 안내를 붙였다고 답함)
const liteServer = http.createServer((rq, rs) => {
  const chunks = [];
  rq.on('data', (c) => chunks.push(c));
  rq.on('end', () => {
    const u = new URL(rq.url, 'http://x');
    const route = u.pathname.startsWith('/saki/api.php/') && u.pathname.length > 14 ? u.pathname.slice(14) : u.searchParams.get('r');
    const send = (code, body) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(body)); };
    if (!lite.pathInfo && u.pathname !== '/saki/api.php') { rs.writeHead(404, { 'Content-Type': 'text/html' }); rs.end('<h1>Not Found</h1>'); return; }
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString() || 'null'); } catch { /* 아래에서 400 */ }
    lite.calls.push({ route, key: rq.headers['x-saki-lite-key'], body });
    if (rq.method !== 'POST') return send(405, { ok: false, error: 'POST 만 받아요.' });
    if (lite.mode === 'off') return send(503, { ok: false, error: 'SAKi Lite 가 꺼져 있어요.' });
    if (rq.headers['x-saki-lite-key'] !== SAKI_KEY || lite.mode === 'badkey') return send(401, { ok: false, error: '열쇠가 맞지 않아요.' });
    if (!body) return send(400, { ok: false, error: 'JSON 이 아니에요.' });
    if (route === 'lite/status') return send(200, { ok: true, on: true, model: 'claude-haiku-5-5', features: ['members', 'budget_notice', 'summary', 'app', 'memory'], personalities: [], emotions: [], day: '2026-10-18', spent: 0.0123, requests: 3, cap: 0.2 });
    if (route !== 'lite/reply') return send(404, { ok: false, error: '없는 주소' });
    const base = { ok: true, mode: body.mode, pass: false, emotion: 'neutral', reaction: '', links: [], limited: false, spent: 0.01, cap: 0.2,
      budget_noticed: !!(lite.budget && body.budget_notice && body.mode === 'called') };
    if (body.mode === 'remember') {
      // 방 기억 고쳐 쓰기: 실패·상한이면 보낸 기억 그대로
      if (lite.remember === 'limited') return send(200, { ok: true, mode: 'remember', memory: body.memory, diary: '', limited: true, why: 'daily-cap', spent: 0.3, cap: 0.3 });
      if (lite.remember === 'error') return send(200, { ok: true, mode: 'remember', memory: body.memory, diary: '', limited: false, why: 'claude-error', spent: 0.1, cap: 0.3 });
      return send(200, { ok: true, mode: 'remember', memory: `[사람]\n- 기억 ${lite.calls.length} (${body.messages.length}개)\n[약속·일정]\n[오늘]`,
        diary: body.diary ? `${body.diary}에는 ${body.messages.map((m) => m.text).join(', ')}` : '', limited: false, spent: 0.05, cap: 0.3 });
    }
    if (lite.mode === 'pass') return send(200, { ...base, pass: true, text: '' });
    if (lite.mode === 'limited') return send(200, { ...base, limited: true, why: 'daily-cap', text: '오늘은 여기까지 할게…' });
    send(200, { ...base, text: '흥, 내일은 맑대. …사키가 알려 준 거야.', emotion: 'happy', reaction: '😊', links: [
      { kind: 'page', title: '기상청 날씨', url: 'https://www.kma.go.kr/weather' },
      { kind: 'youtube', title: '유튜브에서 "소풍 도시락" 찾기', url: 'https://www.youtube.com/results?search_query=%EC%86%8C%ED%92%8D' },
      { kind: 'page', title: '나쁜 링크', url: 'http://insecure.example.com/' },
      { kind: 'page', title: '스크립트', url: 'javascript:alert(1)' },
    ] });
  });
});
await new Promise((r) => liteServer.listen(0, '127.0.0.1', r));
const LITE_URL = `http://127.0.0.1:${liteServer.address().port}/saki/api.php/`;

// 가짜 네이버: Maps(Reverse Geocoding·Geocoding·Static Map)와 NAVER API HUB 지역 검색. 열쇠 머리를 확인하고 공식 응답 모양을 돌려준다
const NAVER = { id: 'testClientId1234', secret: 'testClientSecretABCDEFG' };
const HUB = { id: 'hubClientId5678', secret: 'hubClientSecretHIJKLMN' };
const naverCalls = [];
const FAKE_MAP = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-static-map')]);
const naverServer = http.createServer((rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  naverCalls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams) });
  const send = (code, body) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(body)); };
  const keys = (k) => rq.headers['x-ncp-apigw-api-key-id'] === k.id && rq.headers['x-ncp-apigw-api-key'] === k.secret;
  if (u.pathname === '/search/v1/local') {
    if (!keys(HUB)) return send(401, { errorMessage: 'Authentication failed', errorCode: '024' });
    return send(200, { lastBuildDate: '', total: 2, start: 1, display: 2, items: [
      { title: '<b>서울시청</b>', link: '', category: '공공,사회기관>시청', description: '', telephone: '', address: '서울특별시 중구 태평로1가 31', roadAddress: '서울특별시 중구 세종대로 110', mapx: '1269783882', mapy: '375666103' },
      { title: '바다 위 &amp; 이상한 곳', category: '', address: '', roadAddress: '', mapx: '0', mapy: '0' },
    ] });
  }
  if (!keys(NAVER)) return send(401, { error: { errorCode: '200', message: 'Authentication Failed' } });
  if (u.pathname === '/map-reversegeocode/v2/gc') return send(200, { status: { code: 0, name: 'ok', message: 'done' }, results: [
    { name: 'legalcode', region: { area0: { name: 'kr' }, area1: { name: '서울특별시' }, area2: { name: '중구' }, area3: { name: '태평로1가' }, area4: { name: '' } } },
    { name: 'addr', region: { area1: { name: '서울특별시' }, area2: { name: '중구' }, area3: { name: '태평로1가' }, area4: { name: '' } }, land: { type: '1', number1: '31', number2: '' } },
    { name: 'roadaddr', region: { area1: { name: '서울특별시' }, area2: { name: '중구' }, area3: { name: '태평로1가' } }, land: { name: '세종대로', number1: '110', number2: '', addition0: { type: 'building', value: '서울특별시청' } } },
  ] });
  if (u.pathname === '/map-static/v2/raster') { rs.writeHead(200, { 'Content-Type': 'image/jpeg' }); rs.end(FAKE_MAP); return; }
  if (u.pathname === '/map-geocode/v2/geocode') return send(200, { status: 'OK', addresses: u.searchParams.get('query').includes('세종대로')
    ? [{ roadAddress: '서울특별시 중구 세종대로 110 서울특별시청', jibunAddress: '서울특별시 중구 태평로1가 31', x: '126.9783882', y: '37.5666103' }] : [] });
  send(404, { error: { message: 'Not Found' } });
});
await new Promise((r) => naverServer.listen(0, '127.0.0.1', r));
const NAVER_URL = `http://127.0.0.1:${naverServer.address().port}/`;

const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', www], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TALK_PUSH_TEST_PREFIX: PUSH_PREFIX, TALK_SAKI_TEST_URL: LITE_URL, TALK_NAVER_TEST_URL: NAVER_URL } });
let phpLog = '';
php.stderr.on('data', (d) => { phpLog += d; });

let jar = '';
async function req(p, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (jar) headers.Cookie = jar;
  const res = await fetch(BASE + p, { ...opts, headers, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  if (sc) jar = sc.split(';')[0];
  return res;
}
const json = async (p, opts) => { const r = await req(p, opts); return { status: r.status, body: await r.json() }; };
const form = (data) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });
const csrfOf = (html) => html.match(/name="csrf" value="([a-f0-9]+)"/)[1];

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('✓', name); } catch (e) { console.log('✗', name); throw e; }
}

try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api.php/health'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  await t('설정 전: health 는 configured=false', async () => {
    const { status, body } = await json('/api.php/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.configured, false);
  });

  await t('설정 전: 다른 API 는 503', async () => {
    const { status } = await json('/api.php/nothing');
    assert.equal(status, 503);
  });

  await t('처음 설정: 비밀번호가 짧으면 거절', async () => {
    const html = await (await req('/setup.php')).text();
    const r = await req('/setup.php', form({ csrf: csrfOf(html), dbh: dbHost, dbn: dbName, dbu: dbUser, dbp: dbPass, name: '일래', pw: 'short', pw2: 'short' }));
    assert.match(await r.text(), /8자 이상/);
  });

  await t('처음 설정: 설정 파일은 www 바깥 talk-private 에', async () => {
    const html = await (await req('/setup.php')).text();
    const r = await req('/setup.php', form({ csrf: csrfOf(html), dbh: dbHost, dbn: dbName, dbu: dbUser, dbp: dbPass, name: '일래', pw: 'test-password-1', pw2: 'test-password-1' }));
    const out = await r.text();
    assert.match(out, /설정을 마쳤어요/);
    assert.ok(fs.existsSync(path.join(tmp, 'talk-private', 'config.php')));
    assert.ok(!fs.readFileSync(path.join(www, 'talk', 'config-path.php'), 'utf8').includes(dbPass));
  });

  await t('설정 후: health 는 configured·db true', async () => {
    const { body } = await json('/api.php/health');
    assert.equal(body.configured, true);
    assert.equal(body.db, true);
  });

  await t('설정 후: 로그인 없이 부르면 401', async () => {
    const { status } = await json('/api.php/nothing');
    assert.equal(status, 401);
  });

  await t('관리 화면: 보관 설정 바꾸기', async () => {
    const html = await (await req('/setup.php')).text();
    const out = await (await req('/setup.php', form({ csrf: csrfOf(html), act: 'media', limit: '300', photo: '10', video: '2' }))).text();
    assert.match(out, /보관 설정을 바꿨어요/);
    assert.match(out, /name="limit" type="number" value="300"/);
  });

  await t('관리 화면: 다시 들어올 때 비밀번호 확인, 틀리면 거절', async () => {
    jar = '';
    let html = await (await req('/setup.php')).text();
    assert.match(html, /관리 화면 로그인/);
    html = await (await req('/setup.php', form({ csrf: csrfOf(html), act: 'login', pw: 'wrong-password' }))).text();
    assert.match(html, /맞지 않아요/);
    html = await (await req('/setup.php', form({ csrf: csrfOf(html), act: 'login', pw: 'test-password-1' }))).text();
    assert.match(html, /서버 상태/);
  });

  // ───── 1단계: 그룹·초대·계정·채팅 ─────
  const adminPost = async (data) => {
    const html = await (await req('/setup.php')).text();
    return (await req('/setup.php', form({ csrf: csrfOf(html), ...data }))).text();
  };

  await t('관리 화면: 네이버 지도 열쇠 저장·확인·지우기 (열쇠는 다시 안 보임)', async () => {
    let html = await adminPost({ act: 'naver_key', id: 'bad id', secret: 'x' });
    assert.match(html, /모양이 아니에요/);
    html = await adminPost({ act: 'naver_key', id: NAVER.id, secret: 'wrongSecret12345' });
    assert.match(html, /맞지 않아요/);
    html = await adminPost({ act: 'naver_key', id: NAVER.id, secret: NAVER.secret });
    assert.match(html, /잘 됨 \(서울시청 → 서울특별시 중구 태평로1가\)/);
    assert.ok(!html.includes(NAVER.secret) && !html.includes(NAVER.id), '열쇠가 화면에 나오면 안 됨');
    assert.match(html, /지도 ····1234/);
    assert.match(html, /지도 사진 잘 됨/);
    assert.equal(naverCalls.find((c) => c.path === '/map-reversegeocode/v2/gc').q.coords, '126.9783882,37.5666103');
    html = await adminPost({ act: 'naver_key_clear' });
    assert.match(html, /네이버 지도 열쇠를 지웠어요/);
    assert.match(html, /네이버 지도 <span class="hint">지도 열쇠 없음/);
    // 장소 검색 열쇠 (NAVER API HUB)
    html = await adminPost({ act: 'naver_search_key', id: HUB.id, secret: 'wrongSecret12345' });
    assert.match(html, /맞지 않아요/);
    html = await adminPost({ act: 'naver_search_key', id: HUB.id, secret: HUB.secret });
    assert.match(html, /잘 됨 \(&quot;서울시청&quot; 검색 2개\)/);
    assert.ok(!html.includes(HUB.secret) && !html.includes(HUB.id));
    assert.match(html, /검색 ····5678/);
  });
  const inviteOf = (html) => html.match(/초대 코드 <code>([A-Z0-9]{8})<\/code>/)[1];
  const api = async (p, body, token) => {
    const headers = token ? { 'X-Talk-Token': token } : {};
    const opts = body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const r = await fetch(BASE + '/api.php/' + p, opts);
    return { status: r.status, body: await r.json() };
  };
  let family, friends, inviteFamily, inviteFriends;
  const tok = {};

  await t('관리 화면: 그룹 두 개 만들고 초대 코드', async () => {
    let html = await adminPost({ act: 'group_new', name: '가족' });
    assert.match(html, /그룹 (&quot;|")가족(&quot;|") 을 만들었어요/);
    await adminPost({ act: 'group_new', name: '친구' });
    html = await (await req('/setup.php')).text();
    const ids = [...html.matchAll(/name="act" value="invite"><input type="hidden" name="group" value="(\d+)"/g)].map((m) => m[1]);
    [family, friends] = ids;
    inviteFamily = inviteOf(await adminPost({ act: 'invite', group: family, uses: '2', days: '7' }));
    inviteFriends = inviteOf(await adminPost({ act: 'invite', group: friends, uses: '1', days: '7' }));
    assert.ok(inviteFamily && inviteFriends);
    html = await (await req('/setup.php')).text();
    assert.ok(html.includes(`<code>${inviteFamily}</code>`), '만든 뒤에도 관리 화면에서 코드가 다시 보임');
    assert.ok(html.includes(`data-copy="${inviteFamily}"`) && html.includes('#invite=' + inviteFamily + '">링크 복사'), '코드·링크 복사 단추');
    assert.equal((await req('/setup.js')).status, 200);
    assert.ok(html.includes(`#invite=${inviteFriends}`));
  });

  await t('가입: 틀린 초대 코드는 거절, 맞으면 토큰', async () => {
    let r = await api('auth/register', { invite: 'WRONG123', name: '엄마', password: 'pass1234' });
    assert.equal(r.status, 401);
    r = await api('auth/invite', { invite: inviteFamily.toLowerCase() });
    assert.equal(r.body.group, '가족');
    r = await api('auth/register', { invite: inviteFamily, name: '엄마', nick: ' 엄마곰 ', password: 'pass1234', device: '엄마 폰' });
    assert.equal(r.status, 200);
    tok.mom = r.body.token;
    r = await api('auth/register', { invite: inviteFamily, name: '엄마', password: 'pass1234' });
    assert.equal(r.status, 409, '같은 이름');
    r = await api('auth/register', { invite: inviteFamily, name: '아빠', password: 'pass1234' });
    tok.dad = r.body.token;
    r = await api('auth/register', { invite: inviteFamily, name: '동생', password: 'pass1234' });
    assert.equal(r.status, 401, '2번 쓰는 코드를 3번째');
    r = await api('auth/register', { invite: inviteFriends, name: '친구1', password: 'pass1234' });
    tok.f1 = r.body.token;
  });

  await t('관리자도 메신저에 로그인 (관리자 비밀번호)', async () => {
    let r = await api('auth/login', { name: '일래', password: 'nope' });
    assert.equal(r.status, 401);
    r = await api('auth/login', { name: '일래', password: 'test-password-1', device: 'PC' });
    assert.equal(r.status, 200);
    tok.me = r.body.token;
  });

  await t('같은 기기로 다시 로그인하면 예전 기기 줄을 바꿔 씀 (관리 화면에 쌓이지 않게)', async () => {
    const key = 'ab'.repeat(16);
    const a = await api('auth/login', { name: '일래', password: 'test-password-1', device: '아이폰', device_key: key });
    const b = await api('auth/login', { name: '일래', password: 'test-password-1', device: '아이폰', device_key: key });
    assert.equal(b.status, 200);
    assert.equal((await api('me', undefined, a.body.token)).status, 401, '예전 토큰은 끊김');
    assert.equal((await api('me', undefined, b.body.token)).status, 200);
    assert.equal((await api('me', undefined, tok.me)).status, 200, '다른 기기는 그대로');
  });

  await t('그룹: 같은 그룹 사람만 보임', async () => {
    let r = await api('me', undefined, tok.mom);
    assert.deepEqual(r.body.groups.map((g) => g.name), ['가족']);
    assert.deepEqual(r.body.groups[0].members.map((m) => m.name).sort(), ['아빠', '엄마', '일래'].sort());
    r = await api('me', undefined, tok.f1);
    assert.deepEqual(r.body.groups[0].members.map((m) => m.name).sort(), ['일래', '친구1'].sort());
    r = await api('me', undefined, tok.me);
    assert.equal(r.body.groups.length, 2);
  });

  const idOf = async (token, name) => (await api('me', undefined, token)).body.groups.flatMap((g) => g.members).find((m) => m.name === name).id;
  let dm, room;

  await t('1:1 방: 다른 그룹 사람과는 못 만듦, 같은 방은 하나', async () => {
    const f1 = await idOf(tok.me, '친구1');
    let r = await api('rooms/dm', { user_id: f1 }, tok.mom);
    assert.equal(r.status, 403);
    const dad = await idOf(tok.mom, '아빠');
    r = await api('rooms/dm', { user_id: dad }, tok.mom);
    dm = r.body.room.id;
    const mom = await idOf(tok.dad, '엄마');
    r = await api('rooms/dm', { user_id: mom }, tok.dad);
    assert.equal(r.body.room.id, dm);
  });

  await t('여럿 방: 다른 그룹 사람은 못 넣음', async () => {
    const f1 = await idOf(tok.me, '친구1');
    const mom = await idOf(tok.me, '엄마');
    let r = await api('rooms/create', { group_id: Number(family), member_ids: [f1], name: '' }, tok.me);
    assert.equal(r.status, 403);
    const dad = await idOf(tok.me, '아빠');
    r = await api('rooms/create', { group_id: Number(family), member_ids: [mom, dad], name: '우리 가족' }, tok.me);
    room = r.body.room.id;
    assert.equal(r.body.room.members.length, 3);
  });

  let cursorDad;
  await t('메시지: 보내기·재시도 중복 없음·방 밖 사람은 못 보냄', async () => {
    let r = await api('messages/send', { room_id: room, body: '저녁 뭐 먹어?', client_id: 'abcdefgh01' }, tok.me);
    const id = r.body.message.id;
    r = await api('messages/send', { room_id: room, body: '저녁 뭐 먹어?', client_id: 'abcdefgh01' }, tok.me);
    assert.equal(r.body.message.id, id);
    r = await api('messages/send', { room_id: room, body: '나도 끼워줘' }, tok.f1);
    assert.equal(r.status, 403);
    r = await api('messages/send', { room_id: room, body: '   ' }, tok.me);
    assert.equal(r.status, 400);
  });

  await t('동기화: 처음엔 전부, 그다음엔 바뀐 것만', async () => {
    let r = await api('sync?since=0', undefined, tok.dad);
    assert.equal(r.body.full, true);
    assert.equal(r.body.rooms.length, 2);
    const fam = r.body.rooms.find((x) => x.id === room);
    assert.equal(fam.unread, 1);
    assert.equal(fam.last.body, '저녁 뭐 먹어?');
    cursorDad = r.body.cursor;
    r = await api('sync?since=' + cursorDad, undefined, tok.dad);
    assert.equal(r.body.rooms.length, 0);
    await api('messages/send', { room_id: room, body: '김치찌개', client_id: 'momclient01' }, tok.mom);
    r = await api('sync?since=' + cursorDad, undefined, tok.dad);
    assert.deepEqual(r.body.messages.map((m) => m.body), ['김치찌개']);
    assert.equal(r.body.rooms[0].unread, 2);
    cursorDad = r.body.cursor;
    r = await api('sync?since=0', undefined, tok.f1);
    assert.equal(r.body.rooms.length, 0, '친구1 은 가족 방을 못 봄');
  });

  await t('읽음: 읽으면 안 읽은 수가 줄고 다른 사람에게도 알려짐', async () => {
    const r0 = await api('sync?since=0', undefined, tok.dad);
    const last = r0.body.rooms.find((x) => x.id === room).last.id;
    await api('rooms/read', { room_id: room, last_id: last }, tok.dad);
    let r = await api('sync?since=0', undefined, tok.dad);
    assert.equal(r.body.rooms.find((x) => x.id === room).unread, 0);
    r = await api('sync?since=0', undefined, tok.me);
    const dadId = await idOf(tok.me, '아빠');
    assert.equal(r.body.rooms.find((x) => x.id === room).members.find((m) => m.id === dadId).last_read_id, last);
    r = await api('rooms/read', { room_id: room, last_id: last }, tok.f1);
    assert.equal(r.status, 403);
  });

  await t('답장·반응: 원래 글 미리보기, 반응은 한 사람 하나(같은 것 다시 누르면 뺌), 다른 사람에게 바뀐 것이 내려감', async () => {
    const orig = (await api('messages/send', { room_id: room, body: '내일 소풍 가자' }, tok.mom)).body.message;
    let r = await api('messages/send', { room_id: room, body: '좋아요!', reply_to: orig.id }, tok.dad);
    assert.equal(r.body.message.reply_to, orig.id);
    assert.equal(r.body.message.reply.body, '내일 소풍 가자');
    assert.equal(r.body.message.reply.user_id, orig.user_id);
    r = await api('messages/send', { room_id: room, body: '엉뚱한 답장', reply_to: 999999 }, tok.dad);
    assert.equal(r.body.message.reply_to, null, '다른 방·없는 메시지면 답장 없이');
    const cur = (await api('sync?since=0', undefined, tok.me)).body.cursor;
    assert.equal((await api('messages/react', { id: orig.id, emoji: '❤️' }, tok.dad)).status, 200);
    assert.equal((await api('messages/react', { id: orig.id, emoji: '😂' }, tok.me)).status, 200);
    assert.equal((await api('messages/react', { id: orig.id, emoji: '💩' }, tok.me)).status, 400);
    assert.equal((await api('messages/react', { id: orig.id, emoji: '❤️' }, tok.f1)).status, 404);
    let s = (await api('sync?since=' + cur, undefined, tok.mom)).body;
    assert.deepEqual(s.messages.find((m) => m.id === orig.id).reactions.map((x) => x[1]).sort(), ['❤️', '😂'].sort());
    await api('messages/react', { id: orig.id, emoji: '❤️' }, tok.dad);
    s = (await api('messages/history?room_id=' + room + '&before=0', undefined, tok.mom)).body;
    const list = s.messages || s;
    assert.deepEqual(list.find((m) => m.id === orig.id).reactions, [[await idOf(tok.mom, '일래'), '😂']]);
    // 검색: 글자 그대로, 최근 것부터, 방 밖 사람은 못 함
    r = await api('messages/search?room_id=' + room + '&q=' + encodeURIComponent('소풍'), undefined, tok.dad);
    assert.deepEqual(r.body.messages.map((m) => m.body), ['내일 소풍 가자']);
    assert.equal(r.body.messages[0].reactions.length, 1);
    r = await api('messages/search?room_id=' + room + '&q=' + encodeURIComponent('%'), undefined, tok.dad);
    assert.equal(r.body.messages.length, 0, '% 는 글자 그대로');
    assert.equal((await api('messages/search?room_id=' + room + '&q=a', undefined, tok.f1)).status, 403);
    // 공지: 글만, 방 사람 누구나, 지우면(모두에게 삭제) 공지도 내려감
    assert.equal((await api('rooms/notice', { room_id: room, message_id: orig.id }, tok.dad)).status, 200);
    let fam = (await api('sync?since=0', undefined, tok.me)).body.rooms.find((x) => x.id === room);
    assert.equal(fam.notice.body, '내일 소풍 가자');
    assert.equal(fam.notice.by, '아빠');
    assert.equal((await api('rooms/notice', { room_id: room, message_id: orig.id }, tok.f1)).status, 403);
    assert.equal((await api('rooms/notice', { room_id: room, message_id: 999999 }, tok.dad)).status, 400);
    await api('messages/delete', { id: orig.id }, tok.mom);
    fam = (await api('sync?since=0', undefined, tok.me)).body.rooms.find((x) => x.id === room);
    assert.equal(fam.notice, null);
  });

  await t('예전 대화 불러오기 (50개씩)', async () => {
    for (let i = 0; i < 55; i++) await api('messages/send', { room_id: dm, body: '메시지 ' + i }, tok.mom);
    let r = await api('messages/history?room_id=' + dm, undefined, tok.dad);
    assert.equal(r.body.messages.length, 50);
    assert.equal(r.body.messages.at(-1).body, '메시지 54');
    r = await api('messages/history?room_id=' + dm + '&before=' + r.body.messages[0].id, undefined, tok.dad);
    assert.equal(r.body.messages.length, 5);
    r = await api('messages/history?room_id=' + dm, undefined, tok.f1);
    assert.equal(r.status, 403);
  });

  await t('입력 중: 보고 있는 방에서만, 나는 빼고, 보내거나 끄면 사라짐, 방 밖 사람은 못 함', async () => {
    const dadId = await idOf(tok.mom, '아빠');
    const room = (await api('rooms/dm', { user_id: dadId }, tok.mom)).body.room.id;
    assert.equal((await api('rooms/typing', { room_id: room, on: true }, tok.mom)).status, 200);
    let s = (await api(`sync?since=0&active=1&room=${room}`, undefined, tok.dad)).body;
    assert.deepEqual(s.typing, [await idOf(tok.dad, '엄마')]);
    assert.deepEqual((await api(`sync?since=0&active=1&room=${room}`, undefined, tok.mom)).body.typing, [], '나는 빼고');
    assert.deepEqual((await api('sync?since=0&active=1&room=0', undefined, tok.dad)).body.typing, [], '목록에서는 안 보냄');
    await api('messages/send', { room_id: room, body: '다 쳤어요' }, tok.mom);
    assert.deepEqual((await api(`sync?since=0&active=1&room=${room}`, undefined, tok.dad)).body.typing, [], '보내면 꺼짐');
    await api('rooms/typing', { room_id: room, on: true }, tok.mom);
    await api('rooms/typing', { room_id: room, on: false }, tok.mom);
    assert.deepEqual((await api(`sync?since=0&active=1&room=${room}`, undefined, tok.dad)).body.typing, [], '끄면 꺼짐');
    assert.equal((await api('rooms/typing', { room_id: room, on: true }, tok.f1)).status, 403);
    assert.deepEqual((await api(`sync?since=0&active=1&room=${room}`, undefined, tok.f1)).body.typing, [], '남의 방은 안 보임');
    await api('me/away', {}, tok.dad);
  });

  await t('닉네임: 가입 때 정하고, 로그인은 본명, 바꾸면 같은 그룹·방에 보임', async () => {
    let r = await api('me', undefined, tok.mom);
    assert.equal(r.body.me.name, '엄마');
    assert.equal(r.body.me.nick, '엄마곰');
    r = await api('me', undefined, tok.dad);
    assert.equal(r.body.me.nick, null, '비우면 본명');
    const mom = r.body.groups[0].members.find((m) => m.name === '엄마');
    assert.equal(mom.nick, '엄마곰');
    r = await api('auth/login', { name: '엄마곰', password: 'pass1234' });
    assert.equal(r.status, 401, '닉네임으로는 로그인 안 됨');
    r = await api('auth/login', { name: '엄마', password: 'pass1234' });
    assert.equal(r.status, 200);
    r = await api('me/nick', { nick: 'x'.repeat(21) }, tok.dad);
    assert.equal(r.status, 400);
    const before = (await api('sync?since=0', undefined, tok.mom)).body;
    r = await api('me/nick', { nick: '아빠곰' }, tok.dad);
    assert.equal(r.status, 200);
    r = await api('sync?since=' + before.cursor, undefined, tok.mom);
    assert.notEqual(r.body.groups_rev, before.groups_rev, '친구 목록 다시 받기');
    const dadInRoom = r.body.rooms.flatMap((x) => x.members).find((m) => m.name === '아빠');
    assert.equal(dadInRoom?.nick, '아빠곰', '방 사람 목록에도');
    r = await api('me/nick', { nick: '' }, tok.dad);
    r = await api('me', undefined, tok.dad);
    assert.equal(r.body.me.nick, null);
  });

  await t('말풍선 색: 저장하면 나·친구 목록·방 사람 목록에, 이상한 값은 거절, 비우면 기본', async () => {
    const before = (await api('sync?since=0', undefined, tok.mom)).body;
    let r = await api('me/bubble', { color: '#FEE500' }, tok.dad);
    assert.equal(r.status, 200);
    assert.equal((await api('me', undefined, tok.dad)).body.me.bubble, '#fee500');
    r = await api('sync?since=' + before.cursor, undefined, tok.mom);
    assert.equal(r.body.rooms.flatMap((x) => x.members).find((m) => m.name === '아빠')?.bubble, '#fee500', '방 사람 목록에도');
    assert.equal((await api('me', undefined, tok.mom)).body.groups[0].members.find((m) => m.name === '아빠').bubble, '#fee500');
    assert.equal((await api('me/bubble', { color: 'red;background:url(x)' }, tok.dad)).status, 400);
    await api('me/bubble', { color: '' }, tok.dad);
    assert.equal((await api('me', undefined, tok.dad)).body.me.bubble, null);
  });

  const sql = (q) => execFileSync('mariadb', [`-u${dbUser}`, `-p${dbPass}`, '--default-character-set=utf8mb4', '-r', '-N', '-D', dbName, '-e', q]).toString().trim();

  await t('알림: 받는 사람 기기로 암호화해 보냄, 그 방을 보고 있거나 끄면 안 보냄, 시험 알림', async () => {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const authSecret = crypto.randomBytes(16);
    const b64u = (b) => b.toString('base64url');
    const sub = { endpoint: PUSH_PREFIX + 'dad', keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(authSecret) } };
    // RFC 8291 풀기 (기기가 하는 일)
    const open = (buf) => {
      const salt = buf.subarray(0, 16), idlen = buf[20], asPub = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(asPub), authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub]), 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
    };
    const waitPush = async (ms) => { for (let i = 0; i < ms / 50 && !pushes.length; i++) await new Promise((r) => setTimeout(r, 50)); return pushes.splice(0); };

    let r = await api('push/key', undefined, tok.dad);
    assert.equal(r.body.key.length, 87);
    r = await api('push/subscribe', { ...sub, endpoint: 'https://evil.example.com/x' }, tok.dad);
    assert.equal(r.status, 400, '모르는 알림 서비스 주소는 거절');
    r = await api('push/subscribe', sub, tok.dad);
    assert.equal(r.status, 200);
    const dadId = await idOf(tok.mom, '아빠');
    const room = (await api('rooms/dm', { user_id: dadId }, tok.mom)).body.room.id;
    pushes.length = 0;

    await api('messages/send', { room_id: room, body: '알림 시험\n둘째 줄' }, tok.mom);
    let got = await waitPush(3000);
    assert.equal(got.length, 1, '아빠 기기로 하나');
    assert.equal(got[0].path, '/push/dad');
    assert.match(got[0].headers.authorization, /^vapid t=.+, k=/);
    const msg = open(got[0].body);
    assert.equal(msg.title, '엄마곰');
    assert.equal(msg.body, '알림 시험 둘째 줄');
    assert.equal(msg.room, room);
    const dadUnread = (await api('sync?since=0', undefined, tok.dad)).body.rooms.reduce((n, x) => n + x.unread, 0);
    assert.equal(msg.badge, dadUnread, '아이콘 뱃지: 아빠의 안 읽은 수 합계 (채팅 탭 숫자와 같음)');

    await api('sync?since=0&active=1&room=0', undefined, tok.dad);
    await api('messages/send', { room_id: room, body: '목록을 보고 있을 때' }, tok.mom);
    got = await waitPush(3000);
    assert.equal(got.length, 1, '목록 화면이면 보냄');
    assert.equal(open(got[0].body).badge, dadUnread + 1, '안 읽은 수가 늘면 뱃지도');
    await api(`sync?since=0&active=1&room=${room}`, undefined, tok.dad);
    await api('messages/send', { room_id: room, body: '그 방을 보고 있을 때' }, tok.mom);
    assert.equal((await waitPush(800)).length, 0, '그 방을 보고 있으면 안 보냄');

    await api('me/away', {}, tok.dad);
    await api('messages/send', { room_id: room, body: '앱을 닫은 뒤' }, tok.mom);
    assert.equal((await waitPush(3000)).length, 1, '앱을 숨기면 다시 보냄');

    r = await api('push/test', {}, tok.dad);
    assert.equal(r.body.sent, 1, '시험 알림은 기다렸다가 결과');
    assert.equal(open((await waitPush(1000))[0].body).tag, 'test');
    r = await api('push/test', {}, tok.mom);
    assert.equal(r.body.total, 0, '알림 안 켠 기기');

    await api('push/unsubscribe', { endpoint: sub.endpoint }, tok.dad);
    await api('messages/send', { room_id: room, body: '알림 끈 뒤' }, tok.mom);
    assert.equal((await waitPush(800)).length, 0, '알림을 끄면 안 보냄');

    // 정신병 방지(연속알림 차단): 1분 안에 3개째부터 조용히 (안드로이드 등은 quiet 표시, 아이폰은 안 보냄)
    assert.equal((await api('me/prefs', { push_quiet: true }, tok.dad)).status, 200);
    assert.equal((await api('me', undefined, tok.dad)).body.me.push_quiet, 1);
    const made = await api('rooms/create', { group_id: Number(family), member_ids: [dadId], name: '수다방' }, tok.mom);
    const busy = made.body.room.id;
    await api('push/subscribe', sub, tok.dad);
    pushes.length = 0;
    for (const [i, quiet] of [[1, undefined], [2, undefined], [3, 1], [4, 1]]) {
      await api('messages/send', { room_id: busy, body: '수다 ' + i }, tok.mom);
      got = await waitPush(3000);
      assert.equal(got.length, 1);
      assert.equal(open(got[0].body).quiet, quiet, `수다 ${i}: ${quiet ? '조용히' : '보통 알림'}`);
    }
    await api('push/unsubscribe', { endpoint: sub.endpoint }, tok.dad);
    const apple = { ...sub, endpoint: PUSH_PREFIX + 'apple-dad' };
    await api('push/subscribe', apple, tok.dad);
    await api('messages/send', { room_id: busy, body: '아이폰은' }, tok.mom);
    assert.equal((await waitPush(800)).length, 0, '아이폰은 몰아서 대화 중이면 안 보냄');
    sql(`UPDATE talk_messages SET created_at = created_at - INTERVAL 6 MINUTE WHERE room_id = ${busy}`);
    await api('messages/send', { room_id: busy, body: '5분 쉬고' }, tok.mom);
    got = await waitPush(3000);
    assert.equal(got.length, 1, '5분 넘게 조용했으면 저절로 풀림');
    assert.equal(open(got[0].body).quiet, undefined);
    await api('me/prefs', { push_quiet: true }, tok.dad);
    await api('me/prefs', { push_quiet: false }, tok.dad);
    await api('messages/send', { room_id: busy, body: '설정을 끄면' }, tok.mom);
    got = await waitPush(3000);
    assert.equal(got.length, 1, '설정을 끄면 다시 보냄');
    assert.equal(open(got[0].body).quiet, undefined);
    await api('push/unsubscribe', { endpoint: apple.endpoint }, tok.dad);
  });

  await t('방 설정: 알림 끄기·고정(나에게만), 이름 바꾸기·초대·나가기(안내 글)', async () => {
    const dad = await idOf(tok.mom, '아빠');
    const me = await idOf(tok.mom, '일래');
    let r = await api('rooms/create', { group_id: Number(family), member_ids: [dad], name: '장보기' }, tok.mom);
    const room = r.body.room.id;
    const view = async (token) => (await api('sync?since=0', undefined, token)).body;

    r = await api('rooms/prefs', { room_id: room, muted: true, pinned: true }, tok.dad);
    assert.equal(r.status, 200);
    let v = (await view(tok.dad)).rooms.find((x) => x.id === room);
    assert.equal(v.muted, 1); assert.equal(v.pinned, 1);
    v = (await view(tok.mom)).rooms.find((x) => x.id === room);
    assert.equal(v.muted, 0, '엄마 쪽은 그대로');

    r = await api('rooms/rename', { room_id: room, name: '주말 장보기' }, tok.dad);
    assert.equal(r.status, 200);
    let s2 = await view(tok.mom);
    assert.equal(s2.rooms.find((x) => x.id === room).name, '주말 장보기');
    let sys = s2.messages.filter((m) => m.room_id === room && m.kind === 'system').map((m) => m.body);
    assert.deepEqual(sys, ['아빠님이 방 이름을 "주말 장보기"(으)로 바꿨어요.']);
    assert.equal(s2.rooms.find((x) => x.id === room).unread, 0, '안내 글은 안 읽은 수에 안 셈');

    r = await api('rooms/invite', { room_id: room, user_ids: [me] }, tok.mom);
    assert.equal(r.status, 200);
    r = await api('rooms/invite', { room_id: room, user_ids: [await idOf(tok.f1, '친구1')] }, tok.me);
    assert.equal(r.status, 403, '다른 그룹 사람은 초대 못 함');
    s2 = await view(tok.me);
    assert.ok(s2.room_ids.includes(room));
    assert.ok(s2.messages.some((m) => m.room_id === room && m.body === '엄마곰님이 일래님을 초대했어요.'));

    r = await api('rooms/leave', { room_id: room }, tok.me);
    assert.equal(r.status, 200);
    s2 = await view(tok.me);
    assert.ok(!s2.room_ids.includes(room), '나간 방은 room_ids 에서 빠짐');
    r = await api('messages/send', { room_id: room, body: '나간 방' }, tok.me);
    assert.equal(r.status, 403);
    s2 = await view(tok.mom);
    assert.ok(s2.messages.some((m) => m.room_id === room && m.body === '일래님이 나갔어요.'));
    assert.equal(s2.rooms.find((x) => x.id === room).members.length, 2);

    // 1:1 방: 지우면 두 사람 모두에게서 사라지고, 다시 대화하면 빈 새 방
    const dm = (await api('rooms/dm', { user_id: dad }, tok.mom)).body.room.id;
    r = await api('rooms/rename', { room_id: dm, name: 'x' }, tok.mom);
    assert.equal(r.status, 400, '1:1 방은 이름 못 바꿈');
    await api('messages/send', { room_id: dm, body: '안녕' }, tok.mom);
    r = await api('rooms/leave', { room_id: dm }, tok.dad);
    assert.equal(r.status, 200);
    assert.ok(!(await view(tok.dad)).room_ids.includes(dm));
    assert.ok(!(await view(tok.mom)).room_ids.includes(dm), '상대에게서도 사라짐');
    r = await api('messages/send', { room_id: dm, body: '돌아와' }, tok.mom);
    assert.equal(r.status, 403, '지운 방에는 못 보냄');
    const dm2 = (await api('rooms/dm', { user_id: dad }, tok.mom)).body.room.id;
    assert.notEqual(dm2, dm, '다시 대화하면 새 방');
    v = await view(tok.dad);
    assert.ok(v.room_ids.includes(dm2));
    assert.ok(!v.messages.some((m) => m.room_id === dm2), '예전 메시지는 없음');

    // 여럿 방: 한 명만 남으면 방이 없어짐 (남은 사람 목록에서도)
    const solo = (await api('rooms/create', { group_id: v.rooms.find((x) => x.id === dm2).group_id, member_ids: [dad], name: '둘' }, tok.mom)).body.room.id;
    await api('rooms/leave', { room_id: solo }, tok.mom);
    assert.ok(!(await view(tok.dad)).room_ids.includes(solo), '혼자 남은 사람에게서도 사라짐');
  });

  await t('프로필·채팅방 사진: 올리면 모두에게 주소가 보이고, 로그인 없이 그 주소로 받음, 방 사진은 누구나 바꿈', async () => {
    // 1x1 JPEG
    const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    let r = await api('me/photo', { data: Buffer.from('not image').toString('base64') }, tok.mom);
    assert.equal(r.status, 400);
    r = await api('me/photo', { data: jpg.toString('base64') }, tok.mom);
    assert.equal(r.status, 200);
    const me = (await api('me', undefined, tok.mom)).body.me;
    assert.match(me.photo, /^[a-f0-9]{24}$/);
    const momInDad = (await api('me', undefined, tok.dad)).body.groups[0].members.find((m) => m.name === '엄마');
    assert.equal(momInDad.photo, me.photo);
    const res = await req('/api.php/photo/' + me.photo);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), jpg);
    assert.equal((await req('/api.php/photo/' + '0'.repeat(24))).status, 404);
    // 채팅방 사진: 방 사람 누구나, 새로 올리면 바뀌고 예전 주소는 없어짐
    const fam = (await api('sync?since=0', undefined, tok.mom)).body.rooms.find((x) => x.name === '우리 가족').id;
    r = await api('rooms/photo', { room_id: fam, data: jpg.toString('base64') }, tok.mom);
    assert.equal(r.status, 200);
    let room = (await api('sync?since=0', undefined, tok.dad)).body.rooms.find((x) => x.id === fam);
    assert.equal(room.photo_by, '엄마곰');
    const first = room.photo;
    assert.equal((await req('/api.php/photo/' + first)).status, 200);
    // 새 앱은 사진을 그대로(octet-stream) 보냄 (JSON 안 base64 는 카페24 웹 방화벽이 막아서)
    r = await req(`/api.php/rooms/photo?room_id=${fam}`, { method: 'POST', headers: { 'X-Talk-Token': tok.dad, 'Content-Type': 'application/octet-stream' }, body: jpg });
    assert.equal(r.status, 200);
    const s3 = (await api('sync?since=0', undefined, tok.mom)).body;
    room = s3.rooms.find((x) => x.id === fam);
    assert.equal(room.photo_by, '아빠');
    assert.notEqual(room.photo, first);
    assert.equal((await req('/api.php/photo/' + first)).status, 404, '예전 사진은 지워짐');
    assert.ok(s3.messages.some((m) => m.room_id === fam && m.body === '아빠님이 채팅방 사진을 바꿨어요.'));
    r = await api('rooms/photo', { room_id: fam, data: jpg.toString('base64') }, tok.f1);
    assert.equal(r.status, 403, '방 밖 사람은 못 바꿈');

    r = await api('me/photo', { data: '' }, tok.mom);
    assert.equal((await api('me', undefined, tok.mom)).body.me.photo, null, '지우기');
    assert.equal((await req('/api.php/photo/' + me.photo)).status, 404);

    // 사키 프로필 사진: 나만 보는 것 (me 에만 주소, 다른 사람 목록·프로필 사진은 그대로)
    assert.equal((await api('me', undefined, tok.mom)).body.me.saki_photo, null, '처음엔 기본');
    r = await api('me/saki-photo', { data: Buffer.from('nope').toString('base64') }, tok.mom);
    assert.equal(r.status, 400);
    r = await req('/api.php/me/saki-photo', { method: 'POST', headers: { 'X-Talk-Token': tok.mom, 'Content-Type': 'application/octet-stream' }, body: jpg });
    assert.equal(r.status, 200);
    const sp = (await api('me', undefined, tok.mom)).body.me.saki_photo;
    assert.match(sp, /^[a-f0-9]{24}$/);
    assert.equal((await api('me', undefined, tok.dad)).body.me.saki_photo, null, '다른 사람은 그대로');
    assert.equal((await req('/api.php/photo/' + sp)).status, 200);
    await api('me/saki-photo', { data: '' }, tok.mom);
    assert.equal((await api('me', undefined, tok.mom)).body.me.saki_photo, null, '기본으로 되돌림');
    assert.equal((await req('/api.php/photo/' + sp)).status, 404);
  });

  await t('사진·영상: 조각으로 올리고, 메시지로 보이고, 영상은 Range, 보관 기간이 지나면 지워짐', async () => {
    const room = (await api('rooms/dm', { user_id: await idOf(tok.mom, '아빠') }, tok.mom)).body.room.id;
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3 * 1024 * 1024)]); // 3MB 쯤 → 조각 2개
    let r = await api('media/start', { room_id: room, kind: 'photo', mime: 'image/gif', size: 10 }, tok.mom);
    assert.equal(r.status, 400, '모르는 종류');
    r = await api('media/start', { room_id: room, kind: 'video', mime: 'video/mp4', size: 41 * 1024 * 1024 }, tok.mom);
    assert.equal(r.status, 400, '너무 큰 영상');
    r = await api('media/start', { room_id: room, kind: 'photo', mime: 'image/jpeg', size: jpg.length, w: 1600, h: 1200 }, tok.f1);
    assert.equal(r.status, 403, '방 밖 사람');
    r = await api('media/start', { room_id: room, kind: 'photo', mime: 'image/jpeg', size: jpg.length, w: 1600, h: 1200 }, tok.mom);
    const key = r.body.key;
    const chunk = async (off, buf, token = tok.mom) => {
      const res = await req(`/api.php/media/chunk?key=${key}&offset=${off}`, { method: 'POST', headers: { 'X-Talk-Token': token, 'Content-Type': 'application/octet-stream' }, body: buf });
      return { status: res.status, body: await res.json() };
    };
    const C = 2 * 1024 * 1024;
    r = await chunk(0, jpg.subarray(0, C));
    assert.equal(r.body.received, C);
    r = await chunk(0, jpg.subarray(0, C));
    assert.equal(r.body.received, C, '같은 조각을 다시 보내면 지금 받은 크기만 알려 줌');
    r = await api('media/finish', { key, client_id: 'media-test-1' }, tok.mom);
    assert.equal(r.status, 400, '덜 받았으면 못 끝냄');
    r = await chunk(C, jpg.subarray(C), tok.dad);
    assert.equal(r.status, 404, '다른 사람은 못 이어 붙임');
    r = await chunk(C, jpg.subarray(C));
    assert.equal(r.body.received, jpg.length);
    r = await api('media/finish', { key, client_id: 'media-test-1' }, tok.mom);
    assert.equal(r.status, 200);
    assert.equal(r.body.message.kind, 'photo');
    const body = JSON.parse(r.body.message.body);
    assert.equal(body.key, key); assert.equal(body.w, 1600);
    const again = await api('media/finish', { key, client_id: 'media-test-1' }, tok.mom);
    assert.equal(again.body.message.id, r.body.message.id, '두 번 끝내도 메시지 하나');
    let res = await req('/api.php/media/' + key);
    assert.equal(res.status, 200);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(jpg), '받은 것과 같은 파일');
    const dadView = (await api('sync?since=0', undefined, tok.dad)).body.rooms.find((x) => x.id === room);
    assert.equal(dadView.last.kind, 'photo');

    // 모두에게 삭제: 보낸 사람만, 파일도 지워지고 다른 사람 동기화에 같은 번호로 "deleted"
    const cur = (await api('sync?since=0', undefined, tok.dad)).body.cursor;
    let d = await api('media/start', { room_id: room, kind: 'photo', mime: 'image/jpeg', size: 4 }, tok.mom);
    const dkey = d.body.key;
    await req(`/api.php/media/chunk?key=${dkey}&offset=0`, { method: 'POST', headers: { 'X-Talk-Token': tok.mom }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
    d = await api('media/finish', { key: dkey }, tok.mom);
    const mid = d.body.message.id;
    assert.equal((await api('messages/delete', { id: mid }, tok.dad)).status, 403, '남의 것은 못 지움');
    assert.equal((await api('messages/delete', { id: mid }, tok.f1)).status, 404, '방에 없는 사람');
    assert.equal((await api('messages/delete', { id: mid }, tok.mom)).status, 200);
    assert.equal((await req('/api.php/media/' + dkey)).status, 404, '파일도 지워짐');
    const after = (await api('sync?since=' + cur, undefined, tok.dad)).body;
    assert.equal(after.messages.find((x) => x.id === mid)?.kind, 'deleted');
    assert.equal(after.messages.find((x) => x.id === mid)?.body, '');

    // 영상: Range
    const mp4 = crypto.randomBytes(5000);
    r = await api('media/start', { room_id: room, kind: 'video', mime: 'video/mp4', size: mp4.length, dur: 12 }, tok.mom);
    assert.equal((await req(`/api.php/media/thumb?key=${r.body.key}`, { method: 'POST', headers: { 'X-Talk-Token': tok.mom, 'Content-Type': 'application/octet-stream' }, body: Buffer.from('nope') })).status, 400);
    assert.equal((await req(`/api.php/media/thumb?key=${r.body.key}`, { method: 'POST', headers: { 'X-Talk-Token': tok.mom, 'Content-Type': 'application/octet-stream' }, body: jpg.subarray(0, 1000) })).status, 200);
    const vkey = r.body.key;
    await req(`/api.php/media/chunk?key=${vkey}&offset=0`, { method: 'POST', headers: { 'X-Talk-Token': tok.mom }, body: mp4 });
    r = await api('media/finish', { key: vkey }, tok.mom);
    assert.equal(JSON.parse(r.body.message.body).thumb, true);
    res = await req('/api.php/media/' + vkey, { headers: { Range: 'bytes=100-199' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 100-199/5000');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(mp4.subarray(100, 200)));
    res = await req('/api.php/media/' + vkey + '/thumb');
    assert.equal(res.status, 200);

    // 보관 기간: 영상 3일 지난 것으로 바꾸고 다른 것을 올리면 정리됨
    execFileSync('mariadb', ['-h', dbHost, '-u', dbUser, `-p${dbPass}`, dbName, '-e', `UPDATE talk_media SET created_at = NOW() - INTERVAL 4 DAY WHERE mkey = '${vkey}'`]);
    r = await api('media/start', { room_id: room, kind: 'photo', mime: 'image/jpeg', size: 4 }, tok.mom);
    await req(`/api.php/media/chunk?key=${r.body.key}&offset=0`, { method: 'POST', headers: { 'X-Talk-Token': tok.mom }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
    await api('media/finish', { key: r.body.key }, tok.mom);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal((await req('/api.php/media/' + vkey)).status, 404, '지난 영상은 지워짐');
    assert.equal((await req('/api.php/media/' + key)).status, 200, '사진은 14일이라 남음');
    const msgs = (await api('sync?since=0', undefined, tok.dad)).body.messages.filter((m) => m.room_id === room && m.kind === 'video');
    assert.equal(JSON.parse(msgs.at(-1).body).gone, true, '메시지에 지워짐 표시');
  });

  await t('사진 묶음·채팅방 사진 모아보기·전달(같은 그룹만, 같은 파일), 묶음 한 장만 지워짐', async () => {
    const up = async (room, token, bytes = 4) => {
      const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(bytes)]);
      const r = await api('media/start', { room_id: room, kind: 'photo', mime: 'image/jpeg', size: buf.length, w: 800, h: 600 }, token);
      await req(`/api.php/media/chunk?key=${r.body.key}&offset=0`, { method: 'POST', headers: { 'X-Talk-Token': token, 'Content-Type': 'application/octet-stream' }, body: buf });
      return r.body.key;
    };
    const momId = await idOf(tok.me, '엄마'), dadId = await idOf(tok.me, '아빠'), f1Id = await idOf(tok.me, '친구1');
    const dm = (await api('rooms/dm', { user_id: momId }, tok.me)).body.room.id;
    const keys = [await up(dm, tok.me), await up(dm, tok.me), await up(dm, tok.me)];
    let r = await api('media/album', { keys: [keys[0]], client_id: 'album-test-1' }, tok.me);
    assert.equal(r.status, 400, '한 장은 묶음이 아님');
    r = await api('media/album', { keys, client_id: 'album-test-1' }, tok.mom);
    assert.equal(r.status, 404, '남이 올린 사진은 못 묶음');
    r = await api('media/album', { keys, client_id: 'album-test-1' }, tok.me);
    assert.equal(r.status, 200);
    const album = r.body.message;
    assert.equal(album.kind, 'photo');
    assert.deepEqual(JSON.parse(album.body).items.map((x) => x.key), keys);
    assert.equal((await api('media/album', { keys, client_id: 'album-test-1' }, tok.me)).body.message.id, album.id, '다시 보내도 메시지 하나');
    // 응답을 못 받아 다시 올린 사진으로 같은 client_id 를 다시 묶어도 서버 오류 없이 처음 것
    r = await api('media/album', { keys: [await up(dm, tok.me), await up(dm, tok.me)], client_id: 'album-test-1' }, tok.me);
    assert.equal(r.status, 200, '다시 올려 묶어도 오류 없음');
    assert.equal(r.body.message.id, album.id, '다시 올려 묶어도 메시지 하나');

    // 채팅방 사진 모아보기
    r = await api('rooms/photos?room_id=' + dm, undefined, tok.mom);
    assert.equal(r.status, 200);
    assert.equal(r.body.messages[0].id, album.id, '최근 것부터');
    assert.equal((await api('rooms/photos?room_id=' + dm, undefined, tok.f1)).status, 403, '방 밖 사람');

    // 전달: 같은 그룹(가족)의 방·친구에게만
    assert.equal((await api('messages/forward', { id: album.id, user_ids: [f1Id] }, tok.me)).status, 403, '다른 그룹 친구에게는 안 됨');
    const friendsRoom = (await api('rooms/dm', { user_id: f1Id }, tok.me)).body.room.id;
    assert.equal((await api('messages/forward', { id: album.id, room_ids: [friendsRoom] }, tok.me)).status, 403, '다른 그룹 방에는 안 됨');
    assert.equal((await api('messages/forward', { id: album.id, user_ids: [dadId] }, tok.f1)).status, 404, '못 보는 메시지');
    assert.equal((await api('messages/forward', { id: album.id }, tok.me)).status, 400, '받을 곳 없음');
    r = await api('messages/forward', { id: album.id, user_ids: [dadId], index: 1 }, tok.me);
    assert.equal(r.status, 200);
    const one = r.body.messages[0];
    assert.equal(JSON.parse(one.body).key, keys[1], '묶음의 한 장만, 같은 파일');
    const fam = (await api('sync?since=0', undefined, tok.me)).body.rooms.find((x) => x.name === '우리 가족').id;
    r = await api('messages/forward', { id: album.id, room_ids: [fam], user_ids: [dadId] }, tok.me);
    assert.equal(r.status, 200);
    const fwd = r.body.messages;
    assert.deepEqual(fwd.map((m) => m.room_id), [fam, one.room_id]);
    assert.equal(JSON.parse(fwd[0].body).items.length, 3, '묶음 통째로');
    r = await api('messages/send', { room_id: dm, body: '전달할 글' }, tok.me);
    r = await api('messages/forward', { id: r.body.message.id, user_ids: [dadId] }, tok.me);
    assert.equal(r.body.messages[0].body, '전달할 글');

    // 원래 묶음을 모두에게 삭제해도 전달한 곳의 파일은 남음
    assert.equal((await api('messages/delete', { id: album.id }, tok.me)).status, 200);
    for (const k of keys) assert.equal((await req('/api.php/media/' + k)).status, 200, '전달한 곳이 쓰고 있어서 남음');
    // 전달한 묶음도 다 지우면 그제야 지워짐 (한 장만 전달한 keys[1] 은 남음)
    for (const m of fwd) assert.equal((await api('messages/delete', { id: m.id }, tok.me)).status, 200);
    assert.equal((await req('/api.php/media/' + keys[0])).status, 404);
    assert.equal((await req('/api.php/media/' + keys[2])).status, 404);
    assert.equal((await req('/api.php/media/' + keys[1])).status, 200);

    // 보관 기간: 묶음의 한 장만 지나면 그 한 장만 gone
    const k2 = [await up(dm, tok.me), await up(dm, tok.me)];
    const a2 = (await api('media/album', { keys: k2, client_id: 'album-test-2' }, tok.me)).body.message;
    execFileSync('mariadb', ['-h', dbHost, '-u', dbUser, `-p${dbPass}`, dbName, '-e', `UPDATE talk_media SET created_at = NOW() - INTERVAL 20 DAY WHERE mkey = '${k2[0]}'`]);
    await api('media/album', { keys: [await up(dm, tok.me), await up(dm, tok.me)], client_id: 'album-test-3' }, tok.me);
    await new Promise((ok) => setTimeout(ok, 300));
    const b2 = JSON.parse((await api('rooms/photos?room_id=' + dm, undefined, tok.mom)).body.messages.find((m) => m.id === a2.id).body);
    assert.equal(b2.items[0].gone, true);
    assert.ok(!b2.items[1].gone && !b2.gone, '나머지는 그대로');
    assert.equal((await req('/api.php/media/' + k2[0])).status, 404);
  });

  await t('이미 가입한 사람이 초대 코드로 다른 그룹에 들어감', async () => {
    const inv = inviteOf(await adminPost({ act: 'invite', group: friends, uses: '1', days: '1' }));
    let r = await api('groups/join', { invite: inv }, tok.mom);
    assert.deepEqual(r.body.groups.map((g) => g.name), ['가족', '친구']);
    const f1 = await idOf(tok.mom, '친구1');
    r = await api('rooms/dm', { user_id: f1 }, tok.mom);
    assert.equal(r.status, 200);
  });

  // ───── 사키 (SAKi Lite 봇) ─────
  let sakiRoom, botId;
  const roomOf = async (token) => (await api('sync?since=0', undefined, token)).body.rooms.find((x) => x.id === sakiRoom);
  const msgsOf = async (token) => (await api('messages/history?room_id=' + sakiRoom + '&before=0', undefined, token)).body.messages;
  const botMsgs = async () => (await msgsOf(tok.mom)).filter((m) => m.user_id === botId && m.kind === 'text');
  const replies = () => lite.calls.filter((c) => c.route === 'lite/reply');
  // 보내고 나서 응답 뒤 일(알림·사키 부르기)이 끝날 때까지: php -S 는 요청을 하나씩 처리하므로 다음 요청이 돌아오면 끝난 것
  const say = async (body, token) => { const r = await api('messages/send', { room_id: sakiRoom, ...body }, token); await fetch(BASE + '/api.php/health'); return r; };

  await t('사키: 열쇠가 없으면 부를 수 없음, 관리 화면에서 열쇠를 넣으면 확인하고 끝 4자만 보여 줌', async () => {
    const dad = await idOf(tok.mom, '아빠');
    const admin = await idOf(tok.mom, '일래');
    sakiRoom = (await api('rooms/create', { group_id: Number(family), member_ids: [dad, admin], name: '소풍방' }, tok.mom)).body.room.id;
    let room = await roomOf(tok.mom);
    assert.equal(room.saki.ready, false);
    const cur = (await api('sync?since=0', undefined, tok.mom)).body;
    assert.equal(cur.saki_ready, false);
    assert.equal(room.saki.on, 0);
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, on: true }, tok.mom)).status, 503);
    let html = await adminPost({ act: 'saki_key', key: 'short key!' });
    assert.match(html, /열쇠 모양이 아니에요/);
    html = await adminPost({ act: 'saki_key', key: SAKI_KEY });
    assert.match(html, /열쇠를 저장했어요/);
    const changed = (await api('sync?since=' + cur.cursor, undefined, tok.mom)).body;
    assert.ok(changed.rooms.some((x) => x.id === sakiRoom && x.saki.ready), '열쇠를 넣으면 예전에 받아 둔 방도 다시 내려감');
    assert.match(html, /잘 됨/);
    assert.ok(html.includes('····' + SAKI_KEY.slice(-4)));
    assert.ok(!html.includes(SAKI_KEY), '관리 화면에 열쇠 전체가 안 보임');
    assert.equal(lite.calls.at(-1).route, 'lite/status');
    assert.equal(lite.calls.at(-1).key, SAKI_KEY);
    html = await adminPost({ act: 'saki_status' });
    assert.match(html, /오늘 \$0\.012 \/ \$0\.20/);
    assert.match(html, /사키 사용량/);
    assert.match(html, /<b>\$0\.012<\/b> \/ \$0\.20/);
    assert.match(html, /요청 3번/);
    room = await roomOf(tok.mom);
    assert.equal(room.saki.ready, true);
    assert.equal((await api('sync?since=0', undefined, tok.dad)).body.saki_ready, true, '동기화에도 열쇠가 들어갔는지');
  });

  await t('사키: 방장·관리자만 초대, 초대하면 방 멤버에 봇과 안내 글, 봇은 로그인 못 함', async () => {
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, on: true }, tok.dad)).status, 403, '방장이 아님');
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, on: true, personality: 'evil' }, tok.mom)).status, 400);
    const dm2 = (await api('rooms/dm', { user_id: await idOf(tok.mom, '아빠') }, tok.mom)).body.room.id;
    assert.equal((await api('rooms/saki', { room_id: dm2, on: true }, tok.mom)).status, 400, '1:1 방은 안 됨');
    const r = await api('rooms/saki', { room_id: sakiRoom, on: true, personality: 'tsundere', polite: true }, tok.mom);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.saki, { on: 1, personality: 'tsundere', polite: 1, freq: 'called', gap: 10, react: 1, memory: 0 });
    const room = await roomOf(tok.dad);
    const bot = room.members.find((m) => m.bot);
    assert.ok(bot && bot.nick === '사키');
    botId = bot.id;
    assert.equal(room.last.body, '사키가 들어왔어요.');
    assert.equal((await api('me', undefined, tok.mom)).body.groups.flatMap((g) => g.members).some((m) => m.id === botId), false, '친구 목록에는 안 나옴');
    assert.equal((await api('auth/login', { name: '사키', password: '!' })).status, 401);
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, gap: 1 }, tok.me)).body.saki.gap, 5, '관리자도 바꿈, 간격은 5~120분');
  });

  await t('사키: 이름을 부르면 최근 대화를 Lite 에 보내고, 봇 메시지(https 링크만)·반응·웹 푸시, 입력 중은 꺼짐', async () => {
    const sub = { endpoint: PUSH_PREFIX + 'dad-saki', keys: { p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
    assert.equal((await api('push/subscribe', sub, tok.dad)).status, 200);
    await say({ body: '내일 소풍 가는데' }, tok.mom);
    assert.equal(replies().length, 0, '부르지 않으면 안 부름');
    pushes.length = 0;
    const call = (await say({ body: '사키야 내일 날씨 어때?' }, tok.dad)).body.message;
    assert.equal(replies().length, 1);
    const c = replies()[0];
    assert.equal(c.key, SAKI_KEY);
    assert.equal(c.body.personality, 'tsundere');
    assert.equal(c.body.polite, true);
    assert.equal(c.body.mode, 'called');
    assert.equal(c.body.name, '사키');
    assert.equal(c.body.room, '소풍방');
    assert.deepEqual(c.body.messages.map(({ at, ...x }) => x), [{ name: '엄마곰', text: '내일 소풍 가는데' }, { name: '아빠', text: '사키야 내일 날씨 어때?' }], '안내 글은 빼고 닉네임으로');
    assert.ok(c.body.messages.every((x) => /^\d\d:\d\d$/.test(x.at)), '보낸 시각 HH:MM');
    assert.equal(c.body.members, undefined, '관계를 아무도 안 적었으면 members 없음');
    assert.equal(c.body.budget_notice, true);
    assert.match(c.body.app, /SAKi Talk/);
    assert.ok(c.body.app.length <= 1500);
    const [bm] = await botMsgs();
    assert.match(bm.body, /내일은 맑대/);
    assert.deepEqual(bm.links.map((l) => l.url), ['https://www.kma.go.kr/weather', 'https://www.youtube.com/results?search_query=%EC%86%8C%ED%92%8D']);
    assert.equal(bm.links[1].kind, 'youtube');
    const called = (await msgsOf(tok.mom)).find((m) => m.id === call.id);
    assert.deepEqual(called.reactions, [[botId, '😊']]);
    for (let i = 0; i < 40 && !pushes.some((p) => p.path === '/push/dad-saki'); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(pushes.some((p) => p.path === '/push/dad-saki'), '봇 메시지도 웹 푸시');
    assert.deepEqual((await api('sync?since=0&active=1&room=' + sakiRoom, undefined, tok.mom)).body.typing, [], '봇 입력 중 표시는 꺼짐');
    assert.equal(replies().length, 1, '봇 메시지(글에 "사키"가 있어도)는 다시 부르지 않음');
    await api('push/unsubscribe', { endpoint: sub.endpoint }, tok.dad);
  });

  await t('사키: "매뉴얼 보여줘"는 Lite 를 부르지 않고 성격 말투로 사용법 링크', async () => {
    const n = replies().length;
    await say({ body: '사키야 매뉴얼 보여줘' }, tok.dad);
    assert.equal(replies().length, n, 'Lite 안 부름');
    const m = (await botMsgs()).at(-1);
    assert.match(m.body, /사용법/);
    assert.match(m.body, /이번만 알려 드리는/, '츤데레 + 존댓말');
    assert.equal(m.links.length, 1);
    assert.match(m.links[0].url, /^https:\/\/127\.0\.0\.1:\d+\/talk\/manual\/$/);
    if (fs.existsSync(path.join(www, 'talk', 'manual', 'index.html'))) assert.equal((await fetch(BASE + '/manual/')).status, 200);
  });

  await t('사키: 사키 메시지에 답장하면 부름, 부르는 중이면 새로 안 부름, 열쇠는 앱 응답·로그에 없음', async () => {
    const [bm] = await botMsgs();
    await say({ body: '고마워', reply_to: bm.id }, tok.mom);
    assert.equal(replies().length, 2);
    assert.ok(replies()[1].body.messages.some((x) => x.bot && x.name === '사키' && x.text === bm.body), '사키의 지난 말은 bot: true');
    sql(`INSERT INTO talk_meta (k, v) VALUES ('saki_busy:${sakiRoom}', UNIX_TIMESTAMP())`);
    await say({ body: '사키 또 불러' }, tok.mom);
    assert.equal(replies().length, 2, '부르는 중이면 버림');
    sql(`UPDATE talk_meta SET v = UNIX_TIMESTAMP() - 61 WHERE k = 'saki_busy:${sakiRoom}'`);
    await say({ body: '사키 다시' }, tok.mom);
    assert.equal(replies().length, 3, '60초 지난 표시는 무효');
    const all = JSON.stringify([(await api('sync?since=0', undefined, tok.mom)).body, (await api('me', undefined, tok.me)).body]);
    assert.ok(!all.includes(SAKI_KEY) && !phpLog.includes(SAKI_KEY));
    const usage = await (await req('/setup.php')).text();
    assert.match(usage, /소풍방 · \d+번 \/ \d+번/, '방별 사키 대답 수');
  });

  await t('사키: 가끔 끼어들기는 간격이 지나고 사람 메시지가 3개 쌓이면 한 번, pass 면 아무것도 안 올림', async () => {
    await api('rooms/saki', { room_id: sakiRoom, freq: 'chime', gap: 10 }, tok.mom);
    lite.mode = 'pass';
    const before = (await botMsgs()).length;
    const n = replies().length;
    await say({ body: '점심은?' }, tok.dad);
    await say({ body: '뭐 먹지' }, tok.mom);
    assert.equal(replies().length, n, '사키가 방금 말해서 간격이 안 지남');
    sql(`UPDATE talk_messages SET created_at = created_at - INTERVAL 11 MINUTE WHERE room_id = ${sakiRoom}`);
    await say({ body: '김밥' }, tok.mom);
    assert.equal(replies().length, n + 1, '간격이 지났고 사람 메시지 3개');
    assert.equal(replies().at(-1).body.mode, 'chime');
    await say({ body: '좋아' }, tok.dad);
    assert.equal(replies().length, n + 1, '방금 끼어들기를 물어봐서 간격이 안 지남');
    assert.equal((await botMsgs()).length, before, 'pass 면 안 올림');
    // 조용할 때 대답: 마지막 사람 글이 5분 넘게 대답이 없으면 누구의 동기화든 한 번 (called), 같은 글에는 다시 안 함
    lite.mode = 'reply';
    const syncS = async (tk) => { await api('sync?since=0', undefined, tk); await fetch(BASE + '/api.php/health'); };
    await syncS(tok.dad);
    assert.equal(replies().length, n + 1, '아직 5분이 안 지남');
    sql(`UPDATE talk_messages SET created_at = created_at - INTERVAL 6 MINUTE WHERE room_id = ${sakiRoom}`);
    await syncS(tok.dad);
    assert.equal(replies().length, n + 2);
    assert.equal(replies().at(-1).body.mode, 'called');
    assert.equal(replies().at(-1).body.messages.at(-1).text, '좋아');
    assert.equal((await botMsgs()).length, before + 1);
    await syncS(tok.mom);
    assert.equal(replies().length, n + 2, '마지막이 사키 말이면 안 함');
    await say({ body: '그럼 내일 봐' }, tok.dad);
    sql(`UPDATE talk_messages SET created_at = created_at - INTERVAL 2 HOUR WHERE room_id = ${sakiRoom}`);
    await syncS(tok.mom);
    assert.equal(replies().length, n + 2, '1시간 넘게 지난 글은 안 함');
    await api('rooms/saki', { room_id: sakiRoom, freq: 'called' }, tok.mom);
  });

  await t('사키: 관계(내 것은 나, 남의 것은 방장)·90% 안내는 방마다 하루 한 번·하루 요약', async () => {
    const dad = await idOf(tok.mom, '아빠');
    const admin = await idOf(tok.mom, '일래');
    const mom = (await api('me', undefined, tok.mom)).body.me.id;
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, relation: '아빠, <회사원>' }, tok.dad)).status, 200, '내 관계는 내가');
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, relation_user: mom, relation: '엄마' }, tok.dad)).status, 403, '남의 것은 방장·관리자만');
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, relation_user: admin, relation: '나' }, tok.mom)).status, 200);
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, relation_user: botId, relation: '봇' }, tok.mom)).status, 200, '봇은 조용히 무시');
    const room = await roomOf(tok.dad);
    assert.equal(room.members.find((m) => m.id === dad).relation, '아빠,  회사원');
    assert.equal(room.members.find((m) => m.id === mom).relation, undefined);
    assert.equal(room.members.find((m) => m.bot).relation, undefined);
    lite.budget = true;
    await say({ body: '사키야 우리 누구누구 있어?' }, tok.dad);
    let c = replies().at(-1).body;
    assert.deepEqual(c.members.filter((m) => m.relation).sort((a, b) => a.name.localeCompare(b.name)), [{ name: '아빠', relation: '아빠,  회사원' }, { name: '일래', relation: '나' }]);
    assert.ok(c.members.some((m) => m.name === '엄마곰' && !m.relation) && !c.members.some((m) => m.name === '사키'), '안 적은 사람은 이름만, 봇은 뺌');
    assert.equal(c.budget_notice, true);
    await say({ body: '사키야 또 불러 봄' }, tok.dad);
    assert.equal(replies().at(-1).body.budget_notice, undefined, '안내를 붙였다는 답을 받은 날은 다시 안 보냄');
    lite.budget = false;
    // 하루 요약: 오늘 대화를 300개까지 (보통은 30개)
    sql(`INSERT INTO talk_messages (room_id, user_id, kind, body, created_at) SELECT ${sakiRoom}, ${dad}, 'text', CONCAT('수다 ', seq), UTC_TIMESTAMP() FROM seq_1_to_40`);
    await say({ body: '사키야 이거 봐' }, tok.dad);
    assert.equal(replies().at(-1).body.messages.length, 30);
    await say({ body: '사키야 오늘 무슨 얘기 했어?' }, tok.mom);
    c = replies().at(-1).body;
    assert.equal(c.mode, 'summary');
    assert.match(c.range, /^(오늘 \(\d+월 \d+일\)|최근 24시간)$/);
    assert.ok(c.messages.length > 40, '30개보다 많이');
    assert.equal(c.messages.at(-1).text, '사키야 오늘 무슨 얘기 했어?');
    assert.equal(c.app, undefined);
    assert.equal(c.budget_notice, undefined);
    sql(`DELETE FROM talk_messages WHERE room_id = ${sakiRoom} AND body LIKE '수다 %'`); // 아래 시험의 기록 한 쪽(최근 메시지)을 밀어내지 않게
  });

  await t('사키: 방별 기억 — 켜야만 정리·싣기, 40개마다 한 번, 날이 바뀌면 지난 날 것만 일기와, 실패면 그대로, 누구나 고침', async () => {
    const dad = await idOf(tok.mom, '아빠');
    const remembers = () => lite.calls.filter((c) => c.route === 'lite/reply' && c.body?.mode === 'remember');
    const talks = () => lite.calls.filter((c) => c.route === 'lite/reply' && c.body?.mode !== 'remember');
    const chat = (n, at = 'UTC_TIMESTAMP()') => sql(`INSERT INTO talk_messages (room_id, user_id, kind, body, created_at) SELECT ${sakiRoom}, ${dad}, 'text', CONCAT('잡담 ', seq), ${at} FROM seq_1_to_${n}`);
    const mem = () => sql(`SELECT CONCAT(upto, '|', day, '|', memory) FROM talk_saki_memory WHERE room_id = ${sakiRoom}`);
    // 기억 꺼짐(기본): 40개가 넘어도 안 부르고, 부를 때 안 실음
    assert.equal((await roomOf(tok.mom)).saki.memory, 0);
    chat(120);
    await say({ body: '사키야 안녕' }, tok.dad);
    assert.equal(remembers().length, 0);
    assert.equal(talks().at(-1).body.room_memory, undefined);
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, memory: true }, tok.dad)).status, 403, '켜고 끄기는 방장·관리자');
    assert.equal((await api('rooms/saki', { room_id: sakiRoom, memory: true }, tok.mom)).body.saki.memory, 1);
    // 켜면 바로 최근 100개로 한 번에 시작
    await fetch(BASE + '/api.php/health');
    assert.equal(remembers().length, 1);
    let c0 = remembers()[0].body;
    assert.equal(c0.memory, '');
    assert.equal(c0.messages.length, 100);
    assert.equal(c0.messages.at(-1).text, (await msgsOf(tok.mom)).filter((m) => ['text', 'photo', 'video'].includes(m.kind)).at(-1).body, '최근 것까지');
    // 그 뒤로는 사람 메시지 39개 → 안 부름, 40개째 → 한 번
    chat(38);
    await say({ body: '하나' }, tok.dad);
    assert.equal(remembers().length, 1);
    await say({ body: '둘' }, tok.mom);
    assert.equal(remembers().length, 2);
    let c = remembers()[1].body;
    assert.notEqual(c.memory, '', '처음 정리한 기억 위에 이어 씀');
    assert.equal(c.diary, undefined);
    assert.equal(c.messages.length, 40);
    assert.equal(c.messages.at(-1).text, '둘');
    assert.ok(c.messages.every((m) => /^\d\d:\d\d$/.test(m.at)));
    let [upto, , memory] = mem().split('|');
    assert.match(memory, /^\[사람\]/);
    await say({ body: '셋' }, tok.mom);
    assert.equal(remembers().length, 2, '정리 뒤로는 다시 40개가 쌓여야');
    // 부를 때 기억을 실음
    await say({ body: '사키야 나 기억해?' }, tok.dad);
    assert.equal(talks().at(-1).body.room_memory, memory);
    // 방 사람 누구나 고침 → 다음 부르기에 실림
    let r = await api('rooms/saki_memory', { room_id: sakiRoom }, tok.dad);
    assert.equal(r.body.memory, memory);
    r = await api('rooms/saki_memory', { room_id: sakiRoom, memory: '[사람]\n- 아빠: 등산 좋아함' }, tok.dad);
    assert.equal(r.status, 200);
    await say({ body: '사키 등산 갈래?' }, tok.dad);
    assert.equal(talks().at(-1).body.room_memory, '[사람]\n- 아빠: 등산 좋아함');
    // 상한·오류면 아무것도 안 바뀌고 다음 메시지 때 다시
    const before = mem();
    lite.remember = 'limited';
    chat(45);
    await say({ body: '넷' }, tok.mom);
    assert.equal(remembers().length, 3);
    assert.equal(mem(), before);
    lite.remember = 'error';
    await say({ body: '다섯' }, tok.mom);
    assert.equal(remembers().length, 4);
    assert.equal(mem(), before);
    lite.remember = 'ok';
    await say({ body: '여섯' }, tok.mom);
    assert.equal(remembers().length, 5);
    assert.equal(remembers().at(-1).body.memory, '[사람]\n- 아빠: 등산 좋아함', '고친 기억을 바탕으로 고쳐 씀');
    assert.notEqual(mem(), before);
    // 날이 바뀜: 지난 날 남은 메시지만 + diary(그날 이름) → 일기 저장, 오늘 것은 다음으로
    const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
    const yday = kst(Date.now() - 86400e3);
    sql(`UPDATE talk_saki_memory SET day = '${yday}' WHERE room_id = ${sakiRoom}`);
    sql(`INSERT INTO talk_messages (room_id, user_id, kind, body, created_at) VALUES (${sakiRoom}, ${dad}, 'text', '어제 삼겹살', '${yday} 03:00:00'), (${sakiRoom}, ${dad}, 'photo', '', '${yday} 03:01:00')`);
    await say({ body: '오늘 첫 글' }, tok.mom);
    assert.equal(remembers().length, 6);
    c = remembers().at(-1).body;
    assert.equal(c.diary, `${Number(yday.slice(5, 7))}월 ${Number(yday.slice(8, 10))}일`);
    assert.deepEqual(c.messages.map((m) => m.text), ['어제 삼겹살', '(사진)'], '지난 날 것만');
    assert.equal(mem().split('|')[1], kst(Date.now()), '정리한 날짜는 오늘로');
    r = await api('rooms/saki_memory', { room_id: sakiRoom }, tok.mom);
    assert.deepEqual(r.body.diary.map((d) => d.day), [yday]);
    assert.match(r.body.diary[0].text, /어제 삼겹살/);
    await say({ body: '사키야 어제 뭐 먹었지?' }, tok.dad);
    assert.deepEqual(talks().at(-1).body.room_diary, [{ day: `${Number(yday.slice(5, 7))}/${Number(yday.slice(8, 10))}`, text: r.body.diary[0].text }]);
    assert.equal(remembers().length, 6, '오늘 것은 40개가 쌓여야');
    // 일기 고치기·지우기 (누구나)
    r = await api('rooms/saki_memory', { room_id: sakiRoom, diary_day: yday, diary_text: '삼겹살 먹은 날' }, tok.dad);
    assert.equal(r.body.diary[0].text, '삼겹살 먹은 날');
    // 끄면 정리도 싣기도 안 함, forget 이 없으면 기억은 남음
    await api('rooms/saki', { room_id: sakiRoom, memory: false }, tok.mom);
    chat(45);
    await say({ body: '사키야 아직 기억해?' }, tok.dad);
    assert.equal(remembers().length, 6);
    assert.equal(talks().at(-1).body.room_memory, undefined);
    assert.equal(talks().at(-1).body.room_diary, undefined);
    assert.ok(mem() !== '', '지우기를 고르지 않으면 남겨 둠');
    // 다시 켜고 "지우기"로 끄면 기억·일기 모두 없어짐
    await api('rooms/saki', { room_id: sakiRoom, memory: true }, tok.mom);
    await api('rooms/saki', { room_id: sakiRoom, memory: false, forget: true }, tok.mom);
    assert.equal(mem(), '');
    assert.equal(sql(`SELECT COUNT(*) FROM talk_saki_diary WHERE room_id = ${sakiRoom}`), '0');
    // 다음 시험을 위해 남은 기억 하나 (방을 지우면 같이 지워지는지)
    sql(`INSERT INTO talk_saki_memory (room_id, memory, updated_at) VALUES (${sakiRoom}, '남은 기억', UTC_TIMESTAMP())`);
    sql(`INSERT INTO talk_saki_diary (room_id, day, body) VALUES (${sakiRoom}, '${yday}', '남은 일기')`);
    sql(`DELETE FROM talk_messages WHERE room_id = ${sakiRoom} AND body LIKE '잡담 %'`);
  });

  await t('사키: 하루 상한 거절 말은 방마다 하루 한 번만, 401·503 이면 조용히 쉬고 관리 화면에 보임', async () => {
    lite.mode = 'limited';
    const before = (await botMsgs()).length;
    await say({ body: '사키야 하나 더' }, tok.dad);
    assert.equal((await botMsgs()).at(-1).body, '오늘은 여기까지 할게…');
    const n = replies().length;
    await say({ body: '사키야 또' }, tok.dad);
    assert.equal(replies().length, n, '그날은 다시 안 부름');
    assert.equal((await botMsgs()).length, before + 1);
    sql(`DELETE FROM talk_meta WHERE k = 'saki_limited:${sakiRoom}'`);
    lite.mode = 'badkey';
    await say({ body: '사키?' }, tok.dad);
    assert.equal((await botMsgs()).length, before + 1, '401 이면 안 올림');
    let html = await (await req('/setup.php')).text();
    assert.match(html, /열쇠가 맞지 않아요/);
    lite.mode = 'off';
    html = await adminPost({ act: 'saki_status' });
    assert.match(html, /꺼짐/);
    lite.mode = 'reply';
    lite.pathInfo = false;
    await say({ body: '사키 돌아왔어?' }, tok.dad);
    assert.equal((await botMsgs()).length, before + 2, 'PATH_INFO 가 안 되면 ?r= 로');
    assert.equal(lite.calls.at(-1).route, 'lite/reply');
    lite.pathInfo = true;
    assert.ok(!html.includes(SAKI_KEY));
  });

  await t('사키: 초대를 끄면 봇이 나가고 더는 안 부름, 사람 한 명 + 봇만 남으면 방이 없어짐', async () => {
    let r = await api('rooms/saki', { room_id: sakiRoom, on: false }, tok.mom);
    assert.equal(r.body.saki.on, 0);
    let room = await roomOf(tok.mom);
    assert.ok(!room.members.some((m) => m.bot));
    assert.equal(room.last.body, '사키가 나갔어요.');
    const n = replies().length;
    await say({ body: '사키야?' }, tok.dad);
    assert.equal(replies().length, n);
    await api('rooms/saki', { room_id: sakiRoom, on: true }, tok.mom);
    await api('rooms/leave', { room_id: sakiRoom }, tok.dad);
    assert.ok(await roomOf(tok.mom));
    await api('rooms/leave', { room_id: sakiRoom }, tok.me);
    assert.equal(await roomOf(tok.mom), undefined);
    assert.equal(sql(`SELECT (SELECT COUNT(*) FROM talk_saki_memory WHERE room_id = ${sakiRoom}) + (SELECT COUNT(*) FROM talk_saki_diary WHERE room_id = ${sakiRoom})`), '0', '방을 지우면 사키 기억·일기도');
  });

  await t('위치·장소: 열쇠 없으면 좌표만, 내 위치는 서버가 동 이름·지도 사진, 장소 검색(이름·주소), 전달, 로그인 없이 지도 사진', async () => {
    const momId = await idOf(tok.me, '엄마'), f1Id = await idOf(tok.me, '친구1');
    const dm = (await api('rooms/dm', { user_id: momId }, tok.me)).body.room.id;
    // 지도 열쇠가 없을 때 (검색 열쇠만): 위치는 좌표만으로 보내짐
    let r = await api('me', undefined, tok.me);
    assert.deepEqual(r.body.naver, { map: false, search: true });
    r = await api('place/send', { room_id: dm, lat: 37.5666103, lng: 126.9783882, here: true, client_id: 'place-nokey-1' }, tok.me);
    assert.equal(r.status, 200);
    let p = JSON.parse(r.body.message.body);
    assert.equal(r.body.message.kind, 'place');
    assert.equal(p.name, '내 위치');
    assert.equal(p.map, null);
    // 지도 열쇠를 넣으면
    await adminPost({ act: 'naver_key', id: NAVER.id, secret: NAVER.secret });
    assert.deepEqual((await api('me', undefined, tok.me)).body.naver, { map: true, search: true });
    r = await api('place/lookup', { lat: 37.5666103, lng: 126.9783882 }, tok.me);
    assert.equal(r.body.place.area, '서울특별시 중구 태평로1가');
    assert.equal(r.body.place.road, '서울특별시 중구 세종대로 110 (서울특별시청)');
    assert.equal((await api('place/lookup', { lat: 0, lng: 0 }, tok.me)).status, 400);
    // 내 위치: 앱이 보낸 이름은 무시하고 서버가 찾은 동 이름
    r = await api('place/send', { room_id: dm, lat: 37.5666103, lng: 126.9783882, here: true, name: '<script>', client_id: 'place-here-1' }, tok.me);
    const here = r.body.message;
    p = JSON.parse(here.body);
    assert.equal(p.name, '서울특별시 중구 태평로1가');
    assert.equal(p.addr, '서울특별시 중구 태평로1가 31');
    assert.match(p.map, /^[a-f0-9]{24}$/);
    const img = await req('/api.php/map/' + p.map);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), FAKE_MAP);
    assert.equal((await req('/api.php/map/' + 'a'.repeat(24))).status, 404);
    const before = naverCalls.length;
    assert.equal((await api('place/send', { room_id: dm, lat: 37.5, lng: 127, here: true, client_id: 'place-here-1' }, tok.me)).body.message.id, here.id, '재전송은 같은 메시지');
    assert.equal(naverCalls.length, before, '재전송이면 네이버를 다시 안 부름');
    // 방 밖 사람은 못 보냄, 이상한 좌표·이름 없는 장소는 거절
    assert.equal((await api('place/send', { room_id: dm, lat: 37.5, lng: 127, here: true }, tok.f1)).status, 403);
    assert.equal((await api('place/send', { room_id: dm, lat: 99, lng: 127, here: true }, tok.me)).status, 400);
    assert.equal((await api('place/send', { room_id: dm, lat: 37.5, lng: 127, here: false }, tok.me)).status, 400);
    // 장소 검색: 이름(API HUB, 좌표 ÷ 10,000,000, 태그 지움, 이상한 좌표는 뺌) + 주소(Geocoding)
    r = await api('place/search?q=' + encodeURIComponent('서울시청'), undefined, tok.me);
    assert.equal(r.status, 200);
    assert.equal(r.body.places.length, 1);
    assert.deepEqual(r.body.places[0], { name: '서울시청', cat: '공공,사회기관>시청', addr: '서울특별시 중구 태평로1가 31', road: '서울특별시 중구 세종대로 110', tel: '', lat: 37.5666103, lng: 126.9783882 });
    r = await api('place/search?q=' + encodeURIComponent('세종대로 110'), undefined, tok.me);
    assert.equal(r.body.places.at(-1).cat, '주소');
    assert.equal(r.body.places.at(-1).name, '서울특별시 중구 세종대로 110 서울특별시청');
    assert.deepEqual((await api('place/search?q=', undefined, tok.me)).body.places, []);
    // 검색에서 고른 장소 보내기: 이름·주소는 앱이 보낸 것, 알림 글에 장소 이름
    r = await api('place/send', { room_id: dm, ...r.body.places[0], name: '서울시청', here: false, client_id: 'place-pick-1' }, tok.me);
    p = JSON.parse(r.body.message.body);
    assert.equal(p.name, '서울시청');
    assert.equal(p.here, false);
    assert.ok(p.map);
    // 전달: 같은 지도 사진 그대로
    r = await api('messages/forward', { id: r.body.message.id, room_ids: [], user_ids: [await idOf(tok.me, '아빠')] }, tok.me);
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body.messages[0].body).map, p.map);
    assert.equal(r.body.messages[0].kind, 'place');
    // 상대 화면 동기화에도 보임
    const seen = (await api('messages/history?room_id=' + dm + '&before=0', undefined, tok.mom)).body.messages.filter((m) => m.kind === 'place');
    assert.equal(seen.length, 3);
    assert.ok(f1Id > 0);
  });

  await t('관리: 백업 내려받기 (읽기용 txt·옮기기용 json, 비밀번호는 안 들어감)', async () => {
    const txt = await adminPost({ act: 'backup_txt' });
    assert.match(txt, /SAKi Talk 대화 백업/);
    assert.match(txt, /김치찌개/);
    assert.match(txt, /\[사진\]/);
    assert.match(txt, /\[위치\] 서울특별시 중구 태평로1가 서울특별시 중구 세종대로 110/);
    assert.match(txt, /\[장소\] 서울시청/);
    const raw = await adminPost({ act: 'backup_json' });
    const j = JSON.parse(raw);
    assert.ok(j.messages.length > 5 && j.users.length >= 4 && j.rooms.length >= 2);
    assert.ok(!/pass_hash|password|token/i.test(raw), '비밀번호·토큰 없음');
  });

  await t('관리: 그룹을 닫으면 그 방이 안 보이고, 사람을 멈추면 로그인이 끊김', async () => {
    await adminPost({ act: 'group_close', id: friends });
    let r = await api('me', undefined, tok.f1);
    assert.equal(r.body.groups.length, 0);
    await adminPost({ act: 'group_open', id: friends });
    const html = await (await req('/setup.php')).text();
    const f1 = html.match(/<b>친구1<\/b>[\s\S]*?name="act" value="user_off"><input type="hidden" name="id" value="(\d+)"/)[1];
    await adminPost({ act: 'user_off', id: f1 });
    r = await api('me', undefined, tok.f1);
    assert.equal(r.status, 401);
  });

  await t('관리: 사람별로 그룹을 여러 개 한꺼번에 정함, 관리자는 모든 그룹에', async () => {
    let html = await adminPost({ act: 'group_new', name: '회사' });
    html = await (await req('/setup.php')).text();
    const ids = [...html.matchAll(/name="act" value="invite"><input type="hidden" name="group" value="(\d+)"/g)].map((m) => m[1]);
    const company = ids[2];
    const before = (await api('sync?since=0', undefined, tok.mom)).body.groups_rev;
    const mom = html.split('<div class="row"><span><b>').find((x) => x.startsWith('엄마</b>')).match(/name="act" value="user_groups"><input type="hidden" name="id" value="(\d+)"/)[1];
    // 엄마: 가족 빼고 친구·회사
    const body = new URLSearchParams({ csrf: csrfOf(html), act: 'user_groups', id: mom });
    body.append('groups[]', friends); body.append('groups[]', company);
    const r0 = await req('/setup.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    assert.match(await r0.text(), /그룹을 바꿨어요/);
    let r = await api('me', undefined, tok.mom);
    assert.deepEqual(r.body.groups.map((g) => g.name).sort(), ['친구', '회사'].sort());
    assert.ok(r.body.groups.find((g) => g.name === '회사').members.some((m) => m.name === '일래'), '관리자는 새 그룹에도');
    const after = (await api('sync?since=0', undefined, tok.mom)).body.groups_rev;
    assert.notEqual(after, before, '동기화에서 그룹이 바뀐 걸 알 수 있음');
    r = await api('me', undefined, tok.me);
    assert.equal(r.body.groups.length, 3);
  });

  await t('새 버전·공지사항: 동기화에 웹앱 판과 최신 공지, 배포의 바뀐 점은 자동 공지(30분 안이면 한 글), 관리자 글 쓰기·고치기·지우기', async () => {
    const dir = path.join(www, 'talk');
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ build: 'b1' }));
    let r = await api('sync?since=0', undefined, tok.mom);
    assert.equal(r.body.app, 'b1');
    assert.equal(r.body.notice, null);
    fs.writeFileSync(path.join(dir, 'deploy.json'), JSON.stringify({ sha: 'aaa111', title: '키보드 고침', notes: ['키보드 고침', '사진 빨라짐'] }));
    r = await api('sync?since=0', undefined, tok.mom);
    assert.match(r.body.notice.title, /^업데이트: 키보드 고침 외 1개$/);
    const first = r.body.notice.id;
    r = await api('sync?since=0', undefined, tok.dad);
    assert.equal(r.body.notice.id, first, '같은 배포는 한 번만');
    assert.equal((await api('health')).body.sha, 'aaa111');
    fs.writeFileSync(path.join(dir, 'deploy.json'), JSON.stringify({ sha: 'bbb222', notes: ['스플래시 추가'] }));
    r = await api('sync?since=0', undefined, tok.mom);
    assert.equal(r.body.notice.id, first, '30분 안에 이어진 배포는 같은 글에');
    r = await api('notices', undefined, tok.mom);
    assert.equal(r.body.notices[0].body, '• 키보드 고침\n• 사진 빨라짐\n• 스플래시 추가');
    assert.equal(r.body.notices[0].kind, 'auto');
    // 관리자 글 (알림도)
    const before = pushes.length;
    let html = await adminPost({ act: 'notice_new', title: '이번 주 점검', body: '토요일 밤에 잠깐 멈춰요', push: '1' });
    assert.match(html, /공지를 올렸어요/);
    r = await api('sync?since=0', undefined, tok.mom);
    assert.equal(r.body.notice.title, '이번 주 점검');
    const mine = r.body.notice.id;
    assert.ok(pushes.length >= before);
    html = await adminPost({ act: 'notice_edit', id: String(first), title: '업데이트 정리', body: '고친 것들' });
    assert.match(html, /공지를 고쳤어요/);
    r = await api('notices', undefined, tok.dad);
    assert.deepEqual(r.body.notices.map((n) => n.title), ['이번 주 점검', '업데이트 정리']);
    assert.equal(r.body.notices[1].kind, 'admin', '고친 글에는 더 이상 자동으로 안 붙임');
    await adminPost({ act: 'notice_delete', id: String(mine) });
    r = await api('notices', undefined, tok.dad);
    assert.equal(r.body.notices.length, 1);
    assert.equal((await api('notices')).status, 401);
    fs.rmSync(path.join(dir, 'deploy.json'));
  });

  await t('관리자 계정은 앱에서 관리 화면을 비밀번호 없이 연다 (한 번 쓰는 표)', async () => {
    let r = await api('admin/ticket', {}, tok.mom);
    assert.equal(r.status, 403, '관리자만');
    r = await api('admin/ticket', {}, tok.me);
    assert.match(r.body.url, /^setup\.php\?ticket=[a-f0-9]{32}$/);
    const saved = jar;
    jar = '';
    let res = await req('/' + r.body.url);
    assert.equal(res.status, 302);
    res = await req('/setup.php');
    assert.match(await res.text(), /그룹 저장/, '로그인된 관리 화면');
    jar = '';
    res = await req('/' + r.body.url);
    res = await req('/setup.php');
    assert.match(await res.text(), /관리 화면 로그인/, '같은 표는 두 번 못 씀');
    jar = saved;
  });

  await t('로그아웃하면 그 기기 토큰은 못 씀', async () => {
    let r = await api('auth/logout', {}, tok.dad);
    assert.equal(r.status, 200);
    r = await api('me', undefined, tok.dad);
    assert.equal(r.status, 401);
  });

  await t('DB 표는 talk_ 로 시작', async () => {
    const out = execFileSync('mariadb', [`-u${dbUser}`, `-p${dbPass}`, '--default-character-set=utf8mb4', '-r', '-N', '-e', `SHOW TABLES FROM ${dbName}`]).toString().trim().split('\n');
    assert.ok(out.length > 0 && out.every((n) => n.startsWith('talk_')), out.join(','));
  });

  await t('내부 파일은 웹으로 직접 못 엶 (.htaccess 규칙 존재)', async () => {
    const ht = fs.readFileSync(path.join(www, 'talk', 'lib', '.htaccess'), 'utf8');
    assert.match(ht, /Require all denied/);
  });

  console.log(`\n${passed}개 통과`);
} catch (e) {
  console.error(e);
  if (phpLog) console.error('--- php 로그 ---\n' + phpLog.slice(-3000));
  process.exitCode = 1;
} finally {
  php.kill();
  pushServer.close();
  liteServer.close();
  naverServer.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
