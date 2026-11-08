// 옛 주소(카페24)에서 열면 새 주소 안내만 보여 준다. 홈 화면에 옛 주소로 설치한 앱도 여기로 들어온다
// (다른 주소로 옮기면 로그인·설치가 이어지지 않아서, 새 주소에서 다시 로그인하고 홈 화면에 다시 추가해야 함)
import { html } from './html.js';

export const NEW_URL = 'https://talk.projectsaki.com/';
export const isOldHost = () => location.hostname === 'mysaki.mycafe24.com';

export function Moved() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const target = NEW_URL + location.hash;
  return html`
    <main class="auth moved">
      <img class="logo" src="./icon-192.png" alt="" width="80" height="80" />
      <h1>주소가 바뀌었어요</h1>
      <p>SAKi Talk 이 새 집으로 이사했어요.<br />이제부터는 아래 주소로 들어와 주세요.</p>
      <p class="moved-url"><b>talk.projectsaki.com</b></p>
      <a class="button primary" href=${target} target=${installed ? '_blank' : '_self'} rel="noopener">새 주소로 가기</a>
      <ol class="moved-steps">
        <li>새 주소에서 <b>본명과 비밀번호로 다시 로그인</b>해 주세요. 대화와 친구는 그대로예요.</li>
        <li>${ios ? html`사파리 아래 <b>공유</b> 단추 → <b>홈 화면에 추가</b>` : html`크롬 오른쪽 위 <b>⋮</b> → <b>홈 화면에 추가</b>`}로 새 아이콘을 만들어 주세요.</li>
        <li>알림을 다시 켜 주세요 (설정 탭).</li>
        <li>${installed ? '지금 이 아이콘(옛 주소)은 길게 눌러 지워 주세요.' : '옛 주소로 만든 홈 화면 아이콘이 있으면 길게 눌러 지워 주세요.'}</li>
      </ol>
      <a class="text" href=${NEW_URL + 'guide/'} target=${installed ? '_blank' : '_self'} rel="noopener">자세한 설치 방법 보기</a>
    </main>
  `;
}
