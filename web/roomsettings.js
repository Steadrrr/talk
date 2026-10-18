// 채팅방 설정: 방 이름(여럿 방), 알림·위에 고정(나에게만), 사람 목록·초대, 나가기
import { useState } from 'preact/hooks';
import { html, Avatar, openImage, PhotoViewer, PhotoCrop } from './html.js';
import { nickOf } from './names.js';
import { state, roomTitle, roomPrefs, renameRoom, inviteToRoom, leaveRoom, showProfile, setRoomPhoto, createRoom, openRoom } from './store.js';

export function RoomSettings({ room, onClose, onLeft }) {
  const [name, setName] = useState(room.name || '');
  const [inviting, setInviting] = useState(false);
  const [picked, setPicked] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const isGroup = room.kind === 'group';
  const inRoom = new Set(room.members.map((m) => m.id));
  const group = state.groups.find((g) => g.id === room.group_id);
  const candidates = (group?.members || []).filter((m) => !inRoom.has(m.id));

  const run = async (fn, done = '') => {
    setErr(''); setMsg('');
    try { await fn(); if (done) setMsg(done); } catch (e) { setErr(e.message); }
  };
  // 여럿 방: 그 방에 초대. 1:1 방: 두 사람 + 고른 사람으로 새 단체방을 만들고 그 방으로
  async function invite() {
    if (isGroup) { await inviteToRoom(room.id, picked); setInviting(false); return; }
    const id = await createRoom(room.group_id, [...room.members.map((m) => m.id).filter((i) => i !== state.me.id), ...picked], '');
    onClose();
    openRoom(id);
  }
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  // 사진이 이미 있으면 "현재 사진은 삭제됩니다" 를 먼저 보여 주고, 거기서 사진 고르기
  // (확인 창을 띄운 뒤 파일 고르기를 열면 아이폰이 막을 수 있어서 화면 안에서 묻는다)
  const [warn, setWarn] = useState(false);
  const [draft, setDraft] = useState(null); // 고른 사진 (확인 전)
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setWarn(false);
    try { setDraft(await openImage(file)); } catch (e2) { await run(() => { throw e2; }); }
  }
  async function confirmPhoto(data) {
    setBusy(true);
    await run(async () => setRoomPhoto(room.id, data), '채팅방 사진을 바꿨어요.');
    setBusy(false); setDraft(null);
  }
  async function removePhoto() {
    if (!confirm('채팅방 사진을 지울까요? 모두에게서 사라져요.')) return;
    setBusy(true);
    await run(() => setRoomPhoto(room.id, null), '채팅방 사진을 지웠어요.');
    setBusy(false);
  }
  async function leave() {
    if (!confirm(leaveQuestion(room))) return;
    await run(async () => { await leaveRoom(room.id); onLeft(); });
  }

  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button><h2 class="ellipsis">채팅방 설정</h2></header>
        <div class="scroll">
          ${err && html`<p class="err pad">${err}</p>`}
          ${msg && html`<p class="ok pad">${msg}</p>`}
          <div class="section room-photo">
            ${room.photo
              ? html`<button class="tap" onClick=${() => setViewing(true)} aria-label="사진 크게 보기"><${Avatar} photo=${room.photo} size=${88} /></button>
                     <p class="hint">${room.photo_by}님이 게시한 사진</p>`
              : html`<span class="avatar multi" style="width:88px;height:88px;font-size:30px">📷</span><p class="hint">채팅방 사진이 없어요. 대화 상대 누구나 넣을 수 있어요.</p>`}
            ${room.photo && !warn && html`
              <div class="photo-btns">
                <button class="text" onClick=${() => setWarn(true)} disabled=${busy}>${busy ? '올리는 중…' : '사진 바꾸기'}</button>
                <button class="text dim" onClick=${removePhoto} disabled=${busy}>사진 지우기</button>
              </div>`}
            ${room.photo && warn && html`
              <div class="warn-box">
                <p>현재 사진은 삭제됩니다.</p>
                <div class="photo-btns">
                  <button class="text dim" onClick=${() => setWarn(false)}>그만두기</button>
                  <label class="text tap">새 사진 고르기<input type="file" accept="image/*" hidden onChange=${pick} /></label>
                </div>
              </div>`}
            ${!room.photo && html`
              <div class="photo-btns"><label class="text tap">${busy ? '올리는 중…' : '사진 넣기'}<input type="file" accept="image/*" hidden onChange=${pick} disabled=${busy} /></label></div>`}
          </div>
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
            <button class="person" onClick=${() => showProfile(m.id)}><${Avatar} name=${nickOf(m)} id=${m.id} photo=${m.photo} size=${60} /><span>${nickOf(m)}${m.id === state.me.id ? ' (나)' : ''}</span></button>`)}
          ${!inviting && html`<button class="person" onClick=${() => { setInviting(true); setPicked([]); }} disabled=${!candidates.length}><span class="avatar multi" style="width:60px;height:60px">＋</span><span>${candidates.length ? '초대하기' : '같은 그룹에 초대할 사람이 없어요'}</span></button>`}
          ${inviting && html`
            <div class="section"><h3>초대할 사람 (${group?.name || ''} 그룹)</h3>
              ${!isGroup && html`<p class="hint">1:1 대화는 그대로 두고, 고른 사람과 함께하는 새 단체방이 만들어져요.</p>`}</div>
            ${candidates.map((m) => html`
              <label class="person check"><input type="checkbox" checked=${picked.includes(m.id)} onChange=${() => toggle(m.id)} /><${Avatar} name=${nickOf(m)} id=${m.id} photo=${m.photo} size=${60} /><span>${nickOf(m)}</span></label>`)}
            <div class="section inline"><button class="text" onClick=${() => setInviting(false)}>그만두기</button><span class="grow"></span>
              <button class="primary" disabled=${!picked.length} onClick=${() => run(invite, isGroup ? '초대했어요.' : '')}>${isGroup ? '초대' : '단체방 만들기'}</button></div>`}
          <div class="section"><button class="danger" onClick=${leave}>${isGroup ? '채팅방 나가기' : '대화방 지우기'}</button></div>
        </div>
      </div>
      ${draft && html`<${PhotoCrop} img=${draft} size=${640} title=${room.photo ? '이 사진으로 바꿀까요? 현재 사진은 삭제됩니다.' : '채팅방 사진으로 할까요?'} busy=${busy} onCancel=${() => setDraft(null)} onOk=${confirmPhoto} />`}
      ${viewing && room.photo && html`<${PhotoViewer} photo=${room.photo} caption=${`${room.photo_by}님이 게시한 사진입니다.`} onClose=${() => setViewing(false)} />`}
    </div>
  `;
}

// 나가기 전에 묻는 말: 1:1 은 두 사람 모두에게서 사라지고, 여럿 방은 나만 나감 (한 명만 남으면 방이 지워짐)
export function leaveQuestion(room) {
  return room.kind === 'dm'
    ? '이 대화방을 지울까요?\n상대방 채팅 목록에서도 사라지고, 대화 내용은 되돌릴 수 없어요.'
    : room.members.length <= 2
      ? '이 채팅방에서 나갈까요?\n한 명만 남게 되어 방이 지워지고, 대화 내용은 되돌릴 수 없어요.'
      : '이 채팅방에서 나갈까요?\n나만 나가고, 다른 사람들은 그대로 대화해요.';
}
