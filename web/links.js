import { useRef } from 'preact/hooks';
import { html } from './html.js';

// 글 속 주소(https://…, http://…, www.…)를 눌러 열 수 있는 링크로. 한글이나 빈칸이 나오면 주소 끝,
//  끝에 붙은 문장부호(. , ! ? 닫는 괄호 등)는 주소에서 뺀다
const URL_RE = /\b(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

function trimEnd(u) {
  for (;;) {
    const c = u[u.length - 1];
    if (/[.,!?;:'"]/.test(c)) u = u.slice(0, -1);
    else if (c === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1);
    else if (c === ']' && !u.includes('[')) u = u.slice(0, -1);
    else return u;
  }
}

export function linkify(text) {
  if (!text || !/https?:\/\/|www\./i.test(text)) return text;
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const u = trimEnd(m[0]);
    if (/^www\.$/i.test(u) || u.length < 5) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(html`<${Link} url=${/^www\./i.test(u) ? 'https://' + u : u} text=${u} />`);
    last = m.index + u.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// 누르면 "외부로 이동합니다" 묻고, 확인이면 밖의 브라우저로. 길게 누른 것(메시지 메뉴)은 무시
function Link({ url, text }) {
  const down = useRef(0);
  return html`<a class="msg-link" href=${url} target="_blank" rel="noopener noreferrer"
    onPointerDown=${() => { down.current = Date.now(); }}
    onClick=${(e) => {
      e.preventDefault();
      if (down.current && Date.now() - down.current > 450) return;
      e.stopPropagation();
      if (confirm(`외부로 이동합니다.\n${url}`)) openExternal(url);
    }}>${text}</a>`;
}

// 아이폰 홈 화면 앱에서는 앱 안의 작은 창 대신 사파리로 (iOS 17+ 의 x-safari- 주소). 안 되면 그냥 연다
export function openExternal(url) {
  if (navigator.standalone && /^https?:\/\//.test(url)) {
    let left = false;
    const away = () => { left = true; };
    document.addEventListener('visibilitychange', away, { once: true });
    window.addEventListener('pagehide', away, { once: true });
    location.href = 'x-safari-' + url;
    setTimeout(() => {
      document.removeEventListener('visibilitychange', away);
      window.removeEventListener('pagehide', away);
      if (!left && document.visibilityState === 'visible') location.href = url;
    }, 1200);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
