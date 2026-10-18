// S.A.K.I Talk 웹앱 시작점. 화면은 Preact + htm (빌드 없이 쓰는 JSX 대신 태그 문자열, 둘 합쳐 약 5KB)
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { api } from './api.js';
import './style.css';

const html = htm.bind(h);

function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('health').then(setHealth).catch((e) => setError(e.message));
  }, []);

  let status = '서버 확인 중…';
  if (error) status = `서버에 연결하지 못했어요 (${error})`;
  else if (health && !health.configured) status = '서버 설정이 아직 안 됐어요. 관리자가 setup.php 를 열어 주세요.';
  else if (health && health.db === false) status = '서버 DB 에 연결하지 못했어요.';
  else if (health) status = `서버 연결됨 · 버전 ${health.version}`;

  return html`
    <main class="splash">
      <img class="logo" src="./icon-192.png" alt="" width="96" height="96" />
      <h1>S.A.K.I Talk</h1>
      <p class="status ${error || health?.db === false ? 'bad' : ''}">${status}</p>
      <p class="hint">가족·친구끼리 쓰는 메신저를 준비하고 있어요.</p>
    </main>
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
