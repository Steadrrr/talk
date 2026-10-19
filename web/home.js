// 아래 탭 세 개: 친구(그룹별), 채팅(방 목록), 설정
import { useState, useRef } from 'preact/hooks';
import { html, Avatar, listTime } from './html.js';
import { api } from './api.js';
import { state, sortedRooms, roomTitle, openDm, createRoom, loadMe, clearAll, showProfile, leaveRoom, setBubble } from './store.js';
import { leaveQuestion } from './roomsettings.js';
import { nickOf, fullName } from './names.js';
import { PushCard } from './pushui.js';
import { InstallCard } from './install.js';
import { TAB_ICONS } from './icons.js';
import { preview } from './media.js';
import { FONT_SIZES, getFontSize, setFontSize } from './fontsize.js';
import { NoticeStrip } from './notices.js';
import { ChatThemePage } from './chattheme.js';

export function Home({ tab, setTab, onOpen }) {
  const unread = Object.values(state.rooms).reduce((n, r) => n + (r.unread || 0), 0);
  return html`
    <div class="home">
      ${tab === 'friends' && html`<${Friends} />`}
      ${tab === 'chats' && html`<${Chats} onOpen=${onOpen} />`}
      ${tab === 'settings' && html`<${Settings} />`}
      <nav class="tabs">
        <button class=${tab === 'friends' ? 'on' : ''} onClick=${() => setTab('friends')}><span class="ti">${TAB_ICONS.friends}</span>친구</button>
        <button class=${tab === 'chats' ? 'on' : ''} onClick=${() => setTab('chats')}><span class="ti">${TAB_ICONS.chats}</span>채팅${unread > 0 && html`<span class="badge">${unread > 99 ? '99+' : unread}</span>`}</button>
        <button class=${tab === 'settings' ? 'on' : ''} onClick=${() => setTab('settings')}><span class="ti">${TAB_ICONS.settings}</span>설정</button>
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
  const [swiped, setSwiped] = useState(0);   // 왼쪽으로 밀어서 쓰레기통이 보이는 방 (한 번에 하나)
  const rooms = sortedRooms();
  async function remove(r) {
    if (!confirm(leaveQuestion(r))) return;
    setSwiped(0);
    try { await leaveRoom(r.id); } catch (e) { alert(e.message); }
  }
  return html`
    <section class="page">
      <${Header} title="채팅"><button class="icon hicon" title="새 채팅방" aria-label="새 채팅방" onClick=${() => setMaking(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 4v16M4 12h16" /></svg></button><//>
      <div class="scroll">
        <${NoticeStrip} />
        ${rooms.length === 0 && html`<p class="empty">아직 대화가 없어요. 친구 탭에서 이름을 누르거나 ＋ 로 방을 만들어 보세요.</p>`}
        ${rooms.map((r) => {
          const other = r.kind === 'dm' ? r.members.find((m) => m.id !== state.me.id) : null;
          return html`
            <${SwipeRow} open=${swiped === r.id} setOpen=${(on) => setSwiped(on ? r.id : 0)} onTap=${() => (swiped ? setSwiped(0) : onOpen(r.id))}
              action=${html`<button class="swipe-del" aria-label=${r.kind === 'dm' ? '대화방 지우기' : '채팅방 나가기'} onClick=${() => remove(r)}>${TRASH}</button>`}>
              ${r.photo ? html`<${Avatar} photo=${r.photo} size=${72} />` : other ? html`<${Avatar} name=${nickOf(other)} id=${other.id} photo=${other.photo} size=${72} />` : html`<span class="avatar multi">${r.members.length}</span>`}
              <span class="room-main">
                <span class="room-top"><b class="ellipsis">${roomTitle(r)}</b>${r.kind === 'group' && html`<span class="hint">${r.members.length}</span>`}${r.pinned > 0 && html`<span class="mark" title="위에 고정">📌</span>`}${r.muted > 0 && html`<span class="mark" title="알림 끔">🔕</span>`}</span>
                <span class="ellipsis hint">${r.last ? preview(r.last) : '새 대화방'}</span>
              </span>
              <span class="room-side"><span class="hint small">${listTime(r.last?.at || r.created_at)}</span>${r.unread > 0 && html`<span class="badge">${r.unread > 99 ? '99+' : r.unread}</span>`}</span>
            <//>`;
        })}
      </div>
      ${making && html`<${NewRoom} onClose=${() => setMaking(false)} onOpen=${(id) => { setMaking(false); onOpen(id); }} />`}
    </section>
  `;
}

const TRASH = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>`;
const SWIPE_W = 76;

// 채팅 목록 한 줄: 왼쪽으로 밀면 오른쪽에 action(쓰레기통)이 나옴. 위아래 스크롤은 그대로 (touch-action: pan-y)
function SwipeRow({ open, setOpen, onTap, action, children }) {
  const [dx, setDx] = useState(null);   // 끄는 중일 때만 숫자
  const t = useRef(null);
  const swallow = useRef(false);
  const base = open ? -SWIPE_W : 0;
  function down(e) { t.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; }
  function move(e) {
    const s = t.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.moved) {
      if (Math.abs(mx) < 8) return;
      if (Math.abs(my) > Math.abs(mx)) { t.current = null; return; }
      s.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setDx(Math.max(-SWIPE_W * 1.4, Math.min(0, base + mx)));
  }
  function up() {
    const s = t.current;
    t.current = null;
    if (!s?.moved) return;
    setOpen(dx !== null && dx < -SWIPE_W / 2);
    setDx(null);
    // 끌기를 마친 뒤 따라오는 click 은 방 열기로 치지 않음
    swallow.current = true;
    setTimeout(() => { swallow.current = false; }, 50);
  }
  const x = dx ?? base;
  return html`
    <div class="swipe">
      <div class="swipe-act" style=${{ width: SWIPE_W + 'px', visibility: x < 0 ? 'visible' : 'hidden' }}>${action}</div>
      <button class=${'room' + (dx === null ? ' settle' : '')} style=${{ transform: x ? `translateX(${x}px)` : '' }}
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${() => { t.current = null; setDx(null); }}
        onClick=${() => !swallow.current && onTap()}>${children}</button>
    </div>`;
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
          <p class="hint pad">한 명을 고르면 1:1 대화, 여러 명을 고르면 단체방이 돼요.</p>
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
  const [fs, setFs] = useState(getFontSize());
  const [decor, setDecor] = useState(false);   // 채팅방 꾸미기 화면

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
  // 관리자 계정: 관리 화면을 비밀번호 없이 연다 (서버가 60초짜리 한 번 쓰는 표를 줌)
  async function openAdmin() {
    setMsg(''); setErr('');
    try { location.href = (await api('admin/ticket', {})).url; } catch (e2) { setErr(e2.message); }
  }
  async function logout() {
    if (!confirm('이 기기에서 로그아웃할까요?')) return;
    try { await api('auth/logout', {}); } catch { /* 이미 끊긴 경우도 그냥 나감 */ }
    clearAll();
  }

  if (decor) return html`<${ChatThemePage} onBack=${() => setDecor(false)} setBubble=${setBubble} />`;
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
        <div class="card">
          <b>글씨 크기</b>
          <div class="seg fs-seg">${FONT_SIZES.map((f) => html`<button class=${fs === f.key ? 'on' : ''} onClick=${() => { setFontSize(f.key); setFs(f.key); }}>${f.label}</button>`)}</div>
          <p class="hint fs-preview">대화와 목록의 글씨가 이 크기로 보여요. 이 기기에만 적용돼요.</p>
        </div>
        <button class="card nav-row" onClick=${() => setDecor(true)}>
          <span class="grow"><b>채팅방 꾸미기</b><div class="hint">말풍선 색, 배경 색, 배경화면</div></span><span class="hint">›</span>
        </button>
        <${InstallCard} />
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
        ${state.me.is_admin ? html`<button class="admin-link" onClick=${openAdmin}>⚙️ SAKi Talk 관리 <span class="hint">그룹·초대 코드·사람·알림 기록</span></button>` : ''}
        <p class="hint center">SAKi Talk · 광고 없음</p>
      </div>
    </section>
  `;
}
