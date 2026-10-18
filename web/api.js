// 서버 API 부르기. 주소는 웹앱과 같은 폴더의 api.php (카페24: /talk/api.php/<경로>)
// 쓰기는 모두 POST, 로그인 토큰은 X-Talk-Token 헤더 (공유 호스팅에서 Authorization 헤더가 사라지는 경우가 있어서)
const BASE = new URL('./api.php/', location.href).href;

// 로그인이 끊겼을 때 (토큰이 없거나 관리자가 끊음)
export class AuthError extends Error {}

export function getToken() {
  try { return localStorage.getItem('talk.token') || ''; } catch { return ''; }
}
export function setToken(t) {
  try { localStorage.setItem('talk.token', t); } catch { /* 개인 정보 보호 모드: 이번 실행 동안만 */ }
  memToken = t;
}
let memToken = '';

export async function api(route, body) {
  const opts = { headers: {} };
  const token = getToken() || memToken;
  if (token) opts.headers['X-Talk-Token'] = token;
  if (body !== undefined) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + route, opts);
  let data;
  try { data = await res.json(); } catch { throw new Error(`서버 응답이 이상해요 (HTTP ${res.status})`); }
  if (res.status === 401 && token && !route.startsWith('auth/')) throw new AuthError(data.error || '로그인이 필요해요.');
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
