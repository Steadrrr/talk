// 서버 API 부르기. 주소는 웹앱과 같은 폴더의 api.php (카페24: /talk/api.php/<경로>)
// 쓰기는 모두 POST, 로그인 토큰은 X-Talk-Token 헤더 (공유 호스팅에서 Authorization 헤더가 사라지는 경우가 있어서)
const BASE = new URL('./api.php/', location.href).href;

export async function api(route, body) {
  const opts = { headers: {} };
  const token = localStorage.getItem('talk.token');
  if (token) opts.headers['X-Talk-Token'] = token;
  if (body !== undefined) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + route, opts);
  let data;
  try { data = await res.json(); } catch { throw new Error(`HTTP ${res.status}`); }
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
