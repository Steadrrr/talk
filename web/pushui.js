// 알림 화면: 로그인 뒤 한 번 뜨는 "알림 받을까요?" 창, 설정 탭의 알림 켜기·끄기
import { useEffect, useState } from 'preact/hooks';
import { html } from './html.js';
import { api } from './api.js';
import { state, setPushQuiet } from './store.js';
import { pushState, enablePush, disablePush, deniedHelp, setPushAsked, refreshPush } from './push.js';

const INSTALL_HELP = html`
  <ol class="steps">
    <li>사파리 아래쪽 <b>공유 버튼</b>(네모에 위쪽 화살표)을 눌러요.</li>
    <li><b>홈 화면에 추가</b>를 눌러요.</li>
    <li>홈 화면에 생긴 <b>SAKi Talk</b> 을 열고 로그인하면 알림을 켤 수 있어요.</li>
  </ol>`;

export function PushPrompt({ state: st, onClose }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setPushAsked(true); onClose(); };
  async function allow() {
    setErr(''); setBusy(true);
    try { await enablePush(); close(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return html`
    <div class="sheet-bg center-sheet">
      <div class="dialog" role="dialog" aria-label="알림 설정">
        <div class="dialog-icon">🔔</div>
        <h2>새 메시지 알림을 받을까요?</h2>
        ${st === 'off' && html`<p class="hint">앱을 닫아 두어도 새 메시지가 오면 휴대폰 알림으로 알려 드려요. 설정 탭에서 언제든 끌 수 있어요.</p>`}
        ${st === 'install' && html`<p class="hint">아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요.</p>${INSTALL_HELP}`}
        ${st === 'denied' && html`<p class="hint">${deniedHelp()}</p>`}
        ${err && html`<p class="err">${err}</p>`}
        ${st === 'off'
          ? html`<button class="primary" onClick=${allow} disabled=${busy}>${busy ? '잠깐만요…' : '알림 허용'}</button><button class="text" onClick=${close}>나중에</button>`
          : html`<button class="primary" onClick=${close}>알겠어요</button>`}
      </div>
    </div>
  `;
}

export function PushCard() {
  const [st, setSt] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState('');
  const refresh = () => pushState().then(setSt).catch(() => setSt('unsupported'));
  useEffect(() => { refresh(); }, []);
  async function toggle() {
    setErr(''); setBusy(true);
    try { if (st === 'on') await disablePush(); else await enablePush(); } catch (e) { setErr(e.message); }
    setBusy(false);
    refresh();
  }
  async function sendTest() {
    setErr(''); setTest('보내는 중…');
    try {
      await refreshPush();
      const r = await api('push/test', {});
      if (!r.total) setTest('서버에 이 기기 알림 주소가 없어요. 스위치를 껐다가 다시 켜 주세요.');
      else if (r.sent) setTest('보냈어요. 몇 초 안에 알림이 안 오면 휴대폰 설정 > 알림 에서 SAKi Talk(안드로이드는 크롬) 알림과 집중 모드를 확인해 주세요.');
      else setTest(`알림 서버가 받지 않았어요 (${r.results.map((x) => `${x.host} ${x.code || x.error}`).join(', ')}). 스위치를 껐다가 다시 켜 주세요.`);
    } catch (e) { setTest(''); setErr(e.message); }
  }
  const [quiet, setQuiet] = useState(!!state.me?.push_quiet);
  async function toggleQuiet() {
    setErr('');
    try { await setPushQuiet(!quiet); setQuiet(!quiet); } catch (e) { setErr(e.message); }
  }
  const canToggle = st === 'on' || st === 'off';
  return html`
    <div class="card">
      <label class="switch-row">
        <span class="grow"><b>새 메시지 알림</b><div class="hint">${
          st === 'on' ? '켜짐 · 이 기기로 알림이 와요' : st === 'off' ? '꺼짐' : st === 'install' ? '홈 화면에 추가한 앱에서 켤 수 있어요' : st === 'denied' ? '휴대폰 설정에서 막혀 있어요' : st === 'unsupported' ? '이 브라우저는 알림을 받을 수 없어요' : ''}</div></span>
        <input type="checkbox" class="switch" checked=${st === 'on'} disabled=${!canToggle || busy} onChange=${toggle} />
      </label>
      ${st === 'on' && html`
        <label class="switch-row">
          <span class="grow"><b>정신병 방지(연속알림 차단)</b><div class="hint">한 방에 1분 안에 3개 이상 몰아서 올라오면 그때부터 조용히 받아요. 5분 동안 대화가 없으면 다시 알림이 와요. 아이폰은 그동안 알림·뱃지가 멈추고, 안드로이드는 소리 없이 알림 한 칸만 바뀌어요.</div></span>
          <input type="checkbox" class="switch" checked=${quiet} onChange=${toggleQuiet} />
        </label>
        <button class="text left" onClick=${sendTest}>시험 알림 보내기</button>`}
      ${test && html`<p class="hint">${test}</p>`}
      ${st === 'install' && INSTALL_HELP}
      ${st === 'denied' && html`<p class="hint">${deniedHelp()}</p>`}
      ${err && html`<p class="err">${err}</p>`}
    </div>
  `;
}
