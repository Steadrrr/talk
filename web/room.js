// 채팅방 화면: 메시지 목록(날짜 구분선, 안 읽은 사람 수), 위로 올리면 예전 대화, 아래 입력칸
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html, Avatar, PhotoViewer, time, dateLine, dayKey } from './html.js';
import { state, roomTitle, loadOlder, send, sendMedia, discard, showProfile, isHidden, hideMessage, deleteForAll } from './store.js';
import { mediaUrl, mediaInfo, saveMedia } from './media.js';
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
  const [viewing, setViewing] = useState(false);
  const [big, setBig] = useState(null);   // 크게 보는 사진·영상 메시지
  const [menu, setMenu] = useState(null); // 길게 눌러 연 사진·영상 메뉴
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

  // 키보드가 올라오거나 내려가 화면 높이가 바뀌면: 맨 아래를 보고 있었으면 계속 맨 아래
  useEffect(() => {
    const keep = () => { const el = scroller.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; };
    window.addEventListener('talk:fit', keep);
    return () => window.removeEventListener('talk:fit', keep);
  }, []);

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

  // 사진·영상 고르기: 여러 개면 차례로 보냄
  function pickFiles(e) {
    const files = [...(e.target.files || [])].slice(0, 10);
    e.target.value = '';
    atBottom.current = true;
    for (const f of files) sendMedia(id, f); // 모두 바로 화면에 올리고, 차례로 보냄
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
  const shown = list.filter((m) => !m.id || !isHidden(m.id));   // "나에게서 삭제" 한 것은 빼고
  shown.forEach((m, i) => {
    const day = dayKey(m.at);
    if (day !== prevDay) { rows.push(html`<div class="day" key=${'d' + day}><span>${dateLine(m.at)}</span></div>`); prevUser = 0; }
    prevDay = day;
    if (m.kind === 'system') {
      rows.push(html`<div class="msg-system" key=${m.id}><span>${m.body}</span></div>`);
      prevUser = 0;
      return;
    }
    const mine = m.user_id === state.me.id;
    const next = shown[i + 1];
    const minute = time(m.at);
    const first = m.user_id !== prevUser || minute !== prevMin;
    // 같은 사람이 같은 분에 이어 보낸 것은 마지막 것에만 시각을 붙인다
    const showTime = !next || next.user_id !== m.user_id || time(next.at) !== minute || dayKey(next.at) !== day;
    prevUser = m.user_id; prevMin = minute;
    const n = m.pending ? 0 : unreadCount(m);
    rows.push(html`
      <div class=${'msg ' + (mine ? 'mine' : 'theirs') + (first ? ' first' : '')} key=${m.id || m.client_id}>
        ${!mine && (first ? html`<button class="tap" onClick=${() => showProfile(m.user_id)} aria-label="프로필"><${Avatar} name=${names.get(m.user_id)} id=${m.user_id} photo=${byId.get(m.user_id)?.photo} size=${54} /></button>` : html`<span class="avatar-gap"></span>`)}
        <div class="msg-col">
          ${!mine && first && html`<div class="who tap" onClick=${() => showProfile(m.user_id)}>${names.get(m.user_id) || '나간 사람'}</div>`}
          <div class="msg-line">
            ${m.kind === 'photo' || m.kind === 'video' ? html`<${MediaBubble} m=${m} onOpen=${() => setBig(m)} onMenu=${() => setMenu(m)} />`
              : m.kind === 'deleted' ? html`<div class="bubble gone">삭제된 메시지예요</div>`
              : html`<div class="bubble">${m.body}</div>`}
            <div class="meta">
              ${m.failed ? html`<span class="small bad">못 보냄</span>`
                : m.pending ? html`<span class="hint small">보내는 중</span>`
                : html`${n > 0 && html`<span class="unread">${n}</span>`}${showTime && html`<span class="hint small">${minute}</span>`}`}
            </div>
          </div>
          ${m.failed && html`<div class="fail"><button class="del" onClick=${() => confirm('보내지 못한 것을 지울까요?') && discard(id, m)}>지우기</button><button class="retry" onClick=${() => m.kind === 'text' ? send(id, null, m) : sendMedia(id, null, m)}>재전송</button></div>`}
        </div>
      </div>`);
  });

  return html`
    <section class="page room-page">
      <header class="bar room-bar">
        <button class="icon" onClick=${onBack} aria-label="뒤로">‹</button>
        <div class="room-title">
        ${room.photo && html`<button class="tap" onClick=${() => setViewing(true)} aria-label="채팅방 사진"><${Avatar} photo=${room.photo} size=${34} /></button>`}
        <h2 class=${'ellipsis' + (room.kind === 'dm' && others[0] ? ' tap' : '')} onClick=${() => room.kind === 'dm' && others[0] && showProfile(others[0].id)}>${roomTitle(room)}</h2>
        ${room.kind === 'group' && html`<span class="hint">${room.members.length}</span>`}
        ${!state.online && html`<span class="offline">연결 끊김</span>`}
        ${room.muted > 0 && html`<span class="mark">🔕</span>`}
        </div>
        <button class="icon" onClick=${() => setSettings(true)} aria-label="방 설정">☰</button>
      </header>
      <div class="messages" ref=${scroller} onScroll=${onScroll}>
        ${loading && html`<p class="hint center">불러오는 중…</p>`}
        ${noMore && !list.length && html`<p class="empty">${others.length ? `${others.map(nickOf).join(', ')}님과의 대화를 시작해 보세요.` : '대화를 시작해 보세요.'}</p>`}
        ${rows}
      </div>
      <form class="composer" onSubmit=${(e) => { e.preventDefault(); submit(); }}>
        <label class="attach" aria-label="사진·영상 보내기">＋<input type="file" accept="image/*,video/*" multiple hidden onChange=${pickFiles} /></label>
        <textarea ref=${input} rows="1" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${onKey} placeholder="메시지" maxlength="4000"></textarea>
        <button type="submit" class="send" disabled=${!text.trim()} aria-label="보내기">↑</button>
      </form>
      ${menu && html`<${MediaMenu} m=${menu} mine=${menu.user_id === state.me.id} onClose=${() => setMenu(null)} />`}
      ${big && html`<${MediaViewer} m=${big} who=${names.get(big.user_id) || ''} onClose=${() => setBig(null)} />`}
      ${viewing && room.photo && html`<${PhotoViewer} photo=${room.photo} caption=${`${room.photo_by}님이 게시한 사진입니다.`} onClose=${() => setViewing(false)} />`}
      ${settings && html`<${RoomSettings} room=${room} onClose=${() => setSettings(false)} onLeft=${onBack} />`}
    </section>
  `;
}

const durText = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// 사진·영상 말풍선: 가로세로 비율대로, 보내는 중이면 진행률, 지워졌으면 안내
function MediaBubble({ m, onOpen, onMenu }) {
  const info = mediaInfo(m);
  const [broken, setBroken] = useState(false);
  const press = useLongPress(() => !m.pending && onMenu(), () => !m.pending && onOpen());
  if (!m.pending && (info.gone || broken)) return html`<div class="bubble gone">${m.kind === 'photo' ? '🖼️' : '🎬'} 보관 기간이 지나 지워졌어요</div>`;
  const ratio = info.w && info.h ? Math.max(0.5, Math.min(2, info.w / info.h)) : 1;
  const w = ratio >= 1 ? 240 : Math.round(240 * ratio);
  const style = { width: w + 'px', aspectRatio: String(ratio) };
  const src = m.pending ? m.local : m.kind === 'photo' ? mediaUrl(info.key) : info.thumb ? mediaUrl(info.key, true) : '';
  return html`
    <button class=${'media ' + m.kind} style=${style} ...${press} aria-label=${m.kind === 'photo' ? '사진 크게 보기' : '동영상 재생'}>
      ${src ? html`<img src=${src} alt="" loading="lazy" onError=${() => !m.pending && setBroken(true)} />` : html`<span class="media-blank"></span>`}
      ${m.kind === 'video' && !m.pending && html`<span class="play">▶</span><span class="dur">${durText(info.dur || 0)}</span>`}
      ${m.pending && !m.failed && html`<span class="media-progress"><span>${m.stage}${m.stage === '기다리는 중' ? '' : ` ${Math.round((m.progress || 0) * 100)}%`}</span><i style=${{ width: Math.round((m.progress || 0) * 100) + '%' }}></i></span>`}
      ${m.failed && html`<span class="media-progress err-box"><span>${m.error || '보내지 못했어요'}</span></span>`}
    </button>`;
}

// 길게 누르기(0.5초): 손가락을 떼기 전에 메뉴. 그냥 누르면 onTap. 움직이면(스크롤) 취소
function useLongPress(onLong, onTap) {
  const t = useRef(0), fired = useRef(false), start = useRef(null);
  const cancel = () => { clearTimeout(t.current); t.current = 0; };
  return {
    onPointerDown: (e) => {
      fired.current = false;
      start.current = [e.clientX, e.clientY];
      cancel();
      t.current = setTimeout(() => { fired.current = true; t.current = 0; navigator.vibrate?.(15); onLong(); }, 500);
    },
    onPointerMove: (e) => { if (t.current && start.current && Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 10) cancel(); },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e) => { e.preventDefault(); if (!fired.current) { cancel(); fired.current = true; onLong(); } },
    onClick: () => { if (fired.current) { fired.current = false; return; } onTap(); },
  };
}

// 사진·영상 메뉴: 저장, 나에게서 삭제, 모두에게 삭제(내가 보낸 것만)
function MediaMenu({ m, mine, onClose }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const what = m.kind === 'photo' ? '사진' : '영상';
  async function run(label, fn) {
    setErr(''); setBusy(label);
    try { await fn(); onClose(); } catch (e) { setErr(e.message || '하지 못했어요.'); } finally { setBusy(''); }
  }
  const gone = mediaInfo(m).gone;
  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet action-sheet" role="menu">
        ${err && html`<p class="err">${err}</p>`}
        ${!gone && html`<button onClick=${() => run('save', () => saveMedia(m))} disabled=${!!busy}>${busy === 'save' ? '받는 중…' : '저장'}</button>`}
        <button class="danger" onClick=${() => confirm(`이 ${what}을 내 화면에서 지울까요?\n(다른 사람에게는 그대로 보여요)`) && run('hide', () => hideMessage(m.id))} disabled=${!!busy}>삭제</button>
        ${mine && html`<button class="danger" onClick=${() => confirm(`이 ${what}을 모두에게서 지울까요?\n되돌릴 수 없어요.`) && run('all', () => deleteForAll(m))} disabled=${!!busy}>${busy === 'all' ? '지우는 중…' : '모두에게 삭제'}</button>`}
        <button class="cancel" onClick=${onClose}>취소</button>
      </div>
    </div>`;
}

// 크게 보기: 사진은 화면 가득, 영상은 바로 재생
function MediaViewer({ m, who, onClose }) {
  const info = mediaInfo(m);
  return html`
    <div class="viewer" onClick=${(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-label="크게 보기">
      <button class="viewer-close" onClick=${onClose} aria-label="닫기">✕</button>
      ${m.kind === 'photo'
        ? html`<img src=${mediaUrl(info.key)} alt="" onClick=${onClose} />`
        : html`<video src=${mediaUrl(info.key)} poster=${info.thumb ? mediaUrl(info.key, true) : undefined} controls autoplay playsinline></video>`}
      <p>${who} · ${time(m.at)}</p>
    </div>`;
}
