// 화면 조각을 만드는 태그 문자열 (JSX 대신, 빌드 설정 없이)
import { h } from 'preact';
import htm from 'htm';
import { useState, useRef, useEffect } from 'preact/hooks';

export const html = htm.bind(h);

const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const shortFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' });

// 서버 시각은 UTC ("…T…Z"). 예전에 기기에 저장된 "2026-10-18 06:57:46Z" 모양도 같이 읽는다
const toDate = (iso) => new Date(typeof iso === 'string' ? iso.replace(' ', 'T') : iso);
export const time = (iso) => timeFmt.format(toDate(iso));
export const dateLine = (iso) => dateFmt.format(toDate(iso));
export const dayKey = (iso) => toDate(iso).toDateString();

// 채팅 목록의 시각: 오늘이면 시각, 어제면 "어제", 그 전이면 날짜
export function listTime(iso) {
  if (!iso) return '';
  const d = toDate(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return timeFmt.format(d);
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '어제';
  return shortFmt.format(d);
}

// 얼굴: 프로필 사진이 있으면 사진, 없으면 이름 첫 글자
const COLORS = ['#f48fb1', '#ce93d8', '#9fa8da', '#80cbc4', '#ffcc80', '#a5d6a7', '#90caf9', '#ffab91'];
export const photoUrl = (key) => new URL('./api.php/photo/' + key, location.href).href;
export function Avatar({ name, id, photo, size = 60 }) {
  if (photo) return html`<img class="avatar" src=${photoUrl(photo)} alt="" width=${size} height=${size} style=${{ width: size + 'px', height: size + 'px' }} />`;
  const c = COLORS[Math.abs(id || 0) % COLORS.length];
  return html`<span class="avatar" style=${{ width: size + 'px', height: size + 'px', background: c, fontSize: Math.round(size * 0.42) + 'px' }}>${(name || '?').slice(0, 1)}</span>`;
}

// 사진 파일 열기 (PhotoCrop 에 넘김, 주소는 PhotoCrop 이 닫힐 때 푼다)
export function openImage(file) {
  const url = URL.createObjectURL(file);
  return new Promise((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => { URL.revokeObjectURL(url); no(new Error('사진을 열지 못했어요.')); };
    i.src = url;
  });
}

// 고른 사진 맞추기: 끌어서 옮기고 두 손가락(또는 아래 막대)으로 확대·축소 → 확인하면 size px 정사각형 JPEG(base64)로 onOk
// 가장 작게는 사진 가로가 칸에 꼭 맞을 때 (좌우 빈칸 없음, 가로 사진이면 위아래가 검은 띠)
const BOX = 240;
export function PhotoCrop({ img, size, title, busy, onCancel, onOk }) {
  const w = img.naturalWidth, hgt = img.naturalHeight;
  const min = BOX / w, cover = Math.max(BOX / w, BOX / hgt), max = cover * 4;
  const place = (s, x, y) => {
    s = Math.min(max, Math.max(min, s));
    const dw = w * s, dh = hgt * s;
    x = Math.min(0, Math.max(BOX - dw, x));
    y = dh >= BOX ? Math.min(0, Math.max(BOX - dh, y)) : (BOX - dh) / 2;
    return { s, x, y };
  };
  const [v, setV] = useState(() => place(cover, (BOX - w * cover) / 2, (BOX - hgt * cover) / 2));
  const cur = useRef(v); cur.current = v;
  const pts = useRef(new Map());
  const start = useRef(null);
  useEffect(() => () => URL.revokeObjectURL(img.src), [img]);

  // 화면 위 점(칸 기준)을 그대로 둔 채 배율을 s 로
  const zoomAt = (s, cx, cy, from = cur.current) => {
    const ix = (cx - from.x) / from.s, iy = (cy - from.y) / from.s;
    return place(s, cx - ix * s, cy - iy * s);
  };
  const local = (e) => { const r = e.currentTarget.getBoundingClientRect(); return [(e.clientX - r.left) * BOX / r.width, (e.clientY - r.top) * BOX / r.height]; };
  const begin = () => {
    const p = [...pts.current.values()];
    if (p.length === 1) start.current = { v: cur.current, a: p[0] };
    else if (p.length >= 2) start.current = { v: cur.current, a: p[0], b: p[1], d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1 };
  };
  function down(e) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} pts.current.set(e.pointerId, local(e)); begin(); }
  function move(e) {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, local(e));
    const p = [...pts.current.values()], st = start.current;
    if (!st) return;
    if (p.length === 1) setV(place(st.v.s, st.v.x + p[0][0] - st.a[0], st.v.y + p[0][1] - st.a[1]));
    else if (st.b) {
      const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
      const m0 = [(st.a[0] + st.b[0]) / 2, (st.a[1] + st.b[1]) / 2], m = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
      // 두 손가락 가운데 점이 붙잡은 곳을 따라가게
      const ix = (m0[0] - st.v.x) / st.v.s, iy = (m0[1] - st.v.y) / st.v.s, s = st.v.s * d / st.d;
      setV(place(s, m[0] - ix * s, m[1] - iy * s));
    }
  }
  function up(e) { pts.current.delete(e.pointerId); begin(); }
  function wheel(e) { e.preventDefault(); const [cx, cy] = local(e); setV(zoomAt(cur.current.s * Math.exp(-e.deltaY / 400), cx, cy)); }
  // 막대: 0 = 가장 작게, 100 = 가장 크게 (배율은 곱으로 고르게)
  const ratio = Math.log(v.s / min) / Math.log(max / min) * 100;
  const slide = (e) => setV(zoomAt(min * Math.pow(max / min, e.target.value / 100), BOX / 2, BOX / 2));

  function ok() {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), k = size / BOX;
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    g.drawImage(img, v.x * k, v.y * k, w * v.s * k, hgt * v.s * k);
    const data = c.toDataURL('image/jpeg', 0.85);
    onOk(data.slice(data.indexOf(',') + 1));
  }

  return html`
    <div class="sheet-bg center-bg" onClick=${(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div class="photo-confirm" role="dialog" aria-label=${title}>
        <p class="pc-title">${title}</p>
        <div class="crop-box" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel}>
          <img src=${img.src} alt="" draggable="false" style=${{ width: w * v.s + 'px', height: hgt * v.s + 'px', transform: `translate(${v.x}px, ${v.y}px)` }} />
        </div>
        <input class="crop-zoom" type="range" min="0" max="100" step="any" value=${ratio} onInput=${slide} aria-label="확대·축소" />
        <p class="hint">끌어서 옮기고, 두 손가락으로 벌리거나 모아 크기를 바꿔요.</p>
        <div class="pc-btns">
          <button class="pc-cancel" onClick=${onCancel} disabled=${busy}>취소</button>
          <button class="pc-ok" onClick=${ok} disabled=${busy}>${busy ? '올리는 중…' : '확인'}</button>
        </div>
      </div>
    </div>`;
}

// 사진 크게 보기 (누르면 닫힘)
export function PhotoViewer({ photo, caption, onClose }) {
  return html`
    <div class="viewer" onClick=${onClose} role="dialog" aria-label="사진 크게 보기">
      <img src=${photoUrl(photo)} alt="" />
      ${caption && html`<p>${caption}</p>`}
    </div>`;
}
