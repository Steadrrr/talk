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
const lite = { mode: 'reply', calls: [], pathInfo: true };
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
    if (route === 'lite/status') return send(200, { ok: true, on: true, model: 'claude-haiku-5-5', personalities: [], emotions: [], day: '2026-10-18', spent: 0.0123, requests: 3, cap: 0.2 });
    if (route !== 'lite/reply') return send(404, { ok: false, error: '없는 주소' });
    const base = { ok: true, mode: body.mode, pass: false, emotion: 'neutral', reaction: '', links: [], limited: false, spent: 0.01, cap: 0.2 };
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

const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', www], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TALK_PUSH_TEST_PREFIX: PUSH_PREFIX, TALK_SAKI_TEST_URL: LITE_URL } });
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

    await api('sync?since=0&active=1&room=0', undefined, tok.dad);
    await api('messages/send', { room_id: room, body: '목록을 보고 있을 때' }, tok.mom);
    assert.equal((await waitPush(3000)).length, 1, '목록 화면이면 보냄');
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

  await t('이미 가입한 사람이 초대 코드로 다른 그룹에 들어감', async () => {
    const inv = inviteOf(await adminPost({ act: 'invite', group: friends, uses: '1', days: '1' }));
    let r = await api('groups/join', { invite: inv }, tok.mom);
    assert.deepEqual(r.body.groups.map((g) => g.name), ['가족', '친구']);
    const f1 = await idOf(tok.mom, '친구1');
    r = await api('rooms/dm', { user_id: f1 }, tok.mom);
    assert.equal(r.status, 200);
  });

  // ───── 사키 (SAKi Lite 봇) ─────
  const sql = (q) => execFileSync('mariadb', [`-u${dbUser}`, `-p${dbPass}`, '-N', '-D', dbName, '-e', q]).toString().trim();
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
    assert.deepEqual(r.body.saki, { on: 1, personality: 'tsundere', polite: 1, freq: 'called', gap: 10, react: 1 });
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
    assert.deepEqual(c.body.messages, [{ name: '엄마곰', text: '내일 소풍 가는데' }, { name: '아빠', text: '사키야 내일 날씨 어때?' }], '안내 글은 빼고 닉네임으로');
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

  await t('사키: 사키 메시지에 답장하면 부름, 부르는 중이면 새로 안 부름, 열쇠는 앱 응답·로그에 없음', async () => {
    const [bm] = await botMsgs();
    await say({ body: '고마워', reply_to: bm.id }, tok.mom);
    assert.equal(replies().length, 2);
    assert.deepEqual(replies()[1].body.messages.at(-2), { name: '사키', text: bm.body, bot: true });
    sql(`INSERT INTO talk_meta (k, v) VALUES ('saki_busy:${sakiRoom}', UNIX_TIMESTAMP())`);
    await say({ body: '사키 또 불러' }, tok.mom);
    assert.equal(replies().length, 2, '부르는 중이면 버림');
    sql(`UPDATE talk_meta SET v = UNIX_TIMESTAMP() - 61 WHERE k = 'saki_busy:${sakiRoom}'`);
    await say({ body: '사키 다시' }, tok.mom);
    assert.equal(replies().length, 3, '60초 지난 표시는 무효');
    const all = JSON.stringify([(await api('sync?since=0', undefined, tok.mom)).body, (await api('me', undefined, tok.me)).body]);
    assert.ok(!all.includes(SAKI_KEY) && !phpLog.includes(SAKI_KEY));
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
  });

  await t('관리: 백업 내려받기 (읽기용 txt·옮기기용 json, 비밀번호는 안 들어감)', async () => {
    const txt = await adminPost({ act: 'backup_txt' });
    assert.match(txt, /SAKi Talk 대화 백업/);
    assert.match(txt, /김치찌개/);
    assert.match(txt, /\[사진\]/);
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
    const out = execFileSync('mariadb', [`-u${dbUser}`, `-p${dbPass}`, '-N', '-e', `SHOW TABLES FROM ${dbName}`]).toString().trim().split('\n');
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
  fs.rmSync(tmp, { recursive: true, force: true });
}
