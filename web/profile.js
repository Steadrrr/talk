// 프로필 창: 닉네임(본명), 같이 있는 그룹, 1:1 대화. 내 프로필이면 닉네임 바꾸기
import { useState } from 'preact/hooks';
import { html, Avatar, squareJpeg, PhotoConfirm } from './html.js';
import { nickOf, fullName } from './names.js';
import { state, person, showProfile, openDm, setNick, setPhoto } from './store.js';

export function Profile({ onOpen }) {
  const id = state.profile;
  const p = person(id);
  const isMe = id === state.me.id;
  const [editing, setEditing] = useState(false);
  const [nick, setNickText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null); // 고른 사진 (확인 전)
  const close = () => showProfile(null);

  if (!p) return null;
  const groups = state.groups.filter((g) => g.members.some((m) => m.id === id)).map((g) => g.name);

  async function talk() {
    setErr('');
    try { const rid = await openDm(id); close(); onOpen(rid); } catch (e) { setErr(e.message); }
  }
  // 사진 고르기 → 가운데를 정사각형으로 잘라 320px JPEG 로 줄임 (보통 20~40KB) → 미리 보고 확인하면 올림
  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    try { setDraft(await squareJpeg(file, 320)); } catch (e2) { setErr(e2.message || '사진을 열지 못했어요.'); }
  }
  async function confirmPhoto() {
    setBusy(true);
    try { await setPhoto(draft); setDraft(null); } catch (e2) { setErr(e2.message || '사진을 올리지 못했어요.'); setDraft(null); } finally { setBusy(false); }
  }
  async function removePhoto() {
    if (!confirm('프로필 사진을 지울까요?')) return;
    setErr(''); setBusy(true);
    try { await setPhoto(null); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
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
          <${Avatar} name=${nickOf(p)} id=${p.id} photo=${p.photo} size=${96} />
          <h2 class="profile-name">${fullName(p)}</h2>
          ${groups.length > 0 && html`<p class="hint">${groups.join(' · ')}</p>`}
          ${err && html`<p class="err">${err}</p>`}
          ${isMe && !editing && html`
            <div class="photo-btns">
              <label class="text tap">${busy ? '올리는 중…' : p.photo ? '사진 바꾸기' : '사진 넣기'}<input type="file" accept="image/*" hidden onChange=${pickPhoto} disabled=${busy} /></label>
              ${p.photo && html`<button class="text dim" onClick=${removePhoto} disabled=${busy}>사진 지우기</button>`}
            </div>
            <button class="primary" onClick=${() => { setNickText(p.nick || ''); setEditing(true); }}>닉네임 바꾸기</button>`}
          ${isMe && editing && html`
            <form class="nick-form" onSubmit=${save}>
              <input value=${nick} onInput=${(e) => setNickText(e.target.value)} maxlength="20" placeholder=${`비우면 본명(${p.name})으로 보여요`} autofocus />
              <div class="inline"><button type="button" class="text" onClick=${() => setEditing(false)}>그만두기</button><button class="primary" type="submit" disabled=${busy}>저장</button></div>
            </form>`}
          ${!isMe && html`<button class="primary" onClick=${talk}>1:1 대화</button>`}
        </div>
      </div>
      ${draft && html`<${PhotoConfirm} data=${draft} title="프로필 사진으로 할까요?" busy=${busy} onCancel=${() => setDraft(null)} onOk=${confirmPhoto} />`}
    </div>
  `;
}

