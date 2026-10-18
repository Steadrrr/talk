// 채팅방 화면: 메시지 목록(날짜 구분선, 안 읽은 사람 수), 위로 올리면 예전 대화, 아래 입력칸
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html, Avatar, time, dateLine, dayKey } from './html.js';
import { state, roomTitle, loadOlder, send, discard, showProfile } from './store.js';
import { nickOf } from './names.js';
import { RoomSettings } from './roomsettings.js';

export function Room({ id, onBack }) {
  const room = state.rooms[id];
  const list = state.messages[id] || [];
  const scroller = useRef(null);
  const atBottom = useRef(true);
  const keepFrom = useRef(null); // 예전 대화를 위에 붙일 때 보던 자리를 지키려고
  const [noMore, setNoMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [settings, setSettings] = useState(false);
  const input = useRef(null);

  // 처음 열 때 기기에 메시지가 없으면 서버에서
  useEffect(() => {
    if (!list.length) loadOlder(id).then((more) => { if (!more) setNoMore(true); }).catch(() => {});
  }, [id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  async function onScroll() {
    const el = scroller.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 80 && !loading && !noMore && list.length) {
      setLoading(true);
      keepFrom.current = el.scrollHeight - el.scrollTop;
      try { if (!(await loadOlder(id))) setNoMore(true); } catch { keepFrom.current = null; }
      setLoading(false);
    }
  }

  function submit() {
    const body = text.trim();
    if (!body) return;
    setText('');
    atBottom.current = true;
    send(id, body);
    input.current?.focus();
  }

  function onKey(e) {
    // 한글 입력 중(조합 중) Enter 는 글자 확정이라 보내지 않는다. 휴대폰은 Enter = 줄바꿈, 보내기는 버튼
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      submit();
    }
  }

  // 입력칸 높이를 글 길이에 맞춤 (최대 5줄 정도)
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [text]);

  if (!room) return html`<section class="page"><header class="bar"><button class="icon" onClick=${onBack}>‹</button></header><p class="empty">방을 찾지 못했어요.</p></section>`;

  const others = room.members.filter((m) => m.id !== state.me.id);
  const byId = new Map(room.members.map((m) => [m.id, m]));
  const names = new Map(room.members.map((m) => [m.id, nickOf(m)]));
  // 안 읽은 사람 수: 그 메시지 번호까지 아직 안 읽은 사람 (보낸 사람은 읽은 것으로)
  const unreadCount = (m) => m.kind === 'system' ? 0 : room.members.filter((p) => p.id !== m.user_id && p.last_read_id < m.id).length;

  const rows = [];
  let prevDay = '', prevUser = 0, prevMin = '';
  list.forEach((m, i) => {
    const day = dayKey(m.at);
    if (day !== prevDay) { rows.push(html`<div class="day" key=${'d' + day}><span>${dateLine(m.at)}</span></div>`); prevUser = 0; }
    prevDay = day;
    if (m.kind === 'system') {
      rows.push(html`<div class="msg-system" key=${m.id}><span>${m.body}</span></div>`);
      prevUser = 0;
      return;
    }
    const mine = m.user_id === state.me.id;
    const next = list[i + 1];
    const minute = time(m.at);
    const first = m.user_id !== prevUser || minute !== prevMin;
    // 같은 사람이 같은 분에 이어 보낸 것은 마지막 것에만 시각을 붙인다
    const showTime = !next || next.user_id !== m.user_id || time(next.at) !== minute || dayKey(next.at) !== day;
    prevUser = m.user_id; prevMin = minute;
    const n = m.pending ? 0 : unreadCount(m);
    rows.push(html`
      <div class=${'msg ' + (mine ? 'mine' : 'theirs') + (first ? ' first' : '')} key=${m.id || m.client_id}>
        ${!mine && (first ? html`<button class="tap" onClick=${() => showProfile(m.user_id)} aria-label="프로필"><${Avatar} name=${names.get(m.user_id)} id=${m.user_id} photo=${byId.get(m.user_id)?.photo} size=${36} /></button>` : html`<span class="avatar-gap"></span>`)}
        <div class="msg-col">
          ${!mine && first && html`<div class="who tap" onClick=${() => showProfile(m.user_id)}>${names.get(m.user_id) || '나간 사람'}</div>`}
          <div class="msg-line">
            <div class="bubble">${m.body}</div>
            <div class="meta">
              ${m.failed ? html`<span class="fail"><button onClick=${() => send(id, null, m)}>다시 보내기</button><button onClick=${() => discard(id, m)}>지우기</button></span>`
                : m.pending ? html`<span class="hint small">보내는 중</span>`
                : html`${n > 0 && html`<span class="unread">${n}</span>`}${showTime && html`<span class="hint small">${minute}</span>`}`}
            </div>
          </div>
        </div>
      </div>`);
  });

  return html`
    <section class="page room-page">
      <header class="bar">
        <button class="icon" onClick=${onBack} aria-label="뒤로">‹</button>
        <h2 class=${'ellipsis' + (room.kind === 'dm' && others[0] ? ' tap' : '')} onClick=${() => room.kind === 'dm' && others[0] && showProfile(others[0].id)}>${roomTitle(room)}</h2>
        ${room.kind === 'group' && html`<span class="hint">${room.members.length}</span>`}
        ${!state.online && html`<span class="offline">연결 끊김</span>`}
        ${room.muted > 0 && html`<span class="mark">🔕</span>`}
        <span class="grow"></span>
        <button class="icon" onClick=${() => setSettings(true)} aria-label="방 설정">☰</button>
      </header>
      <div class="messages" ref=${scroller} onScroll=${onScroll}>
        ${loading && html`<p class="hint center">불러오는 중…</p>`}
        ${noMore && !list.length && html`<p class="empty">${others.length ? `${others.map(nickOf).join(', ')}님과의 대화를 시작해 보세요.` : '대화를 시작해 보세요.'}</p>`}
        ${rows}
      </div>
      <form class="composer" onSubmit=${(e) => { e.preventDefault(); submit(); }}>
        <textarea ref=${input} rows="1" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${onKey} placeholder="메시지" maxlength="4000"></textarea>
        <button type="submit" class="send" disabled=${!text.trim()} aria-label="보내기">↑</button>
      </form>
      ${settings && html`<${RoomSettings} room=${room} onClose=${() => setSettings(false)} onLeft=${onBack} />`}
    </section>
  `;
}
