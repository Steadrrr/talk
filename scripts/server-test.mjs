// S.A.K.I Talk 서버 시험: 카페24 와 같은 폴더 구조(www/talk)로 server/public 을 복사해 php -S + MariaDB 로 띄우고 API·설정 화면을 확인한다.
// 필요: php(pdo_mysql), MariaDB. DB 는 환경 변수 TALK_TEST_DB=호스트:DB:아이디:비밀번호 (기본 localhost:talktest:talk:talkpass)
// 멈춰 있으면: service mariadb start
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

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

const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', www], { stdio: ['ignore', 'ignore', 'pipe'] });
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

  await t('설정 후: 없는 경로는 404', async () => {
    const { status } = await json('/api.php/nothing');
    assert.equal(status, 404);
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
  fs.rmSync(tmp, { recursive: true, force: true });
}
