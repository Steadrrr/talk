// 프로필 창: 닉네임(본명), 같이 있는 그룹, 1:1 대화. 내 프로필이면 닉네임 바꾸기
import { useState } from 'preact/hooks';
import { html, Avatar } from './html.js';
import { nickOf, fullName } from './names.js';
import { state, person, showProfile, openDm, setNick } from './store.js';

export function Profile({ onOpen }) {
  const id = state.profile;
  const p = person(id);
  const isMe = id === state.me.id;
  const [editing, setEditing] = useState(false);
  const [nick, setNickText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => showProfile(null);

  if (!p) return null;
  const groups = state.groups.filter((g) => g.members.some((m) => m.id === id)).map((g) => g.name);

  async function talk() {
    setErr('');
    try { const rid = await openDm(id); close(); onOpen(rid); } catch (e) { setErr(e.message); }
  }
  async function save(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await setNick(nick.trim()); setEditing(false); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && close()}>
      <div class="sheet profile">
        <header class="bar"><button class="icon" onClick=${close} aria-label="닫기">✕</button><span class="grow"></span></header>
        <div class="profile-body">
          <${Avatar} name=${nickOf(p)} id=${p.id} size=${96} />
          <h2 class="profile-name">${fullName(p)}</h2>
          ${groups.length > 0 && html`<p class="hint">${groups.join(' · ')}</p>`}
          ${err && html`<p class="err">${err}</p>`}
          ${isMe && !editing && html`<button class="primary" onClick=${() => { setNickText(p.nick || ''); setEditing(true); }}>닉네임 바꾸기</button>`}
          ${isMe && editing && html`
            <form class="nick-form" onSubmit=${save}>
              <input value=${nick} onInput=${(e) => setNickText(e.target.value)} maxlength="20" placeholder=${`비우면 본명(${p.name})으로 보여요`} autofocus />
              <div class="inline"><button type="button" class="text" onClick=${() => setEditing(false)}>그만두기</button><button class="primary" type="submit" disabled=${busy}>저장</button></div>
            </form>`}
          ${!isMe && html`<button class="primary" onClick=${talk}>1:1 대화</button>`}
        </div>
      </div>
    </div>
  `;
}
