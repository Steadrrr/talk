// 사진 보내기 전: 고른 사진을 크게 보고(빼기 가능) 한 장씩 편집 → 보내기
//  - 편집: 자르기(네 모서리 끌기·안쪽 끌어 옮기기), 오른쪽으로 돌리기, 펜으로 그리기(색 고르기), 되돌리기
//  - 편집은 휴대폰 캔버스에서 긴 쪽 1600px 로 해서 새 파일로 바꿔 끼움 (보낼 때 늘 하던 줄이기가 그 뒤에)
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from './html.js';

const MAX = 1600;
const COLORS = ['#ffffff', '#111111', '#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#e8508e'];

export function SendPreview({ files, onSend, onClose }) {
  const [list, setList] = useState(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })));
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState(false);
  const urls = useRef([]);
  urls.current = list.map((x) => x.url);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const cur = list[Math.min(at, list.length - 1)];

  function remove(i) {
    if (list.length === 1) { onClose(); return; }
    URL.revokeObjectURL(list[i].url);
    setList(list.filter((_, k) => k !== i));
    if (at >= i && at > 0) setAt(at - 1);
  }
  function edited(file) {
    setEditing(false);
    if (file === cur.file) return;
    URL.revokeObjectURL(cur.url);
    setList(list.map((x) => (x === cur ? { file, url: URL.createObjectURL(file), edited: true } : x)));
  }
  const send = () => onSend(list.map((x) => x.file));

  if (editing) return html`<${PhotoEditor} file=${cur.file} onDone=${edited} onCancel=${() => setEditing(false)} />`;
  return html`
    <div class="viewer send-preview" role="dialog" aria-label="보낼 사진">
      <div class="pe-top">
        <button class="pe-btn" onClick=${onClose} aria-label="취소">✕</button>
        <span class="pe-title">${list.length > 1 ? `${at + 1} / ${list.length}` : '사진'}</span>
        <button class="pe-btn pe-edit" onClick=${() => setEditing(true)}>편집</button>
      </div>
      <div class="pe-stage"><img src=${cur.url} alt="" /></div>
      ${list.length > 1 && html`
        <div class="sp-strip">
          ${list.map((x, i) => html`
            <div key=${x.url} class=${'sp-thumb' + (i === at ? ' on' : '')}>
              <button class="sp-pick" onClick=${() => setAt(i)} aria-label=${`${i + 1}번째 사진`}><img src=${x.url} alt="" /></button>
              ${x.edited && html`<span class="sp-mark">✎</span>`}
              <button class="sp-del" onClick=${() => remove(i)} aria-label="빼기">✕</button>
            </div>`)}
        </div>`}
      <button class="sp-send" onClick=${send}>${list.length > 1 ? `${list.length}장 보내기` : '보내기'}</button>
    </div>`;
}

const loadImage = (url) => new Promise((ok, no) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => no(new Error('사진을 열지 못했어요.'));
  i.src = url;
});
function copyOf(c) {
  const d = document.createElement('canvas');
  d.width = c.width; d.height = c.height;
  d.getContext('2d').drawImage(c, 0, 0);
  return d;
}
function paint(c, src) {
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
}

export function PhotoEditor({ file, onDone, onCancel }) {
  const cv = useRef(null);
  const wrap = useRef(null);
  const undo = useRef([]);
  const [steps, setSteps] = useState(0);         // 되돌릴 수 있는 수 (화면 다시 그리기용)
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [tool, setTool] = useState('');          // '' | 'pen' | 'crop'
  const [color, setColor] = useState(COLORS[2]);
  const [crop, setCrop] = useState(null);        // { x, y, w, h } 0~1
  const [busy, setBusy] = useState(false);
  const pen = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    loadImage(url).then((img) => {
      const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = cv.current;
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      setReady(true);
    }).catch((e) => setErr(e.message)).finally(() => URL.revokeObjectURL(url));
  }, [file]);

  function remember() {
    undo.current.push(copyOf(cv.current));
    if (undo.current.length > 20) undo.current.shift();
    setSteps(undo.current.length);
  }
  function back() {
    const prev = undo.current.pop();
    if (prev) paint(cv.current, prev);
    setSteps(undo.current.length);
  }

  function rotate() {
    setTool(''); setCrop(null);
    remember();
    const c = cv.current, src = copyOf(c);
    c.width = src.height; c.height = src.width;
    const g = c.getContext('2d');
    g.translate(c.width, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(src, 0, 0);
  }

  function startCrop() {
    if (tool === 'crop') { setTool(''); setCrop(null); return; }
    setTool('crop');
    setCrop({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  }
  function applyCrop() {
    const c = cv.current;
    const x = Math.round(crop.x * c.width), y = Math.round(crop.y * c.height);
    const w = Math.max(1, Math.round(crop.w * c.width)), h = Math.max(1, Math.round(crop.h * c.height));
    remember();
    const src = copyOf(c);
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
    setTool(''); setCrop(null);
  }

  // 자르기 상자 끌기: 모서리(nw·ne·sw·se) 또는 안쪽(move)
  function cropDown(e, part) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { part, x: e.clientX, y: e.clientY, box: crop, r: wrap.current.getBoundingClientRect() };
  }
  function cropMove(e) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.r.width, dy = (e.clientY - d.y) / d.r.height;
    const MIN = 0.08;
    let { x, y, w, h } = d.box;
    if (d.part === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx));
      y = Math.min(1 - h, Math.max(0, y + dy));
    } else {
      let l = x, t = y, r = x + w, b = y + h;
      if (d.part.includes('w')) l = Math.min(r - MIN, Math.max(0, l + dx));
      if (d.part.includes('e')) r = Math.max(l + MIN, Math.min(1, r + dx));
      if (d.part.includes('n')) t = Math.min(b - MIN, Math.max(0, t + dy));
      if (d.part.includes('s')) b = Math.max(t + MIN, Math.min(1, b + dy));
      x = l; y = t; w = r - l; h = b - t;
    }
    setCrop({ x, y, w, h });
  }
  const cropUp = () => { drag.current = null; };

  // 펜: 손가락 따라 선. 굵기는 사진 크기에 맞춰
  const at = (e) => {
    const r = cv.current.getBoundingClientRect();
    return [(e.clientX - r.left) * cv.current.width / r.width, (e.clientY - r.top) * cv.current.height / r.height];
  };
  function penDown(e) {
    if (tool !== 'pen') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    remember();
    const g = cv.current.getContext('2d');
    const c = cv.current;
    g.strokeStyle = color;
    g.lineWidth = Math.max(3, Math.max(c.width, c.height) / 120);
    g.lineCap = 'round'; g.lineJoin = 'round';
    pen.current = [at(e)];
    stroke();
  }
  // 한 획을 처음부터 다시 그림 (조각조각 이으면 이음매에 점이 보여서)
  function stroke() {
    const c = cv.current, g = c.getContext('2d'), pts = pen.current;
    g.drawImage(undo.current.at(-1), 0, 0);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.length > 1 ? pts.slice(1) : pts) g.lineTo(p[0], p[1]);
    g.stroke();
  }
  function penMove(e) {
    if (!pen.current) return;
    pen.current.push(at(e));
    stroke();
  }
  const penUp = () => { pen.current = null; };

  async function done() {
    if (!undo.current.length) { onDone(file); return; }
    setBusy(true);
    const blob = await new Promise((ok) => cv.current.toBlob(ok, 'image/jpeg', 0.92));
    setBusy(false);
    if (!blob) { setErr('사진을 만들지 못했어요.'); return; }
    onDone(new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '-edit.jpg', { type: 'image/jpeg' }));
  }

  return html`
    <div class="viewer photo-editor" role="dialog" aria-label="사진 편집">
      <div class="pe-top">
        <button class="pe-btn" onClick=${onCancel}>취소</button>
        <button class="pe-btn pe-undo" onClick=${back} disabled=${!steps} >되돌리기</button>
        <button class="pe-btn pe-done" onClick=${done} disabled=${!ready || busy}>완료</button>
      </div>
      <div class="pe-stage">
        ${err && html`<p>${err}</p>`}
        <div class="pe-wrap" ref=${wrap} onPointerMove=${cropMove} onPointerUp=${cropUp} onPointerCancel=${cropUp}>
          <canvas ref=${cv} class=${tool === 'pen' ? 'drawing' : ''}
            onPointerDown=${penDown} onPointerMove=${penMove} onPointerUp=${penUp} onPointerCancel=${penUp}></canvas>
          ${crop && html`
            <div class="pe-crop" style=${{ left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.w * 100 + '%', height: crop.h * 100 + '%' }}
              onPointerDown=${(e) => cropDown(e, 'move')}>
              ${['nw', 'ne', 'sw', 'se'].map((k) => html`<i key=${k} class=${'pe-h ' + k} onPointerDown=${(e) => cropDown(e, k)}></i>`)}
            </div>`}
        </div>
      </div>
      ${tool === 'pen' && html`
        <div class="pe-colors">
          ${COLORS.map((c) => html`<button key=${c} class=${'pe-color' + (c === color ? ' on' : '')} style=${{ background: c }} onClick=${() => setColor(c)} aria-label="펜 색"></button>`)}
        </div>`}
      <div class="pe-tools">
        ${tool === 'crop'
          ? html`<button class="pe-tool" onClick=${startCrop}>그만두기</button><button class="pe-tool on pe-apply" onClick=${applyCrop}>자르기 적용</button>`
          : html`
            <button class="pe-tool pe-crop-btn" onClick=${startCrop} disabled=${!ready}>✂︎<span>자르기</span></button>
            <button class="pe-tool pe-rotate" onClick=${rotate} disabled=${!ready}>↻<span>돌리기</span></button>
            <button class=${'pe-tool pe-pen' + (tool === 'pen' ? ' on' : '')} onClick=${() => setTool(tool === 'pen' ? '' : 'pen')} disabled=${!ready}>✎<span>펜</span></button>`}
      </div>
    </div>`;
}
