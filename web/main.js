// SAKi Talk 웹앱 시작점. 화면은 Preact + htm (빌드 없이 쓰는 JSX 대신 태그 문자열)
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html } from './html.js';
import { getToken, api } from './api.js';
import { state, subscribe, loadSaved, loadMe, startSync, openRoom, closeRoom, clearAll } from './store.js';
import { Auth, inviteFromHash } from './auth.js';
import { Home } from './home.js';
import { Room } from './room.js';
import { Profile } from './profile.js';
import './style.css';

function App() {
  const [, force] = useState(0);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('chats');
  const [problem, setProblem] = useState('');

  useEffect(() => subscribe(() => force((n) => n + 1)), []);

  async function start() {
    if (!getToken()) { setReady(true); return; }
    loadSaved();
    setReady(true);
    try {
      await loadMe();
      setProblem('');
    } catch (e) {
      if (!state.me) setProblem(e.message);
    }
    if (state.me) startSync();
  }
  useEffect(() => { start(); }, []);

  // 휴대폰 뒤로 가기(또는 스와이프)로 방에서 나오기
  useEffect(() => {
    const onPop = () => { if (state.openRoom) closeRoom(); };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  function open(id) {
    if (!state.openRoom) history.pushState({ room: id }, '');
    openRoom(id);
  }
  function back() {
    if (history.state?.room) history.back();
    else closeRoom();
  }

  // 이미 로그인한 채로 초대 링크를 열면: 설정 탭에서 코드 넣기
  useEffect(() => {
    if (state.me && inviteFromHash()) {
      const code = inviteFromHash();
      history.replaceState(null, '', location.pathname + location.search);
      api('groups/join', { invite: code }).then(loadMe).then(() => setTab('friends')).catch((e) => alert(e.message));
    }
  }, [state.me?.id]);

  if (!ready) return null;
  if (!getToken() || (!state.me && !problem)) {
    if (!getToken()) return html`<${Auth} onDone=${() => { setProblem(''); start(); }} />`;
    return html`<main class="splash"><p class="hint">불러오는 중…</p></main>`;
  }
  if (!state.me) {
    return html`<main class="splash"><p class="err">서버에 연결하지 못했어요 (${problem})</p>
      <button class="primary" onClick=${start}>다시 시도</button><button class="text" onClick=${clearAll}>로그아웃</button></main>`;
  }
  const profile = state.profile && html`<${Profile} key=${state.profile} onOpen=${open} />`;
  if (state.openRoom) return html`<${Room} id=${state.openRoom} onBack=${back} />${profile}`;
  return html`<${Home} tab=${tab} setTab=${setTab} onOpen=${open} />${profile}`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
