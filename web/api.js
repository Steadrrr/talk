// 서버 API 부르기. 주소는 웹앱과 같은 폴더의 api.php (카페24: /talk/api.php/<경로>)
// 쓰기는 모두 POST, 로그인 토큰은 X-Talk-Token 헤더 (공유 호스팅에서 Authorization 헤더가 사라지는 경우가 있어서)
const BASE = new URL('./api.php/', location.href).href;

// 로그인이 끊겼을 때 (토큰이 없거나 관리자가 끊음)
export class AuthError extends Error {}

// 자동 로그인이면 localStorage(앱을 닫아도 남음), 아니면 sessionStorage(앱·탭을 닫으면 로그아웃)
export function getToken() {
  try { return localStorage.getItem('talk.token') || sessionStorage.getItem('talk.token') || memToken; } catch { return memToken; }
}
export function setToken(t, remember = true) {
  memToken = t;
  try {
    localStorage.removeItem('talk.token');
    sessionStorage.removeItem('talk.token');
    if (t) (remember ? localStorage : sessionStorage).setItem('talk.token', t);
  } catch { /* 개인 정보 보호 모드: 이번 실행 동안만 */ }
}
let memToken = '';

// 응답을 이만큼 못 받으면 끊긴 것으로 본다. 휴대폰이 잠들었다 깨면 요청이 대답 없이 매달려 있기도 해서,
// 그러면 동기화가 그 요청을 계속 기다리느라 새 메시지가 안 들어왔다
const TIMEOUT_MS = 20000;

export async function api(route, body, extra = {}) {
  const opts = { headers: {}, ...extra };
  if (!opts.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(extra.timeout || TIMEOUT_MS);
  delete opts.timeout;
  const token = getToken();
  if (token) opts.headers['X-Talk-Token'] = token;
  if (body instanceof Blob) {
    // 사진은 그대로 보낸다 (JSON 안 base64 는 카페24 웹 방화벽이 내용에 따라 막음)
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/octet-stream';
    opts.body = body;
  } else if (body !== undefined) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(BASE + route, opts); } catch (e) {
    throw new Error(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? '서버가 대답하지 않아요. 연결을 확인해 주세요.' : '서버에 연결하지 못했어요.');
  }
  let data;
  try { data = await res.json(); } catch { throw new Error(`서버 응답이 이상해요 (HTTP ${res.status}, ${route.split('?')[0]})`); }
  if (res.status === 401 && token && !route.startsWith('auth/')) throw new AuthError(data.error || '로그인이 필요해요.');
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// base64 → 그대로의 사진 (서버에 octet-stream 으로)
export function b64Blob(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: 'application/octet-stream' });
}
