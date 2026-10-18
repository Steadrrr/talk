// 아래 탭 세 개: 친구(그룹별), 채팅(방 목록), 설정
import { useState } from 'preact/hooks';
import { html, Avatar, listTime } from './html.js';
import { api } from './api.js';
import { state, sortedRooms, roomTitle, openDm, createRoom, loadMe, clearAll, showProfile } from './store.js';
import { nickOf, fullName } from './names.js';
import { PushCard } from './pushui.js';

export function Home({ tab, setTab, onOpen }) {
  const unread = Object.values(state.rooms).reduce((n, r) => n + (r.unread || 0), 0);
  return html`
    <div class="home">
      ${tab === 'friends' && html`<${Friends} />`}
      ${tab === 'chats' && html`<${Chats} onOpen=${onOpen} />`}
      ${tab === 'settings' && html`<${Settings} />`}
      <nav class="tabs">
        <button class=${tab === 'friends' ? 'on' : ''} onClick=${() => setTab('friends')}><span class="ti">👥</span>친구</button>
        <button class=${tab === 'chats' ? 'on' : ''} onClick=${() => setTab('chats')}><span class="ti">💬</span>채팅${unread > 0 && html`<span class="badge">${unread > 99 ? '99+' : unread}</span>`}</button>
        <button class=${tab === 'settings' ? 'on' : ''} onClick=${() => setTab('settings')}><span class="ti">⚙️</span>설정</button>
      </nav>
    </div>
  `;
}

function Header({ title, children }) {
  return html`<header class="bar"><h2>${title}</h2>${!state.online && html`<span class="offline">연결 끊김</span>`}<span class="grow"></span>${children}</header>`;
}

function Friends() {
  const me = state.me;
  return html`
    <section class="page">
      <${Header} title="친구" />
      <div class="scroll">
        <button class="person me-row" onClick=${() => showProfile(me.id)}><${Avatar} name=${nickOf(me)} id=${me.id} photo=${me.photo} size=${78} /><b>${nickOf(me)}</b></button>
        ${state.groups.length === 0 && html`<p class="empty">아직 들어간 그룹이 없어요. 설정에서 초대 코드를 넣어 주세요.</p>`}
        ${state.groups.map((g) => html`
          <h3 class="group-title">${g.name} <span class="hint">${g.members.length}</span></h3>
          ${g.members.filter((m) => m.id !== me.id).map((m) => html`
            <button class="person" onClick=${() => showProfile(m.id)}><${Avatar} name=${nickOf(m)} id=${m.id} photo=${m.photo} size=${60} /><span>${nickOf(m)}</span></button>`)}
          ${g.members.length <= 1 && html`<p class="hint pad">아직 아무도 없어요.</p>`}`)}
      </div>
    </section>
  `;
}

function Chats({ onOpen }) {
  const [making, setMaking] = useState(false);
  const rooms = sortedRooms();
  return html`
    <section class="page">
      <${Header} title="채팅"><button class="icon" title="새 채팅방" onClick=${() => setMaking(true)}>＋</button><//>
      <div class="scroll">
        ${rooms.length === 0 && html`<p class="empty">아직 대화가 없어요. 친구 탭에서 이름을 누르거나 ＋ 로 방을 만들어 보세요.</p>`}
        ${rooms.map((r) => {
          const other = r.kind === 'dm' ? r.members.find((m) => m.id !== state.me.id) : null;
          return html`
            <button class="room" onClick=${() => onOpen(r.id)}>
              ${r.photo ? html`<${Avatar} photo=${r.photo} size=${72} />` : other ? html`<${Avatar} name=${nickOf(other)} id=${other.id} photo=${other.photo} size=${72} />` : html`<span class="avatar multi">${r.members.length}</span>`}
              <span class="room-main">
                <span class="room-top"><b class="ellipsis">${roomTitle(r)}</b>${r.kind === 'group' && html`<span class="hint">${r.members.length}</span>`}${r.pinned > 0 && html`<span class="mark" title="위에 고정">📌</span>`}${r.muted > 0 && html`<span class="mark" title="알림 끔">🔕</span>`}</span>
                <span class="ellipsis hint">${r.last ? r.last.body : '새 대화방'}</span>
              </span>
              <span class="room-side"><span class="hint small">${listTime(r.last?.at || r.created_at)}</span>${r.unread > 0 && html`<span class="badge">${r.unread > 99 ? '99+' : r.unread}</span>`}</span>
            </button>`;
        })}
      </div>
      ${making && html`<${NewRoom} onClose=${() => setMaking(false)} onOpen=${(id) => { setMaking(false); onOpen(id); }} />`}
    </section>
  `;
}

function NewRoom({ onClose, onOpen }) {
  const groups = state.groups.filter((g) => g.members.length > 1);
  const [gid, setGid] = useState(groups[0]?.id || 0);
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const group = groups.find((g) => g.id === gid);
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  async function make() {
    setErr('');
    try {
      if (picked.length === 1 && !name.trim()) onOpen(await openDm(picked[0]));
      else onOpen(await createRoom(gid, picked, name.trim()));
    } catch (e) { setErr(e.message); }
  }
  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <header class="bar"><button class="icon" onClick=${onClose}>✕</button><h2>새 채팅방</h2><span class="grow"></span>
          <button class="text" disabled=${!picked.length} onClick=${make}>만들기</button></header>
        ${!groups.length && html`<p class="empty">같은 그룹에 아직 다른 사람이 없어요.</p>`}
        ${groups.length > 1 && html`
          <div class="seg pad">${groups.map((g) => html`<button class=${g.id === gid ? 'on' : ''} onClick=${() => { setGid(g.id); setPicked([]); }}>${g.name}</button>`)}</div>`}
        ${group && html`
          <label class="pad">방 이름 <span class="hint">(비우면 사람 이름으로)</span><input value=${name} onInput=${(e) => setName(e.target.value)} maxlength="40" /></label>
          <div class="scroll">
            ${group.members.filter((m) => m.id !== state.me.id).map((m) => html`
              <label class="person check"><input type="checkbox" checked=${picked.includes(m.id)} onChange=${() => toggle(m.id)} /><${Avatar} name=${nickOf(m)} id=${m.id} photo=${m.photo} size=${60} /><span>${nickOf(m)}</span></label>`)}
          </div>`}
        ${err && html`<p class="err pad">${err}</p>`}
      </div>
    </div>
  `;
}

function Settings() {
  const [invite, setInvite] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  async function join(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    try {
      await api('groups/join', { invite });
      await loadMe();
      setInvite('');
      setMsg('그룹에 들어갔어요. 친구 탭에서 확인해 보세요.');
    } catch (e2) { setErr(e2.message); }
  }
  async function changePw(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    try {
      await api('auth/password', { old: oldPw, new: newPw });
      setOldPw(''); setNewPw('');
      setMsg('비밀번호를 바꿨어요.');
    } catch (e2) { setErr(e2.message); }
  }
  async function logout() {
    if (!confirm('이 기기에서 로그아웃할까요?')) return;
    try { await api('auth/logout', {}); } catch { /* 이미 끊긴 경우도 그냥 나감 */ }
    clearAll();
  }

  return html`
    <section class="page">
      <${Header} title="설정" />
      <div class="scroll pad">
        ${msg && html`<p class="ok">${msg}</p>`}
        ${err && html`<p class="err">${err}</p>`}
        <div class="card">
          <button class="me-row" onClick=${() => showProfile(state.me.id)}><${Avatar} name=${nickOf(state.me)} id=${state.me.id} photo=${state.me.photo} size=${78} /><div class="grow ellipsis" style="text-align:left"><b>${fullName(state.me)}</b><div class="hint">${state.groups.map((g) => g.name).join(' · ') || '그룹 없음'}</div></div><span class="hint">›</span></button>
          <p class="hint">눌러서 사진과 닉네임을 바꿀 수 있어요. 로그인은 본명(${state.me.name})으로 해요.</p>
        </div>
        <${PushCard} />
        ${!standalone && html`<div class="card"><b>홈 화면에 추가하기</b><p class="hint">아이폰: 사파리 아래 공유 버튼 → "홈 화면에 추가". 안드로이드: 크롬 메뉴 ⋮ → "홈 화면에 추가". 앱처럼 바로 열려요.</p></div>`}
        <form class="card" onSubmit=${join}>
          <b>초대 코드 넣기</b>
          <p class="hint">다른 그룹의 초대 코드를 받았으면 여기에 넣어요.</p>
          <div class="inline"><input value=${invite} onInput=${(e) => setInvite(e.target.value.toUpperCase())} placeholder="8자리" required autocapitalize="characters" /><button class="primary" type="submit">들어가기</button></div>
        </form>
        <form class="card" onSubmit=${changePw}>
          <b>비밀번호 바꾸기</b>
          <input type="password" value=${oldPw} onInput=${(e) => setOldPw(e.target.value)} placeholder="지금 비밀번호" required autocomplete="current-password" />
          <input type="password" value=${newPw} onInput=${(e) => setNewPw(e.target.value)} placeholder="새 비밀번호 (6자 이상)" required minlength="6" autocomplete="new-password" />
          <button class="primary" type="submit">바꾸기</button>
        </form>
        <button class="danger" onClick=${logout}>로그아웃</button>
        <p class="hint center">SAKi Talk · 광고 없음</p>
      </div>
    </section>
  `;
}
