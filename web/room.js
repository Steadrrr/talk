// 채팅방 화면: 메시지 목록(날짜 구분선, 안 읽은 사람 수), 위로 올리면 예전 대화, 아래 입력칸
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html, Avatar, time, dateLine, dayKey } from './html.js';
import { state, photoOf, roomTitle, loadOlder, send, sendMedia, sendAlbum, sendPlace, discard, showProfile, isHidden, hideMessage, deleteForAll, react, REACTIONS, searchRoom, loadUntil, setNotice, setTyping } from './store.js';
import { mediaUrl, mediaInfo, mediaItems, saveMedia } from './media.js';
import { useLongPress, useBackdrop, Collage, MediaViewer, Gallery, ForwardSheet, MenuPreview, viewItems } from './gallery.js';
import { nickOf } from './names.js';
import { bubbleStyle } from './chattheme.js';
import { RoomSettings } from './roomsettings.js';
import { SendPreview } from './photoedit.js';
import { PlaceBubble, PlaceSheet, AttachSheet, HereSheet, PlaceSearch, placeInfo } from './place.js';

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
  const [big, setBig] = useState(null);   // 크게 보는 사진·영상 { items, start }
  const [photos, setPhotos] = useState(false); // 채팅방 사진 모아보기
  const [fwd, setFwd] = useState(null);   // 전달할 메시지
  const [menu, setMenu] = useState(null); // 길게 눌러 연 메시지 메뉴
  const [replyTo, setReplyTo] = useState(null); // 답장할 메시지
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null); // 보내기 전에 보는 사진들 (편집 가능)
  const [attach, setAttach] = useState('');   // ＋ 메뉴: 'menu' | 'here' (내 위치) | 'search' (장소 검색)
  const [place, setPlace] = useState(null);   // 눌러서 연 장소 메시지
  const input = useRef(null);           // 지금 쓰는 입력칸 (아래 두 칸 중 하나)
  const boxes = [useRef(null), useRef(null)];
  const [cur, setCur] = useState(0);
  useLayoutEffect(() => { input.current = boxes[cur].current; });

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

  // 보내기: 입력칸을 비우지 않고 비어 있는 다른 칸으로 커서를 옮긴다.
  // 아이폰 한글 키보드는 칸마다 조합 중인 글자·앞 글자를 기억해서, 같은 칸을 지우면 마지막 글자가
  // 다시 들어오거나 지우기를 누를 때 되살아났다. 새 칸은 키보드 기억이 깨끗하다.
  // (누르는 순간 안에서 칸을 옮기므로 키보드는 내려가지 않음)
  function submit() {
    const old = input.current;
    const body = (old ? old.innerText.replace(/\n$/, '') : text).trim().slice(0, 4000);
    if (!body) return;
    const next = boxes[1 - cur].current;
    if (old && next) {
      next.textContent = '';
      fitBox(next);
      next.classList.remove('spare');
      old.classList.add('spare');
      input.current = next;
      if (document.activeElement === old) next.focus();
      old.textContent = '';
      setTimeout(() => { if (input.current !== old) old.textContent = ''; }, 300); // 늦게 끝난 조합 글자도 정리
      setCur(1 - cur);
    }
    setText('');
    atBottom.current = true;
    send(id, body, null, replyTo);
    setReplyTo(null);
  }

  // 사진·영상 고르기: 사진은 먼저 크게 보며 빼거나 편집한 뒤 보내기, 영상은 하나씩 바로 보냄
  function pickFiles(e) {
    const files = [...(e.target.files || [])].slice(0, 60);
    e.target.value = '';
    atBottom.current = true;
    const photos = files.filter((f) => !f.type.startsWith('video/'));
    if (photos.length) setPicked(photos);
    for (const f of files.filter((f) => f.type.startsWith('video/'))) sendMedia(id, f);
  }
  // 여러 장은 한 묶음(30장씩)으로. 모두 바로 화면에 올리고 차례로 보냄
  function sendPhotos(photos) {
    setPicked(null);
    atBottom.current = true;
    for (let i = 0; i < photos.length; i += 30) {
      const part = photos.slice(i, i + 30);
      if (part.length > 1) sendAlbum(id, part); else sendMedia(id, part[0]);
    }
  }

  function onKey(e) {
    // 한글 입력 중(조합 중) Enter 는 글자 확정이라 보내지 않는다. 휴대폰은 Enter = 줄바꿈, 보내기는 버튼
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      submit();
    }
  }

  // 입력칸에 글자가 남아 있으면 계속 입력 중 (3초마다 다시 알림, 앱을 숨기면 서버가 끔)
  const hasText = text.trim() !== '';
  useEffect(() => {
    if (!hasText) return;
    const t = setInterval(() => { if (!document.hidden) setTyping(id, true); }, 3000);
    return () => clearInterval(t);
  }, [hasText, id]);

  // 입력칸은 textarea 대신 글만 받는 편집 칸: 아이폰 사파리가 textarea 를 주소 칸으로 보고
  // autocomplete=off 여도 키보드 위에 '자동 완성 연락처'(집 주소)를 띄웠음. 높이는 CSS 로 최대 5줄 정도
  function onEdit(e) {
    const el = e.currentTarget;
    if (el !== input.current) return;    // 보낸 뒤 쉬는 칸에 늦게 들어온 글자는 무시
    const t = el.innerText.replace(/\n$/, '');
    fitBox(el);
    setText(t);
    setTyping(id, t.trim() !== '');
  }
  // 입력칸 사이 빈틈(＋ 옆 등)을 눌러도 입력칸으로: 빈틈을 누르면 아이폰이 커서를 뺐다 넣었다 하며
  // 키보드가 내려갔다 올라와 화면이 튀었음 → 누름 자체를 막고, 커서가 없을 때만 입력칸 끝에 커서를 둔다
  function onGap(e) {
    if (e.target !== e.currentTarget && !e.target.classList.contains('msg-box')) return;
    e.preventDefault();
    const el = input.current;
    if (e.type !== 'click' || !el || document.activeElement === el) return;   // 키보드는 누름이 끝날 때 열어야 아이폰이 띄움
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  // 붙여넣기는 글자만 (plaintext-only 를 모르는 브라우저에서 서식·그림이 들어오지 않게)
  function onPaste(e) {
    if (CE === 'plaintext-only') return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
  }

  // 검색 결과로 가기: 기기에 없으면 예전 대화를 더 받아 온 뒤
  async function goTo(msgId) {
    setSearching(false);
    atBottom.current = false;
    await loadUntil(id, msgId).catch(() => {});
    requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(msgId)));
  }

  // 답장의 원래 글로 가기 (기기에 있는 것만)
  function jumpTo(msgId) {
    const el = scroller.current?.querySelector(`[data-id="${msgId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  // 말풍선을 좌우로 밀면 그 메시지에 답장 (손가락만; 위아래로 먼저 움직이면 스크롤)
  const sw = useRef(null);
  const swBlock = useRef(false);   // 민 뒤에 오는 누르기(사진 열기 등)는 무시
  function swDown(e) {
    swBlock.current = false;
    const row = e.pointerType !== 'mouse' && e.isPrimary && e.target.closest('.msg[data-id]');
    sw.current = row ? { row, x: e.clientX, y: e.clientY, id: e.pointerId, on: false, dx: 0 } : null;
  }
  function swMove(e) {
    const d = sw.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { sw.current = null; return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      d.on = true;
      d.row.style.transition = '';
      d.row.classList.add('swiping', dx > 0 ? 'r' : 'l');
    }
    const was = Math.abs(d.dx) >= SWIPE;
    d.dx = Math.sign(dx) * Math.min(SWIPE * 1.4, Math.abs(dx) * 0.7);
    if (!was && Math.abs(d.dx) >= SWIPE) navigator.vibrate?.(10);
    // 미는 사이 새 메시지로 다시 그려지면 class 가 지워지므로 매번 다시 붙임
    d.row.classList.add('swiping');
    d.row.classList.toggle('r', d.dx > 0); d.row.classList.toggle('l', d.dx < 0);
    d.row.style.setProperty('--sw', Math.min(1, Math.abs(d.dx) / SWIPE));
    d.row.style.setProperty('--swd', Math.abs(d.dx));
    d.row.style.transform = `translateX(${d.dx}px)`;
  }
  function swUp(e) {
    const d = sw.current;
    if (!d || d.id !== e.pointerId) return;
    sw.current = null;
    if (!d.on) return;
    swBlock.current = true;
    const row = d.row;
    row.style.transition = 'transform .18s ease-out';
    row.style.transform = '';
    setTimeout(() => { row.classList.remove('swiping', 'r', 'l'); row.style.transition = ''; }, 200);
    const m = e.type === 'pointerup' && Math.abs(d.dx) >= SWIPE && list.find((x) => String(x.id) === row.dataset.id);
    if (m && m.kind !== 'deleted' && m.kind !== 'system') { setReplyTo(m); input.current?.focus(); }
  }
  function swClick(e) {
    if (swBlock.current) { swBlock.current = false; e.stopPropagation(); e.preventDefault(); }
  }

  if (!room) return html`<section class="page"><header class="bar"><button class="icon" onClick=${onBack}>‹</button></header><p class="empty">방을 찾지 못했어요.</p></section>`;

  const others = room.members.filter((m) => m.id !== state.me.id);
  const byId = new Map(room.members.map((m) => [m.id, m]));
  const names = new Map(room.members.map((m) => [m.id, nickOf(m)]));
  // 안 읽은 사람 수: 그 메시지 번호까지 아직 안 읽은 사람 (보낸 사람은 읽은 것으로)
  const unreadCount = (m) => m.kind === 'system' ? 0 : room.members.filter((p) => p.id !== m.user_id && !p.bot && p.last_read_id < m.id).length;

  // 같은 사람이 이어 보낸 것은 한 묶음: 프로필 사진·대화명은 한 번만 (시간이 많이 지나도), 사진은 묶음 말풍선들의 가운데.
  // 시각은 분마다 그 분의 마지막 말풍선 옆에. 밀어서 답장할 때는 말풍선 줄(.msg)만 밀리고 사진·대화명은 그대로
  const rows = [];
  const shown = list.filter((m) => !m.id || !isHidden(m.id));   // "나에게서 삭제" 한 것은 빼고
  let group = null;
  const flush = () => {
    if (!group) return;
    const { uid, items } = group;
    const mine = uid === state.me.id;
    const first = items[0];
    rows.push(mine ? html`<div class="msg-group mine" key=${'g' + (first.id || first.client_id)}><div class="who">나</div>${items.map((x) => x.row)}</div>`
      : html`
      <div class="msg-group theirs" key=${'g' + (first.id || first.client_id)}>
        <div class="who tap" onClick=${() => showProfile(uid)}>${names.get(uid) || '나간 사람'}</div>
        <div class="grp-body">
          <button class="tap grp-face" onClick=${() => showProfile(uid)} aria-label="프로필"><${Avatar} name=${names.get(uid)} id=${uid} photo=${photoOf(byId.get(uid))} size=${54} /></button>
          <div class="grp-rows">${items.map((x) => x.row)}</div>
        </div>
      </div>`);
    group = null;
  };
  let prevDay = '';
  shown.forEach((m, i) => {
    const day = dayKey(m.at);
    if (day !== prevDay) { flush(); rows.push(html`<div class="day" key=${'d' + day}><span>${dateLine(m.at)}</span></div>`); }
    prevDay = day;
    if (m.kind === 'system') {
      flush();
      rows.push(html`<div class="msg-system" key=${m.id}><span>${m.body}</span></div>`);
      return;
    }
    const mine = m.user_id === state.me.id;
    if (group && group.uid !== m.user_id) flush();
    const firstInGroup = !group;
    if (!group) group = { uid: m.user_id, items: [] };
    const next = shown[i + 1];
    const minute = time(m.at);
    // 같은 사람이 같은 분에 이어 보낸 것은 마지막 것에만 시각을 붙인다
    const showTime = !next || next.user_id !== m.user_id || time(next.at) !== minute || dayKey(next.at) !== day;
    const n = m.pending ? 0 : unreadCount(m);
    group.items.push({ row: html`
      <div class=${'msg ' + (mine ? 'mine' : 'theirs') + (firstInGroup ? ' first' : '')} key=${m.id || m.client_id} data-id=${m.id || undefined}>
        <div class="msg-col">
          <div class="msg-line">
            ${m.kind === 'photo' || m.kind === 'video' ? html`<${MediaBubble} m=${m} onOpen=${() => setBig({ items: viewItems(m), start: 0 })} onMenu=${() => setMenu(m)} />`
              : m.kind === 'place' ? html`<${PlaceBubble} m=${m} onOpen=${() => setPlace(m)} onMenu=${() => setMenu(m)} />`
              : m.kind === 'deleted' ? html`<div class="bubble gone">삭제된 메시지예요</div>`
              : html`<${TextBubble} m=${m} names=${names} style=${mine ? null : bubbleStyle(byId.get(m.user_id))} onMenu=${() => setMenu(m)} onJump=${jumpTo} />`}
            <div class="meta">
              ${m.failed ? html`<span class="small bad">못 보냄</span>`
                : m.pending ? html`<span class="hint small">보내는 중</span>`
                : html`${n > 0 && html`<span class="unread">${n}</span>`}${showTime && html`<span class="hint small">${minute}</span>`}`}
            </div>
          </div>
          ${m.kind === 'text' && m.links?.length > 0 && html`<${LinkCards} links=${m.links} />`}
          ${m.kind !== 'deleted' && m.reactions?.length > 0 && html`<${Reactions} m=${m} names=${names} />`}
          ${m.failed && html`<div class="fail"><button class="del" onClick=${() => confirm('보내지 못한 것을 지울까요?') && discard(id, m)}>지우기</button><button class="retry" onClick=${() => m.kind === 'text' ? send(id, null, m) : m.kind === 'place' ? sendPlace(id, null, m) : m.album ? sendAlbum(id, null, m) : sendMedia(id, null, m)}>재전송</button></div>`}
        </div>
      </div>` });
  });
  flush();

  return html`
    <section class="page room-page">
      <header class="bar room-bar">
        <button class="icon hicon" onClick=${onBack} aria-label="뒤로">${BACK_ICON}</button>
        <div class="room-title">
        <h2 class=${'ellipsis' + (room.kind === 'dm' && others[0] ? ' tap' : '')} onClick=${() => room.kind === 'dm' && others[0] && showProfile(others[0].id)}>${roomTitle(room)}</h2>
        ${room.kind === 'group' && html`<span class="hint">${room.members.length}</span>`}
        ${!state.online && html`<span class="offline">연결 끊김</span>`}
        ${room.muted > 0 && html`<span class="mark">🔕</span>`}
        </div>
        <div class="bar-right">
          <button class="icon hicon" onClick=${() => setSearching(true)} aria-label="대화 검색">${SEARCH_ICON}</button>
          <button class="icon hicon" onClick=${() => setSettings(true)} aria-label="방 설정">${MENU_ICON}</button>
        </div>
      </header>
      ${room.notice && html`<${NoticeBar} notice=${room.notice} roomId=${id} onGo=${() => goTo(room.notice.id)} />`}
      <div class="messages" ref=${scroller} onScroll=${onScroll}
        onPointerDown=${swDown} onPointerMove=${swMove} onPointerUp=${swUp} onPointerCancel=${swUp} onClickCapture=${swClick}>
        ${loading && html`<p class="hint center">불러오는 중…</p>`}
        ${noMore && !list.length && html`<p class="empty">${others.length ? `${others.map(nickOf).join(', ')}님과의 대화를 시작해 보세요.` : '대화를 시작해 보세요.'}</p>`}
        ${rows}
        ${state.typing.length > 0 && html`<div class="typing" aria-live="polite"><span class="dots"><i></i><i></i><i></i></span>
          <span class="hint small">${room.kind === 'dm' ? '입력 중' : `${state.typing.map((u) => names.get(u)).filter(Boolean).join(', ')}님이 입력 중`}</span></div>`}
      </div>
      ${replyTo && html`
        <div class="reply-bar">
          <div class="grow ellipsis"><b>${names.get(replyTo.user_id) || '나간 사람'}</b>에게 답장<br /><span class="hint">${replyPreview(replyTo)}</span></div>
          <button class="icon" onClick=${() => setReplyTo(null)} aria-label="답장 그만두기">✕</button>
        </div>`}
      <div class="composer" onPointerDown=${onGap} onClick=${onGap}>
        <button type="button" class="attach" onClick=${() => setAttach('menu')} aria-label="사진·위치 보내기">＋</button>
        <div class="msg-box">
          ${boxes.map((r, i) => html`
            <div key=${i} ref=${r} class=${'msg-input' + (i === cur ? (text ? '' : ' blank') : ' spare')} contentEditable=${CE} role="textbox" aria-multiline="true" aria-label="메시지" data-placeholder="메시지"
              aria-hidden=${i === cur ? null : 'true'} tabIndex=${i === cur ? 0 : -1}
              autocapitalize="off" spellcheck="false" onInput=${onEdit} onScroll=${keepTop} onKeyDown=${onKey} onPaste=${onPaste}></div>`)}
        </div>
        <button type="button" class="send" onPointerDown=${(e) => e.preventDefault()} onClick=${submit} disabled=${!text.trim()} aria-label="보내기">↑</button>
      </div>
      ${menu && html`<${MsgMenu} m=${menu} mine=${menu.user_id === state.me.id} bubble=${menu.user_id === state.me.id ? null : bubbleStyle(byId.get(menu.user_id))} name=${names.get(menu.user_id)} isNotice=${room.notice?.id === menu.id} onClose=${() => setMenu(null)}
        onReply=${() => { setReplyTo(menu); setMenu(null); input.current?.focus(); }} onForward=${() => { setFwd(menu); setMenu(null); }} />`}
      ${big && html`<${MediaViewer} items=${big.items} start=${big.start} names=${names} onClose=${() => setBig(null)} />`}
      ${photos && html`<${Gallery} room=${room} names=${names} onClose=${() => setPhotos(false)} />`}
      ${picked && html`<${SendPreview} files=${picked} onSend=${sendPhotos} onClose=${() => setPicked(null)} />`}
      ${attach === 'menu' && html`<${AttachSheet} onFiles=${pickFiles} onHere=${() => setAttach('here')} onSearch=${() => setAttach('search')} onClose=${() => setAttach('')} />`}
      ${attach === 'here' && html`<${HereSheet} roomId=${id} onSent=${() => { atBottom.current = true; setAttach(''); }} onClose=${() => setAttach('')} />`}
      ${attach === 'search' && html`<${PlaceSearch} roomId=${id} onSent=${() => { atBottom.current = true; setAttach(''); }} onClose=${() => setAttach('')} />`}
      ${place && html`<${PlaceSheet} m=${place} onClose=${() => setPlace(null)} />`}
      ${fwd && html`<${ForwardSheet} m=${fwd} onClose=${() => setFwd(null)} />`}
      ${searching && html`<${RoomSearch} roomId=${id} names=${names} onClose=${() => setSearching(false)} onPick=${goTo} />`}
      ${settings && html`<${RoomSettings} room=${room} onClose=${() => setSettings(false)} onLeft=${onBack} onPhotos=${() => { setSettings(false); setPhotos(true); }} />`}
    </section>
  `;
}

const SWIPE = 56;   // 이만큼 밀면 답장

const durText = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// 사진·영상 말풍선: 가로세로 비율대로, 보내는 중이면 진행률, 지워졌으면 안내
function MediaBubble({ m, onOpen, onMenu }) {
  const info = mediaInfo(m);
  const [broken, setBroken] = useState(false);
  const press = useLongPress(() => !m.pending && onMenu(), () => !m.pending && onOpen());
  if (m.pending ? m.album : !info.gone && viewItems(m).length > 1) return html`<${Collage} m=${m} press=${press} />`;
  if (!m.pending && info.items && !info.gone) {
    // 묶음에서 한 장만 남음: 그 한 장을 보통 사진처럼
    const it = viewItems(m)[0];
    if (it) Object.assign(info, mediaItems(m)[it.i]);
  }
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

// 위쪽 아이콘 셋: 같은 크기·같은 굵기 (크기는 방 이름 글씨에 맞춤, CSS .hicon)
const hsvg = (d) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const BACK_ICON = hsvg(html`<path d="M15 4 7 12l8 8" />`);
const SEARCH_ICON = hsvg(html`<circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" />`);
const MENU_ICON = hsvg(html`<path d="M4 6h16M4 12h16M4 18h16" />`);

// 대화 검색: 글자를 넣으면 잠깐 뒤 서버에서 찾고, 누르면 그 메시지로
function RoomSearch({ roomId, names, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const word = q.trim();
    if (!word) { setRes(null); return; }
    let live = true;
    const t = setTimeout(() => {
      searchRoom(roomId, word).then((r) => live && (setRes(r), setErr(''))).catch((e) => live && setErr(e.message));
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const mark = (body) => {
    const word = q.trim(), i = body.toLowerCase().indexOf(word.toLowerCase());
    if (i < 0) return body;
    const from = Math.max(0, i - 20);
    return html`${from > 0 ? '…' : ''}${body.slice(from, i)}<mark>${body.slice(i, i + word.length)}</mark>${body.slice(i + word.length, i + word.length + 60)}`;
  };
  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button>
          <input class="grow search-input" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="대화 검색" autofocus enterkeyhint="search" /></header>
        <div class="scroll">
          ${err && html`<p class="err pad">${err}</p>`}
          ${res && res.length === 0 && html`<p class="empty">찾는 글이 없어요.</p>`}
          ${res && res.map((m) => html`
            <button class="search-hit" onClick=${() => onPick(m.id)}>
              <span class="hit-top"><b>${names.get(m.user_id) || '나간 사람'}</b><span class="hint small">${dateLine(m.at)} ${time(m.at)}</span></span>
              <span class="hit-body">${mark(m.body)}</span>
            </button>`)}
        </div>
      </div>
    </div>`;
}

// 공지 띠: 방 위에 걸린 글. 누르면 그 글로, 접으면 이 기기에서 작은 단추로 (새 공지가 올라오면 다시 펼침)
function NoticeBar({ notice, roomId, onGo }) {
  const key = 'talk.noticeFold.' + roomId;
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(key) === String(notice.id); } catch { return false; } });
  useEffect(() => { try { setFolded(localStorage.getItem(key) === String(notice.id)); } catch { /* 무시 */ } }, [notice.id]);
  const fold = (v) => { setFolded(v); try { v ? localStorage.setItem(key, String(notice.id)) : localStorage.removeItem(key); } catch { /* 무시 */ } };
  if (folded) return html`<button class="notice-pill" onClick=${() => fold(false)} aria-label="공지 펼치기">📢 공지</button>`;
  return html`
    <div class="notice-bar">
      <button class="notice-body" onClick=${onGo}>
        <span class="notice-text">📢 ${notice.body}</span>
        <span class="hint small">${notice.by}님이 올린 공지</span>
      </button>
      <button class="icon notice-fold" onClick=${() => fold(true)} aria-label="공지 접기">⌃</button>
    </div>`;
}

// 입력칸은 다섯 줄을 넘을 때만 스크롤: 한 줄일 때도 글자 높이가 줄 높이보다 몇 px 커서 스크롤할 수 있는 칸이 돼,
// 커서를 끌면 스크롤바가 생기고 글이 밀려 내려갔음 → 넘치지 않으면 overflow 를 막고 밀린 자리를 되돌림
function fitBox(el) {
  el.classList.toggle('tall', el.scrollHeight > el.clientHeight + 8);
  if (!el.classList.contains('tall')) el.scrollTop = 0;
}
function keepTop(e) {
  const el = e.currentTarget;
  if (!el.classList.contains('tall') && el.scrollTop) el.scrollTop = 0;
}

// 글만 받는 편집 칸을 지원하면 그것으로 (사파리·크롬), 아니면 일반 편집 칸
const CE = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; } catch { return 'true'; } })();

// 답장 미리보기 한 줄
const replyPreview = (r) => r.kind === 'photo' ? '사진' : r.kind === 'video' ? '동영상' : r.kind === 'place' ? '📍 장소' : r.kind === 'deleted' ? '삭제된 메시지' : r.body;

// 글 말풍선: 길게 누르면 메뉴, 답장이면 위에 원래 글
function TextBubble({ m, names, style, onMenu, onJump }) {
  const press = useLongPress(() => !m.pending && onMenu(), () => {});
  return html`
    <div class="bubble" style=${style} ...${press}>
      ${m.reply && html`<div class="quote" onClick=${(e) => { e.stopPropagation(); onJump(m.reply.id); }}>
        <b>${names.get(m.reply.user_id) || '나간 사람'}</b><span>${replyPreview(m.reply)}</span></div>`}
      ${m.body}
    </div>`;
}

// 사키가 붙인 링크: 제목 + 사이트 이름 카드, 누르면 새 창 (서버가 https 주소만 남김)
const LINK_ICON = { youtube: '▶️', naver: '🔎', page: '🔗' };
function LinkCards({ links }) {
  const site = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  return html`
    <div class="link-cards">
      ${links.filter((l) => /^https:\/\//.test(l.url)).map((l) => html`
        <a class="link-card" href=${l.url} target="_blank" rel="noopener noreferrer">
          <span class="link-icon">${LINK_ICON[l.kind] || LINK_ICON.page}</span>
          <span class="link-text"><b class="ellipsis">${l.title}</b><span class="hint small ellipsis">${site(l.url)}</span></span>
        </a>`)}
    </div>`;
}

// 반응 모음: 이모지별 개수, 누르면 나도 같은 반응(다시 누르면 뺌)
function Reactions({ m, names }) {
  const groups = new Map();
  for (const [u, e] of m.reactions) groups.set(e, [...(groups.get(e) || []), u]);
  return html`
    <div class="reactions">
      ${[...groups].map(([e, us]) => html`
        <button class=${'react-chip' + (us.includes(state.me.id) ? ' on' : '')} title=${us.map((u) => names.get(u) || '나간 사람').join(', ')}
          onClick=${() => react(m, e).catch(() => {})}>${e}${us.length > 1 ? html` <span>${us.length}</span>` : ''}</button>`)}
    </div>`;
}

// 메시지 메뉴(길게 누르기): 반응, 답장, 복사(글)·전달(같은 그룹 방·친구)·저장(사진·영상, 묶음은 전부), 삭제(이 기기에서 숨김), 모두에게 삭제(내가 보낸 것만)
function MsgMenu({ m, mine, bubble, name, isNotice, onClose, onReply, onForward }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const media = m.kind === 'photo' || m.kind === 'video';
  const isPlace = m.kind === 'place';
  const what = m.kind === 'photo' ? '사진을' : m.kind === 'video' ? '영상을' : isPlace ? '장소를' : '메시지를';
  const copyText = isPlace ? (() => { const p = placeInfo(m); return p.road || p.addr || `${p.lat}, ${p.lng}`; })() : m.body;
  async function run(label, fn) {
    setErr(''); setBusy(label);
    try { await fn(); onClose(); } catch (e) { setErr(e.message || '하지 못했어요.'); } finally { setBusy(''); }
  }
  const myReaction = (m.reactions || []).find(([u]) => u === state.me.id)?.[1];
  const gone = media && mediaInfo(m).gone;
  const backdrop = useBackdrop(onClose);
  return html`
    <div class="sheet-bg with-preview" onClick=${backdrop}>
      <${MenuPreview} m=${m} mine=${mine} style=${bubble} name=${name} />
      <div class="sheet action-sheet" role="menu">
        <div class="react-pick">
          ${REACTIONS.map((e) => html`<button class=${e === myReaction ? 'on' : ''} onClick=${() => run('react', () => react(m, e))} aria-label=${'반응 ' + e}>${e}</button>`)}
        </div>
        ${err && html`<p class="err">${err}</p>`}
        <div class="action-grid">
        <button onClick=${onReply}>답장</button>
        ${!media && html`<button onClick=${() => run('copy', () => navigator.clipboard.writeText(copyText))}>${isPlace ? '주소 복사' : '복사'}</button>`}
        ${!gone && html`<button onClick=${onForward}>전달</button>`}
        ${m.kind === 'text' && html`<button onClick=${() => run('notice', () => setNotice(m.room_id, isNotice ? 0 : m.id))} disabled=${!!busy}>${isNotice ? '공지 내리기' : '공지로 올리기'}</button>`}
        ${media && !gone && html`<button onClick=${() => run('save', () => saveMedia(m))} disabled=${!!busy}>${busy === 'save' ? '받는 중…' : '저장'}</button>`}
        <button class="danger" onClick=${() => confirm(`이 ${what} 내 화면에서 지울까요?\n(다른 사람에게는 그대로 보여요)`) && run('hide', () => hideMessage(m.id))} disabled=${!!busy}>삭제</button>
        ${mine && html`<button class="danger" onClick=${() => confirm(`이 ${what} 모두에게서 지울까요?\n되돌릴 수 없어요.`) && run('all', () => deleteForAll(m))} disabled=${!!busy}>${busy === 'all' ? '지우는 중…' : '모두에게 삭제'}</button>`}
        </div>
        <button class="cancel" onClick=${onClose}>취소</button>
      </div>
    </div>`;
}
