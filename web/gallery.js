// 사진 묶음·크게 보기·채팅방 사진 모아보기·전달
//  - 묶음(여러 장을 한 메시지로)은 채팅에서 콜라주 + 오른쪽 아래 장수, 누르면 좌우로 넘겨 봄 (위에 현재장/총장수)
//  - 채팅방 사진 보기: 이 방 사진 전체를 격자로, 눌러 크게·좌우로
//  - 길게 누르면 전달·저장. 전달은 같은 그룹의 채팅방·친구에게만 (서버도 막음)
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Avatar, time, dateLine } from './html.js';
import { state, roomTitle, sortedRooms, forward, roomPhotos, isHidden } from './store.js';
import { mediaUrl, mediaItems, saveMedia } from './media.js';
import { nickOf } from './names.js';

// 길게 누르기(0.5초): 손가락을 떼기 전에 메뉴. 그냥 누르면 onTap. 움직이면(스크롤·넘기기) 취소
export function useLongPress(onLong, onTap) {
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

// 메뉴 뒤 어두운 곳을 누르면 닫기. 단, 연 직후 0.5초는 무시 (길게 눌러 연 손가락을 떼면 그 자리에 '누르기'가 와서 바로 닫히는 휴대폰이 있음)
export function useBackdrop(onClose) {
  const at = useRef(Date.now());
  return (e) => { if (e.target === e.currentTarget && Date.now() - at.current > 500) onClose(); };
}

// 크게 볼 목록: 메시지의 남아 있는 파일마다 { m, i(묶음 안 번호), key, kind, thumb }
export function viewItems(m) {
  return mediaItems(m).map((it, i) => ({ m, i, key: it.key, kind: m.kind, thumb: it.thumb, gone: it.gone })).filter((x) => !x.gone);
}

// 묶음 콜라주: 2장은 나란히, 3장은 큰 것 하나 + 작은 것 둘, 4장부터는 2×2. 오른쪽 아래에 장수
//  보내는 중이면 휴대폰의 사진(locals)으로
export function Collage({ m, press }) {
  const srcs = m.pending ? m.locals || [] : viewItems(m).map((x) => mediaUrl(x.key));
  const n = srcs.length;
  const shown = srcs.slice(0, 4);
  return html`
    <button class=${'media album n' + Math.min(n, 4)} ...${press} aria-label=${`사진 ${n}장 크게 보기`}>
      ${shown.map((src, i) => html`<span class="tile" key=${i}><img src=${src} alt="" loading="lazy" /></span>`)}
      <span class="count">${STACK_ICON}${n}</span>
      ${m.pending && !m.failed && html`<span class="media-progress"><span>${m.stage}${m.stage === '기다리는 중' ? '' : ` ${Math.round((m.progress || 0) * 100)}%`}</span><i style=${{ width: Math.round((m.progress || 0) * 100) + '%' }}></i></span>`}
      ${m.failed && html`<span class="media-progress err-box"><span>${m.error || '보내지 못했어요'}</span></span>`}
    </button>`;
}
const STACK_ICON = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="7" y="3" width="14" height="14" rx="2" /><path d="M17 21H5a2 2 0 0 1-2-2V7" /></svg>`;

// 크게 보기: 좌우로 밀어서 넘김 (컴퓨터는 ‹ › 단추·화살표 키), 위에 현재장/총장수, 길게 누르면 전달·저장
export function MediaViewer({ items, start = 0, names, onClose }) {
  const [i, setI] = useState(Math.min(start, Math.max(0, items.length - 1)));
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const [menu, setMenu] = useState(null);
  const [fwd, setFwd] = useState(null);
  const drag = useRef(null);
  const dragged = useRef(false);   // 넘기려고 민 것은 누르기(닫기)로 치지 않음
  const stage = useRef(null);
  const n = items.length;
  const go = (d) => {
    if (anim || i + d < 0 || i + d >= n) { setAnim(true); setDx(0); setTimeout(() => setAnim(false), 200); return; }
    const w = stage.current?.clientWidth || innerWidth;
    setAnim(true); setDx(-d * w);
    setTimeout(() => { setAnim(false); setDx(0); setI(i + d); }, 200);
  };
  useEffect(() => {
    const key = (e) => {
      if (menu || fwd) return;
      if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1); else if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });
  if (!n) return null;
  const cur = items[i];
  const down = (e) => { dragged.current = false; if (!anim && n > 1) drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const x = e.clientX - d.x;
    if (!d.moved && Math.abs(x) > 10 && Math.abs(x) > Math.abs(e.clientY - d.y)) d.moved = dragged.current = true;
    // 처음·끝에서는 덜 따라오게
    if (d.moved) setDx((i === 0 && x > 0) || (i === n - 1 && x < 0) ? x / 3 : x);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const w = stage.current?.clientWidth || innerWidth;
    if (dx < -Math.min(80, w / 5)) go(1); else if (dx > Math.min(80, w / 5)) go(-1); else go(0);
  };
  const slide = (k) => {
    const it = items[k];
    if (!it) return null;
    return html`
      <div class="slide" key=${it.key + ':' + it.m.id} style=${{ left: (k - i) * 100 + '%' }}>
        ${it.kind === 'video'
          ? html`<video src=${mediaUrl(it.key)} poster=${it.thumb ? mediaUrl(it.key, true) : undefined} controls autoplay=${k === i} playsinline></video>`
          : html`<${Slide} it=${it} onMenu=${() => !dragged.current && setMenu(it)} onTap=${() => !dragged.current && onClose()} />`}
      </div>`;
  };
  return html`
    <div class="viewer" role="dialog" aria-label="크게 보기">
      <div class="viewer-top">
        ${n > 1 ? html`<span class="viewer-count">${i + 1} / ${n}</span>` : html`<span></span>`}
        <button class="viewer-close" onClick=${onClose} aria-label="닫기">✕</button>
      </div>
      <div class="viewer-stage" ref=${stage} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
        onClick=${(e) => e.target === e.currentTarget && onClose()}>
        <div class=${'viewer-track' + (anim ? ' anim' : '')} style=${{ transform: `translateX(${dx}px)` }}>
          ${slide(i - 1)}${slide(i)}${slide(i + 1)}
        </div>
        ${n > 1 && i > 0 && html`<button class="viewer-nav prev" onClick=${() => go(-1)} aria-label="이전 사진">‹</button>`}
        ${n > 1 && i < n - 1 && html`<button class="viewer-nav next" onClick=${() => go(1)} aria-label="다음 사진">›</button>`}
      </div>
      <p>${names.get(cur.m.user_id) || ''} · ${dateLine(cur.m.at)} ${time(cur.m.at)}</p>
      ${menu && html`<${ItemMenu} it=${menu} onClose=${() => setMenu(null)} onForward=${() => { setFwd(menu); setMenu(null); }} />`}
      ${fwd && html`<${ForwardSheet} m=${fwd.m} index=${mediaItems(fwd.m).length > 1 ? fwd.i : null} onClose=${() => setFwd(null)} />`}
    </div>`;
}

function Slide({ it, onMenu, onTap }) {
  const press = useLongPress(onMenu, onTap);
  return html`<img src=${mediaUrl(it.key)} alt="" draggable="false" ...${press} />`;
}

// 사진 한 장 메뉴 (크게 보기·모아보기에서 길게 누름): 전달·저장
function ItemMenu({ it, onClose, onForward }) {
  const backdrop = useBackdrop(onClose);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try { await saveMedia(it.m, it.i); onClose(); } catch (e) { setErr(e.message || '저장하지 못했어요.'); } finally { setBusy(false); }
  }
  return html`
    <div class="sheet-bg top" onClick=${backdrop}>
      <div class="sheet action-sheet" role="menu">
        ${err && html`<p class="err">${err}</p>`}
        <button onClick=${onForward}>전달</button>
        <button onClick=${save} disabled=${busy}>${busy ? '받는 중…' : '저장'}</button>
        <button class="cancel" onClick=${onClose}>취소</button>
      </div>
    </div>`;
}

// 채팅방 사진 보기: 이 방에 남아 있는 사진 전부를 격자로 (최근 것부터). 누르면 크게, 길게 누르면 전달·저장
export function Gallery({ room, names, onClose }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [big, setBig] = useState(null);
  const [menu, setMenu] = useState(null);
  const [fwd, setFwd] = useState(null);
  useEffect(() => {
    roomPhotos(room.id).then((list) => setItems(list.filter((m) => !isHidden(m.id)).flatMap(viewItems))).catch((e) => setErr(e.message));
  }, [room.id]);
  return html`
    <div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button>
          <h2 class="ellipsis">채팅방 사진${items?.length ? html` <span class="hint">${items.length}</span>` : ''}</h2></header>
        <div class="scroll">
          ${err && html`<p class="err pad">${err}</p>`}
          ${!items && !err && html`<p class="hint center">불러오는 중…</p>`}
          ${items && !items.length && html`<p class="empty">보관 중인 사진이 없어요.<br />사진은 보관 기간이 지나면 지워져요.</p>`}
          ${items?.length > 0 && html`
            <div class="photo-grid">
              ${items.map((it, k) => html`<${GridCell} key=${it.key + ':' + it.m.id} it=${it} onOpen=${() => setBig(k)} onMenu=${() => setMenu(it)} />`)}
            </div>`}
        </div>
      </div>
      ${big !== null && html`<${MediaViewer} items=${items} start=${big} names=${names} onClose=${() => setBig(null)} />`}
      ${menu && html`<${ItemMenu} it=${menu} onClose=${() => setMenu(null)} onForward=${() => { setFwd(menu); setMenu(null); }} />`}
      ${fwd && html`<${ForwardSheet} m=${fwd.m} index=${mediaItems(fwd.m).length > 1 ? fwd.i : null} onClose=${() => setFwd(null)} />`}
    </div>`;
}

function GridCell({ it, onOpen, onMenu }) {
  const press = useLongPress(onMenu, onOpen);
  const [broken, setBroken] = useState(false);
  return html`<button class="cell" ...${press} aria-label="사진 크게 보기">
    ${broken ? html`<span class="media-blank"></span>` : html`<img src=${mediaUrl(it.key)} alt="" loading="lazy" onError=${() => setBroken(true)} />`}</button>`;
}

// 방 얼굴: 방 사진, 없으면 1:1 상대, 여럿이면 사람 수 (대화 목록과 같게)
function roomFace(r) {
  const other = r.kind === 'dm' ? r.members.find((p) => p.id !== state.me.id) : null;
  return r.photo ? html`<${Avatar} photo=${r.photo} size=${52} />` : other ? html`<${Avatar} name=${nickOf(other)} id=${other.id} photo=${other.photo} size=${52} />`
    : html`<span class="avatar multi" style="width:52px;height:52px">${r.members.length}</span>`;
}

// 전달: 이 메시지가 있는 방과 같은 그룹의 채팅방·친구만 보임 (여러 곳 골라 한 번에)
export function ForwardSheet({ m, index = null, onClose }) {
  const src = state.rooms[m.room_id];
  const gid = src?.group_id;
  const group = state.groups.find((g) => g.id === gid);
  const rooms = sortedRooms().filter((r) => r.group_id === gid);
  const friends = (group?.members || []).filter((p) => p.id !== state.me.id && !p.bot);
  const [pickRooms, setPickRooms] = useState([]);
  const [pickUsers, setPickUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const backdrop = useBackdrop(onClose);
  const flip = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const count = pickRooms.length + pickUsers.length;
  async function send() {
    setBusy(true); setErr('');
    try { await forward(m, index, pickRooms, pickUsers); setDone(true); setTimeout(onClose, 900); } catch (e) { setErr(e.message || '전달하지 못했어요.'); } finally { setBusy(false); }
  }
  const what = m.kind === 'photo' ? (index === null && mediaItems(m).length > 1 ? `사진 ${viewItems(m).length}장` : '사진') : m.kind === 'video' ? '동영상' : '메시지';
  return html`
    <div class="sheet-bg top" onClick=${backdrop}>
      <div class="sheet forward-sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button><h2 class="ellipsis">${what} 전달</h2></header>
        <div class="scroll">
          <p class="hint pad">${group ? `${group.name} 그룹 안에서만 전달할 수 있어요.` : '같은 그룹 안에서만 전달할 수 있어요.'}</p>
          ${err && html`<p class="err pad">${err}</p>`}
          <div class="section"><h3>채팅방</h3></div>
          ${rooms.map((r) => html`
            <label class="person check" key=${'r' + r.id}><input type="checkbox" checked=${pickRooms.includes(r.id)} onChange=${() => flip(pickRooms, setPickRooms, r.id)} />
              ${roomFace(r)}
              <span class="grow ellipsis">${roomTitle(r)}${r.id === m.room_id ? html` <span class="hint">(지금 방)</span>` : ''}</span></label>`)}
          <div class="section"><h3>친구</h3></div>
          ${friends.length ? friends.map((p) => html`
            <label class="person check" key=${'u' + p.id}><input type="checkbox" checked=${pickUsers.includes(p.id)} onChange=${() => flip(pickUsers, setPickUsers, p.id)} />
              <${Avatar} name=${nickOf(p)} id=${p.id} photo=${p.photo} size=${52} /><span class="grow ellipsis">${nickOf(p)}</span></label>`)
            : html`<p class="hint pad">같은 그룹에 친구가 없어요.</p>`}
        </div>
        <div class="section inline forward-go">
          ${done ? html`<span class="ok grow">전달했어요.</span>` : html`<span class="grow hint">${count ? `${count}곳 골랐어요` : '보낼 곳을 골라 주세요'}</span>`}
          <button class="primary" disabled=${!count || busy || done} onClick=${send}>${busy ? '보내는 중…' : '전달'}</button>
        </div>
      </div>
    </div>`;
}
