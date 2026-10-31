// 사진 묶음·크게 보기·채팅방 사진 모아보기·전달
//  - 묶음(여러 장을 한 메시지로)은 채팅에서 콜라주 + 오른쪽 아래 장수, 누르면 좌우로 넘겨 봄 (위에 현재장/총장수)
//  - 채팅방 사진 보기: 이 방 사진 전체를 격자로, 눌러 크게·좌우로
//  - 길게 누르면 전달·저장. 전달은 같은 그룹의 채팅방·친구에게만 (서버도 막음)
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Avatar, time, dateLine } from './html.js';
import { state, roomTitle, sortedRooms, forward, roomPhotos, isHidden, person, photoOf } from './store.js';
import { mediaUrl, mediaItems, saveMedia } from './media.js';
import { nickOf } from './names.js';
import { PlaceCard, placeInfo } from './place.js';

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
//  원래 크기에서 위나 아래로 밀면 반대쪽에 ✕ 가 나타나고, 더 밀어서 놓으면 닫힘 (확대 중에는 끌면 사진이 옮겨지므로 안 됨)
export function MediaViewer({ items, start = 0, names, onClose }) {
  const [i, setI] = useState(Math.min(start, Math.max(0, items.length - 1)));
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);  // 위(-)·아래(+)로 민 거리
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
  const closeAt = () => Math.min(160, (stage.current?.clientHeight || innerHeight) * 0.22);   // 이만큼 위·아래로 밀면 닫힘
  const down = (e) => { dragged.current = false; if (!anim && e.isPrimary) drag.current = { x: e.clientX, y: e.clientY, moved: false, dir: '' }; };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const x = e.clientX - d.x, y = e.clientY - d.y;
    if (!d.moved) {
      if (n > 1 && Math.abs(x) > 10 && Math.abs(x) > Math.abs(y)) d.dir = 'x';
      else if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) d.dir = 'y';
      else return;
      d.moved = dragged.current = true;
    }
    // 처음·끝에서는 덜 따라오게
    if (d.dir === 'x') setDx((i === 0 && x > 0) || (i === n - 1 && x < 0) ? x / 3 : x);
    else {
      if ((Math.abs(dy) >= closeAt()) !== (Math.abs(y) >= closeAt())) navigator.vibrate?.(10);
      setDy(y);
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    if (d.dir === 'y') {
      if (Math.abs(dy) >= closeAt()) { onClose(); return; }
      setAnim(true); setDy(0); setTimeout(() => setAnim(false), 200);
      return;
    }
    const w = stage.current?.clientWidth || innerWidth;
    if (dx < -Math.min(80, w / 5)) go(1); else if (dx > Math.min(80, w / 5)) go(-1); else go(0);
  };
  // 사진을 두 손가락으로 잡거나 확대한 채 끌면 넘기기는 그만
  const grab = () => { if (drag.current) { drag.current = null; setDx(0); setDy(0); } };
  const slide = (k) => {
    const it = items[k];
    if (!it) return null;
    return html`
      <div class="slide" key=${it.key + ':' + it.m.id} style=${{ left: (k - i) * 100 + '%' }}>
        ${it.kind === 'video'
          ? html`<video src=${mediaUrl(it.key)} poster=${it.thumb ? mediaUrl(it.key, true) : undefined} controls autoplay=${k === i} playsinline></video>`
          : html`<${Slide} it=${it} active=${k === i} onGrab=${grab} onMenu=${() => !dragged.current && setMenu(it)} onTap=${() => !dragged.current && onClose()} />`}
      </div>`;
  };
  // 메뉴·전달은 크게 보기 바깥에 (안에 두면 .viewer 의 흰 글씨·사진 모양이 시트에도 먹어 안내 글이 안 보였음)
  return html`
    <div class="viewer" role="dialog" aria-label="크게 보기">
      <div class="viewer-top">
        ${n > 1 ? html`<span class="viewer-count">${i + 1} / ${n}</span>` : html`<span></span>`}
        <button class="viewer-close" onClick=${onClose} aria-label="닫기">✕</button>
      </div>
      <div class="viewer-stage" ref=${stage} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
        onClick=${(e) => e.target === e.currentTarget && onClose()}>
        <div class=${'viewer-track' + (anim ? ' anim' : '')} style=${{ transform: `translate(${dx}px, ${dy}px)` }}>
          ${slide(i - 1)}${slide(i)}${slide(i + 1)}
        </div>
        ${dy !== 0 && html`<span class=${'viewer-pull' + (dy > 0 ? ' top' : '') + (Math.abs(dy) >= closeAt() ? ' ready' : '')} style=${{ opacity: Math.min(1, Math.abs(dy) / closeAt()) }} aria-hidden="true">✕</span>`}
        ${n > 1 && i > 0 && html`<button class="viewer-nav prev" onClick=${() => go(-1)} aria-label="이전 사진">‹</button>`}
        ${n > 1 && i < n - 1 && html`<button class="viewer-nav next" onClick=${() => go(1)} aria-label="다음 사진">›</button>`}
      </div>
      <p>${names.get(cur.m.user_id) || ''} · ${dateLine(cur.m.at)} ${time(cur.m.at)}</p>
    </div>
    ${menu && html`<${ItemMenu} it=${menu} onClose=${() => setMenu(null)} onForward=${() => { setFwd(menu); setMenu(null); }} />`}
    ${fwd && html`<${ForwardSheet} m=${fwd.m} index=${mediaItems(fwd.m).length > 1 ? fwd.i : null} onClose=${() => setFwd(null)} />`}`;
}

// 크게 본 사진 한 장: 두 손가락으로 벌리고 오므려 확대·축소(1~5배), 확대한 채 한 손가락으로 끌어 옮김,
// 두 번 누르면 2.5배 ↔ 원래대로, 컴퓨터는 휠. 확대 중에는 좌우 넘기기 대신 옮기기 (onGrab 으로 넘기기를 멈춤)
const MAX_ZOOM = 5;
function Slide({ it, active, onGrab, onMenu, onTap }) {
  const img = useRef(null);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const zr = useRef(z); zr.current = z;
  const pts = useRef(new Map());
  const g = useRef(null);         // 지금 하는 손짓 { s, x, y, a, b?, d? }
  const lastTap = useRef(0), tapT = useRef(0);
  const [anim, setAnim] = useState(false);
  const moved = useRef(false);    // 확대·옮기기를 한 손짓은 누르기로 치지 않음
  const press = useLongPress(onMenu, () => {
    // 한 번 누르면 닫기(확대 중이면 그대로), 두 번 누르면 확대·되돌리기
    if (moved.current) return;
    const now = Date.now();
    if (now - lastTap.current < 300) { clearTimeout(tapT.current); lastTap.current = 0; toggle(); return; }
    lastTap.current = now;
    if (zr.current.s === 1) tapT.current = setTimeout(onTap, 300);
  });
  useEffect(() => { if (!active) { setZ({ s: 1, x: 0, y: 0 }); pts.current.clear(); g.current = null; } }, [active]);
  useEffect(() => () => clearTimeout(tapT.current), []);

  // 사진 가운데 기준 화면 위치 → 확대·옮김 맞추기 (사진이 화면 밖으로 다 나가지 않게)
  const fit = (s, x, y) => {
    const el = img.current, box = el?.parentElement;
    if (!el || !box) return { s, x, y };
    s = Math.min(MAX_ZOOM, Math.max(1, s));
    const mx = Math.max(0, (el.offsetWidth * s - box.clientWidth) / 2), my = Math.max(0, (el.offsetHeight * s - box.clientHeight) / 2);
    return { s, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };
  // 화면의 점 (cx, cy) 를 제자리에 둔 채 배율을 s 로
  const zoomAt = (s, cx, cy, from) => {
    const r = img.current.parentElement.getBoundingClientRect();
    const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
    const k = Math.min(MAX_ZOOM, Math.max(1, s)) / from.s;
    return fit(s, ox - (ox - from.x) * k, oy - (oy - from.y) * k);
  };
  const ease = (v) => { setAnim(true); setZ(v); setTimeout(() => setAnim(false), 200); };
  function toggle() {
    const r = img.current?.getBoundingClientRect();
    if (!r) return;
    ease(zr.current.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(2.5, lastXY.current[0], lastXY.current[1], zr.current));
  }
  const lastXY = useRef([0, 0]);
  const begin = () => {
    const p = [...pts.current.values()];
    const v = zr.current;
    g.current = p.length >= 2 ? { ...v, a: p[0], b: p[1], d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1 }
      : p.length === 1 && v.s > 1 ? { ...v, a: p[0] } : null;
  };
  function down(e) {
    lastXY.current = [e.clientX, e.clientY];
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.current.size === 1) { moved.current = false; press.onPointerDown(e); } else { moved.current = true; press.onPointerCancel(); }
    begin();
    if (g.current) { e.stopPropagation(); onGrab(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 무시 */ } }
  }
  function move(e) {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    press.onPointerMove(e);
    if (Math.hypot(e.clientX - lastXY.current[0], e.clientY - lastXY.current[1]) > 10) moved.current = true;
    const s0 = g.current;
    if (!s0) return;
    e.stopPropagation();
    const p = [...pts.current.values()];
    if (s0.b && p.length >= 2) {
      const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
      const m0 = [(s0.a[0] + s0.b[0]) / 2, (s0.a[1] + s0.b[1]) / 2], m = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
      const v = zoomAt(s0.s * d / s0.d, m0[0], m0[1], s0);
      setZ(fit(v.s, v.x + m[0] - m0[0], v.y + m[1] - m0[1]));
    } else if (!s0.b) {
      setZ(fit(s0.s, s0.x + p[0][0] - s0.a[0], s0.y + p[0][1] - s0.a[1]));
    }
  }
  function up(e) {
    if (!pts.current.delete(e.pointerId)) return;
    if (e.type === 'pointercancel') press.onPointerCancel(); else press.onPointerUp();
    if (g.current) e.stopPropagation();
    if (zr.current.s < 1.05) { if (zr.current.s !== 1) ease({ s: 1, x: 0, y: 0 }); }
    begin();
  }
  function wheel(e) {
    e.preventDefault();
    setZ(zoomAt(zr.current.s * Math.exp(-e.deltaY / 300), e.clientX, e.clientY, zr.current));
  }
  return html`<img ref=${img} src=${mediaUrl(it.key)} alt="" draggable="false" class=${anim ? 'zooming' : ''}
    style=${z.s === 1 && !anim ? undefined : { transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }}
    onContextMenu=${press.onContextMenu} onClick=${press.onClick} onPointerLeave=${press.onPointerLeave}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel} />`;
}

// 길게 누른 것을 메뉴 위 빈 곳에 같이 보여 줌 (무엇을 누른 건지 알게). 누르면 뒤 어두운 곳을 누른 것과 같음
//  item: 사진 한 장만 (모아보기), 없으면 메시지 그대로 (묶음은 콜라주)
//  다른 사람이 보낸 것이면 채팅처럼 왼쪽에 프로필 사진, 위에 대화명
export function MenuPreview({ m, item, mine, style, name }) {
  const media = m.kind === 'photo' || m.kind === 'video';
  let body;
  if (item) body = html`<img class="pv-media" src=${mediaUrl(item.key)} alt="" />`;
  else if (m.kind === 'place') body = html`<${PlaceCard} p=${placeInfo(m)} m=${m} />`;
  else if (!media) body = html`<div class="bubble" style=${style}>${m.body}</div>`;
  else {
    const items = viewItems(m);
    if (!items.length) body = html`<div class="bubble gone">${m.kind === 'photo' ? '🖼️' : '🎬'} 보관 기간이 지나 지워졌어요</div>`;
    else if (items.length > 1) body = html`<${Collage} m=${m} press=${{}} />`;
    else {
      const it = items[0];
      body = m.kind === 'photo' ? html`<img class="pv-media" src=${mediaUrl(it.key)} alt="" />`
        : html`<span class="pv-video">${it.thumb ? html`<img class="pv-media" src=${mediaUrl(it.key, true)} alt="" />` : html`<span class="media-blank"></span>`}<span class="play">▶</span></span>`;
    }
  }
  if (mine) return html`<div class="menu-preview msg mine">${body}</div>`;
  const p = person(m.user_id);
  const nick = name || nickOf(p) || '나간 사람';
  return html`
    <div class="menu-preview msg theirs first">
      <div class="pv-row">
        <${Avatar} name=${nick} id=${m.user_id} photo=${photoOf(p)} size=${54} />
        <div class="pv-col"><div class="who">${nick}</div>${body}</div>
      </div>
    </div>`;
}

// 사진 한 장 메뉴 (크게 보기·모아보기에서 길게 누름): 전달·저장
function ItemMenu({ it, preview, names, onClose, onForward }) {
  const backdrop = useBackdrop(onClose);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try { await saveMedia(it.m, it.i); onClose(); } catch (e) { setErr(e.message || '저장하지 못했어요.'); } finally { setBusy(false); }
  }
  return html`
    <div class=${'sheet-bg top' + (preview ? ' with-preview' : '')} onClick=${backdrop}>
      ${preview && html`<${MenuPreview} m=${it.m} item=${it} mine=${it.m.user_id === state.me.id} name=${names?.get(it.m.user_id)} />`}
      <div class="sheet action-sheet" role="menu">
        ${err && html`<p class="err">${err}</p>`}
        <div class="action-grid">
          <button onClick=${onForward}>전달</button>
          <button onClick=${save} disabled=${busy}>${busy ? '받는 중…' : '저장'}</button>
        </div>
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
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="뒤로">‹</button>
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
      ${menu && html`<${ItemMenu} it=${menu} preview names=${names} onClose=${() => setMenu(null)} onForward=${() => { setFwd(menu); setMenu(null); }} />`}
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

// 전달: 이 메시지가 있는 방과 같은 그룹의 채팅방·친구 (여러 곳 골라 한 번에)
//  사진·영상은 내가 속한 다른 그룹의 방·친구에게도 (그룹이 여럿이면 그룹 이름을 같이 보임)
export function ForwardSheet({ m, index = null, onClose }) {
  const src = state.rooms[m.room_id];
  const gid = src?.group_id;
  const group = state.groups.find((g) => g.id === gid);
  const anyGroup = (m.kind === 'photo' || m.kind === 'video') && state.groups.length > 1;
  const groupName = (id) => state.groups.find((g) => g.id === id)?.name || '';
  const rooms = sortedRooms().filter((r) => anyGroup || r.group_id === gid);
  const friends = [];
  for (const g of anyGroup ? [group, ...state.groups.filter((x) => x.id !== gid)] : [group]) {
    for (const p of g?.members || []) {
      if (p.id === state.me.id || p.bot) continue;
      const seen = friends.find((x) => x.p.id === p.id);
      if (seen) seen.groups.push(g.name); else friends.push({ p, groups: [g.name] });
    }
  }
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
  const what = m.kind === 'photo' ? (index === null && mediaItems(m).length > 1 ? `사진 ${viewItems(m).length}장` : '사진') : m.kind === 'video' ? '동영상' : m.kind === 'place' ? '장소' : '메시지';
  return html`
    <div class="sheet-bg top" onClick=${backdrop}>
      <div class="sheet forward-sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button><h2 class="ellipsis">${what} 전달</h2></header>
        <div class="scroll">
          <p class="hint pad">${anyGroup ? '내가 속한 모든 그룹에 전달할 수 있어요.' : group ? `${group.name} 그룹 안에서만 전달할 수 있어요.` : '같은 그룹 안에서만 전달할 수 있어요.'}</p>
          ${err && html`<p class="err pad">${err}</p>`}
          <div class="section"><h3>채팅방</h3></div>
          ${rooms.map((r) => html`
            <label class="person check" key=${'r' + r.id}><input type="checkbox" checked=${pickRooms.includes(r.id)} onChange=${() => flip(pickRooms, setPickRooms, r.id)} />
              ${roomFace(r)}
              <span class="grow ellipsis">${roomTitle(r)}${r.id === m.room_id ? html` <span class="hint">(지금 방)</span>` : anyGroup ? html` <span class="hint">· ${groupName(r.group_id)}</span>` : ''}</span></label>`)}
          <div class="section"><h3>친구</h3></div>
          ${friends.length ? friends.map(({ p, groups }) => html`
            <label class="person check" key=${'u' + p.id}><input type="checkbox" checked=${pickUsers.includes(p.id)} onChange=${() => flip(pickUsers, setPickUsers, p.id)} />
              <${Avatar} name=${nickOf(p)} id=${p.id} photo=${p.photo} size=${52} /><span class="grow ellipsis">${nickOf(p)}${anyGroup ? html` <span class="hint">· ${groups.join(', ')}</span>` : ''}</span></label>`)
            : html`<p class="hint pad">같은 그룹에 친구가 없어요.</p>`}
        </div>
        <div class="section inline forward-go">
          ${done ? html`<span class="ok grow">전달했어요.</span>` : html`<span class="grow hint">${count ? `${count}곳 골랐어요` : '보낼 곳을 골라 주세요'}</span>`}
          <button class="primary" disabled=${!count || busy || done} onClick=${send}>${busy ? '보내는 중…' : '전달'}</button>
        </div>
      </div>
    </div>`;
}
