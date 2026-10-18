// 채팅방 설정: 방 이름(여럿 방), 알림·위에 고정(나에게만), 사람 목록·초대, 나가기
import { useState } from 'preact/hooks';
import { html, Avatar } from './html.js';
import { nickOf } from './names.js';
import { state, roomTitle, roomPrefs, renameRoom, inviteToRoom, leaveRoom, showProfile } from './store.js';

export function RoomSettings({ room, onClose, onLeft }) {
  const [name, setName] = useState(room.name || '');
  const [inviting, setInviting] = useState(false);
  const [picked, setPicked] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const isGroup = room.kind === 'group';
  const inRoom = new Set(room.members.map((m) => m.id));
  const group = state.groups.find((g) => g.id === room.group_id);
  const candidates = (group?.members || []).filter((m) => !inRoom.has(m.id));

  const run = async (fn, done = '') => {
    setErr(''); setMsg('');
    try { await fn(); if (done) setMsg(done); } catch (e) { setErr(e.message); }
  };
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  async function leave() {
    if (!confirm(isGroup ? '이 방에서 나갈까요? 대화 목록에서 사라져요.' : '이 대화방을 목록에서 지울까요? 상대가 다시 보내면 다시 보여요.')) return;
    await run(async () => { await leaveRoom(room.id); onLeft(); });
  }

  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button><h2 class="ellipsis">채팅방 설정</h2></header>
        <div class="scroll">
          ${err && html`<p class="err pad">${err}</p>`}
          ${msg && html`<p class="ok pad">${msg}</p>`}
          ${isGroup && html`
            <form class="section" onSubmit=${(e) => { e.preventDefault(); run(() => renameRoom(room.id, name.trim()), '방 이름을 바꿨어요.'); }}>
              <h3>방 이름 <span class="hint">(모두에게 보여요, 비우면 사람 이름으로)</span></h3>
              <div class="inline"><input value=${name} onInput=${(e) => setName(e.target.value)} maxlength="40" placeholder=${roomTitle({ ...room, name: '' })} /><button class="primary" type="submit" disabled=${name.trim() === (room.name || '')}>저장</button></div>
            </form>`}
          <div class="section">
            <h3>나에게만</h3>
            <label class="switch-row"><span class="grow">새 메시지 알림</span>
              <input type="checkbox" class="switch" checked=${!room.muted} onChange=${(e) => run(() => roomPrefs(room.id, { muted: !e.target.checked }))} /></label>
            <label class="switch-row"><span class="grow">대화 목록 위에 고정</span>
              <input type="checkbox" class="switch" checked=${!!room.pinned} onChange=${(e) => run(() => roomPrefs(room.id, { pinned: e.target.checked }))} /></label>
          </div>
          <div class="section">
            <h3>대화 상대 ${room.members.length}</h3>
          </div>
          ${room.members.map((m) => html`
            <button class="person" onClick=${() => showProfile(m.id)}><${Avatar} name=${nickOf(m)} id=${m.id} photo=${m.photo} /><span>${nickOf(m)}${m.id === state.me.id ? ' (나)' : ''}</span></button>`)}
          ${isGroup && !inviting && html`<button class="person" onClick=${() => { setInviting(true); setPicked([]); }} disabled=${!candidates.length}><span class="avatar multi" style="width:40px;height:40px">＋</span><span>${candidates.length ? '초대하기' : '같은 그룹에 초대할 사람이 없어요'}</span></button>`}
          ${isGroup && inviting && html`
            <div class="section"><h3>초대할 사람 (${group?.name || ''} 그룹)</h3></div>
            ${candidates.map((m) => html`
              <label class="person check"><input type="checkbox" checked=${picked.includes(m.id)} onChange=${() => toggle(m.id)} /><${Avatar} name=${nickOf(m)} id=${m.id} photo=${m.photo} /><span>${nickOf(m)}</span></label>`)}
            <div class="section inline"><button class="text" onClick=${() => setInviting(false)}>그만두기</button><span class="grow"></span>
              <button class="primary" disabled=${!picked.length} onClick=${() => run(async () => { await inviteToRoom(room.id, picked); setInviting(false); }, '초대했어요.')}>초대</button></div>`}
          <div class="section"><button class="danger" onClick=${leave}>${isGroup ? '채팅방 나가기' : '대화방 지우기'}</button></div>
        </div>
      </div>
    </div>
  `;
}
