// 홈 화면에 앱 설치: 크롬·삼성인터넷은 설치 창을 직접 띄울 수 있다 (beforeinstallprompt). 설치하면 주소줄 없이 앱처럼 열림
import { useEffect, useState } from 'preact/hooks';
import { html } from './html.js';

let deferred = null;
const subs = new Set();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; subs.forEach((f) => f()); });
window.addEventListener('appinstalled', () => { deferred = null; subs.forEach((f) => f()); });

export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function InstallCard() {
  const [, tick] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  if (standalone()) return null;
  const ua = navigator.userAgent;
  const how = /iPhone|iPad/.test(ua) ? '사파리 아래 공유 버튼 → "홈 화면에 추가"'
    : /SamsungBrowser/.test(ua) ? '삼성인터넷 아래 메뉴 ≡ → "현재 페이지 추가" → "홈 화면"'
    : /Android/.test(ua) ? '크롬 메뉴 ⋮ → "홈 화면에 추가" 또는 "앱 설치"' : '브라우저 메뉴 → "앱 설치"';
  async function install() {
    const e = deferred;
    if (!e) return;
    e.prompt();
    const r = await e.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') { deferred = null; setDone(true); }
  }
  return html`
    <div class="card">
      <b>홈 화면에 앱 설치</b>
      <p class="hint">설치하면 위쪽 주소줄 없이 앱처럼 열려요. 설치한 뒤에는 홈 화면의 SAKi Talk 아이콘으로 여세요.</p>
      ${done ? html`<p class="ok">설치했어요. 홈 화면 아이콘으로 열어 주세요.</p>`
        : deferred ? html`<button class="primary" onClick=${install}>앱 설치하기</button>`
        : html`<p class="hint">${how}</p>`}
      <a class="text left" href="./guide/">자세한 설치 방법 보기</a>
    </div>`;
}
