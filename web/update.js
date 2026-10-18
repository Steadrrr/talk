// 새 버전 자동 반영: 서버는 동기화 때마다 지금 올라간 웹앱 판(app)을 알려 준다. 내 판과 다르면
// 1) 새 index.html 과 그 스크립트가 정말 다 올라왔는지 확인하고 (FTP 가 파일을 하나씩 올리는 중일 수 있어서)
// 2) 쓰는 중이 아닐 때(글 입력·보내는 중·방금 만짐이 아닐 때, 또는 앱이 뒤로 갔을 때) 조용히 새로고침한다.
// 로그인(토큰)은 기기에 그대로라 다시 로그인할 필요 없고, 보던 방·탭은 다시 열어 준다.
const MINE = __TALK_BUILD__;
const RESUME = 'talk_resume';

let target = '';       // 서버에 있는 새 판
let ready = '';        // 다 올라온 것을 확인한 판
let checkedAt = 0;
let lastTouch = Date.now();
let getTab = () => '';
export function trackTab(fn) { getTab = fn; }
let pickingUntil = 0;  // 사진 고르는 창이 떠 있는 동안 (앱이 뒤로 간 것처럼 보이지만 쓰는 중)
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true });
addEventListener('click', (e) => { if (e.target?.matches?.('input[type=file]')) pickingUntil = Date.now() + 120000; }, true);
addEventListener('change', (e) => { if (e.target?.matches?.('input[type=file]')) pickingUntil = Date.now() + 3000; }, true);

async function arrived(build) {
  const res = await fetch('./?v=' + encodeURIComponent(build), { cache: 'no-store' });
  if (!res.ok) return false;
  const text = await res.text();
  if (!text.includes(`name="talk-build" content="${build}"`)) return false;
  const src = text.match(/<script[^>]+src="([^"]+)"/);
  if (src) {
    const js = await fetch(new URL(src[1], location.href), { method: 'HEAD', cache: 'no-store' });
    if (!js.ok) return false;
  }
  return true;
}

// 쓰는 중이면 나중에: 사진 고르는 중, 입력칸에 커서가 있음, 보내는 중인 메시지가 있음, 3초 안에 만짐
function busy(state) {
  if (Date.now() < pickingUntil) return true;
  const el = document.activeElement;
  if (el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && el.type !== 'checkbox'))) return true;
  if (document.querySelector('.msg-input:not(.blank)')) return true;   // 메시지 입력칸에 쓰다 만 글 (새로고침하면 사라짐)
  if (Date.now() - lastTouch < 3000) return true;
  return Object.values(state.messages).some((l) => l.some((m) => m.pending && !m.failed));
}

// 같은 새 판으로 새로고침을 이미 해 봤는데도 옛 판이 떴으면(캐시 등) 10분 동안은 다시 안 함: 계속 새로고침되는 것 막기
const TRIED = 'talk_update_tried';
function triedRecently(build) {
  try { const t = JSON.parse(sessionStorage.getItem(TRIED) || 'null'); return t && t.build === build && Date.now() - t.at < 600000; } catch { return false; }
}

async function reload(state) {
  try { sessionStorage.setItem(TRIED, JSON.stringify({ build: target, at: Date.now() })); } catch {}
  try { sessionStorage.setItem(RESUME, JSON.stringify({ room: state.openRoom || 0, tab: getTab(), notices: state.notices })); } catch {}
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await Promise.race([reg?.update(), new Promise((r) => setTimeout(r, 2000))]);
  } catch {}
  location.reload();
}

// 동기화 때마다 부른다 (store.js)
export async function checkUpdate(build, state) {
  if (!build || MINE === 'dev' || build === MINE || triedRecently(build)) return;
  if (build !== target) { target = build; ready = ''; checkedAt = 0; }
  if (ready !== build) {
    if (Date.now() - checkedAt < 20000) return;
    checkedAt = Date.now();
    try { if (await arrived(build)) ready = build; } catch {}
    if (ready !== build) return;
  }
  if (!busy(state)) await reload(state);
}

// 새로고침 뒤 처음 한 번: 보던 방·탭 (없으면 null)
export function takeResume() {
  try {
    const r = JSON.parse(sessionStorage.getItem(RESUME) || 'null');
    sessionStorage.removeItem(RESUME);
    return r;
  } catch { return null; }
}
