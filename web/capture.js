// 채팅 캡쳐: ＋ 메뉴 "캡쳐" → 시작·끝 메시지를 누르면 그 사이를 그림 한 장으로 저장
// 고른 곳은 점선 테두리 + 살짝 밝게(배경까지). 저장할 때 대화명·프로필을 숨기면 이름은 ???, 프로필 사진은 모자이크.
// 그림 그리는 라이브러리(html2canvas-pro)는 처음 저장할 때만 받아 온다.
import { useEffect, useState } from 'preact/hooks';
import { html } from './html.js';
import { useBackdrop } from './gallery.js';
import { saveFiles } from './media.js';

// 고른 메시지 번호들: 화면 차례(shown)로 from~to 사이 (거꾸로 골라도 됨)
export function capIds(shown, from, to) {
  const ids = new Set();
  if (from == null) return ids;
  const a = shown.findIndex((m) => m.id === from), b = shown.findIndex((m) => m.id === (to ?? from));
  if (a < 0 || b < 0) return ids;
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (shown[i].id) ids.add(String(shown[i].id));
  return ids;
}

// 누른 메시지로 고르기: 처음은 시작(그 하나만 골라짐), 다음은 끝, 그다음 누르면 새로 시작
export function capPick(cap, id) {
  if (cap.from == null || cap.to !== cap.from) return { from: id, to: id };
  return { from: cap.from, to: id };
}

// 고른 것들을 감싸는 점선 상자 자리: 그룹 첫 메시지부터면 대화명까지 포함
export function placeBox(scroller, box, ids) {
  if (!scroller || !box) return;
  const els = [...scroller.querySelectorAll('[data-id]')].filter((el) => ids.has(el.dataset.id));
  if (!els.length) { box.style.display = 'none'; return; }
  const first = els[0].classList.contains('first') ? els[0].closest('.msg-group') : els[0];
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const top = first.getBoundingClientRect().top - base - 4;
  const bottom = els[els.length - 1].getBoundingClientRect().bottom - base + 4;
  Object.assign(box.style, { display: 'block', top: top + 'px', height: bottom - top + 'px' });
}

// 아래 줄 (입력칸 자리): 안내 + 취소·저장
export function CaptureBar({ cap, count, onCancel, onSave }) {
  const tip = cap.from == null ? '캡쳐를 시작할 메시지를 눌러 주세요'
    : cap.to === cap.from ? '끝 메시지를 눌러 주세요 (이 메시지 하나만 저장해도 돼요)'
    : `${count}개 골랐어요 · 다른 메시지를 누르면 새로 골라요`;
  return html`
    <div class="cap-bar">
      <p class="cap-tip">${tip}</p>
      <div class="cap-actions">
        <button class="cap-cancel" onClick=${onCancel}>취소</button>
        <button class="cap-save" onClick=${onSave} disabled=${!count}>저장</button>
      </div>
    </div>`;
}

// 저장 미리 보기: 대화명·프로필 공개/숨기기를 고르면 다시 그리고, 저장을 누르면 사진으로
export function CapturePreview({ scroller, ids, names, onClose, onDone }) {
  const [hide, setHide] = useState(false);
  const [img, setImg] = useState(null);   // { url, blob }
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const backdrop = useBackdrop(onClose);
  useEffect(() => {
    let live = true, url = '';
    setImg(null); setErr('');
    capture(scroller, ids, hide && names).then((blob) => {
      url = URL.createObjectURL(blob);
      if (live) setImg({ url, blob }); else URL.revokeObjectURL(url);
    }).catch((e) => live && setErr(e.message || '그림을 만들지 못했어요.'));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [hide]);
  async function save() {
    setBusy(true); setErr('');
    try {
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      const name = `SAKiTalk-capture-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
      await saveFiles([new File([img.blob], name, { type: 'image/png' })]);
      onDone();
    } catch (e) { setErr(e.message || '저장하지 못했어요.'); }
    setBusy(false);
  }
  return html`
    <div class="sheet-bg" onClick=${backdrop}>
      <div class="sheet cap-sheet">
        <header class="bar"><button class="icon" onClick=${onClose} aria-label="닫기">✕</button><h2 class="grow">캡쳐 저장</h2></header>
        <div class="seg cap-seg" role="radiogroup" aria-label="대화명·프로필">
          <button class=${hide ? '' : 'on'} role="radio" aria-checked=${!hide} onClick=${() => setHide(false)}>이름·프로필 공개</button>
          <button class=${hide ? 'on' : ''} role="radio" aria-checked=${hide} onClick=${() => setHide(true)}>이름·프로필 숨기기</button>
        </div>
        <div class="scroll cap-view">
          ${err ? html`<p class="err pad">${err}</p>` : img ? html`<img src=${img.url} alt="캡쳐 미리 보기" />` : html`<p class="hint center">그림 만드는 중…</p>`}
        </div>
        <div class="cap-foot"><button class="primary" onClick=${save} disabled=${!img || busy}>${busy ? '저장하는 중…' : '저장'}</button></div>
      </div>
    </div>`;
}

let h2c = null;
const lib = () => (h2c ??= import('html2canvas-pro').then((x) => x.default).catch((e) => { h2c = null; throw e; }));

// 그림 만들기: 고른 메시지만 남긴 복사본을 화면 뒤에 같은 너비로 펼쳐 놓고 그린다
// hide: 숨길 때 방 사람 이름들(Map), 공개면 false
async function capture(scroller, ids, hide) {
  const draw = await lib().catch(() => { throw new Error('캡쳐 도구를 받지 못했어요. 인터넷 연결을 확인해 주세요.'); });
  const box = buildClone(scroller, ids);
  if (hide) await hideNames(box, scroller, [...hide.values()]);
  scroller.parentNode.appendChild(box);
  try {
    await Promise.all([...box.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
    const w = box.offsetWidth, h = box.offsetHeight;
    // 휴대폰 캔버스 한도(약 1600만 화소) 안에서 2배로 선명하게
    const scale = Math.max(0.5, Math.min(2, Math.sqrt(16e6 / (w * h)), 16000 / h));
    const canvas = await draw(box, { scale, useCORS: true, logging: false, backgroundColor: getComputedStyle(scroller).backgroundColor,
      windowWidth: document.documentElement.clientWidth, windowHeight: Math.max(innerHeight, h), scrollX: 0, scrollY: 0 });
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('그림이 너무 커요. 조금 줄여서 골라 주세요.');
    return blob;
  } finally { box.remove(); }
}

// 고른 메시지들(과 그 사이 날짜 줄·안내 글)만 복사. 그룹이 중간에서 잘리면 남은 것만, 바로 앞 날짜 줄도 같이
function buildClone(scroller, ids) {
  const items = [...scroller.children].filter((el) => el.matches('.msg-group, .day, .msg-system'));
  const has = (el) => el.matches('[data-id]') ? ids.has(el.dataset.id) : [...el.querySelectorAll('.msg[data-id]')].some((r) => ids.has(r.dataset.id));
  const a = items.findIndex(has);
  let b = items.length - 1;
  while (b >= 0 && !has(items[b])) b--;
  const box = document.createElement('div');
  box.className = 'messages cap-clone';
  box.style.width = scroller.clientWidth + 'px';
  if (a < 0) return box;
  for (let i = a > 0 && items[a - 1].matches('.day') ? a - 1 : a; i <= b; i++) {
    const c = items[i].cloneNode(true);
    if (c.matches('.msg-group')) {
      for (const r of c.querySelectorAll('.msg')) if (!ids.has(r.dataset.id)) r.remove();
      c.querySelector('.msg')?.classList.add('first');
    }
    box.appendChild(c);
  }
  for (const el of box.querySelectorAll('.flash, .swiping')) { el.classList.remove('flash', 'swiping', 'r', 'l'); el.style.transform = ''; }
  for (const i of box.querySelectorAll('img')) i.removeAttribute('loading');
  return box;
}

// 숨기기: 다른 사람 대화명·답장 속 이름은 ???, 안내 글("엄마님이 들어왔어요") 속 이름도 ???,
// 프로필 사진은 모자이크 (원래 화면의 사진에서 그림)
async function hideNames(box, scroller, names = []) {
  for (const el of box.querySelectorAll('.msg-group.theirs > .who, .quote b')) el.textContent = '???';
  const words = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const el of box.querySelectorAll('.msg-system span')) for (const w of words) el.textContent = el.textContent.split(w + '님').join('???님');
  const faces = [...scroller.querySelectorAll('.grp-face .avatar')];
  const clones = [...box.querySelectorAll('.grp-face .avatar')];
  // 복사본의 그룹은 원래 그룹 중 일부라, 같은 사진·글자를 찾아 짝짓는다
  for (const c of clones) {
    const src = faces.find((f) => f.tagName === c.tagName && (c.tagName === 'IMG' ? f.src === c.src : f.textContent === c.textContent && f.style.background === c.style.background)) || c;
    const img = document.createElement('img');
    img.className = 'avatar';
    img.alt = '';
    img.style.cssText = `display:block;width:${c.style.width};height:${c.style.height}`;
    img.src = await mosaic(src);
    c.replaceWith(img);
  }
}

// 모자이크: 6×6 칸으로 줄였다가 칸이 보이게 키움
async function mosaic(el) {
  const S = 60, N = 6;
  const big = document.createElement('canvas');
  big.width = big.height = S;
  const g = big.getContext('2d');
  try {
    if (el.tagName === 'IMG') {
      if (!el.complete) await el.decode().catch(() => {});
      g.drawImage(el, 0, 0, S, S);
    } else {
      const st = getComputedStyle(el);
      g.fillStyle = st.backgroundColor; g.fillRect(0, 0, S, S);
      g.fillStyle = st.color; g.font = `700 ${S * 0.6}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(el.textContent || '?', S / 2, S / 2 + 2);
    }
    const small = document.createElement('canvas');
    small.width = small.height = N;
    small.getContext('2d').drawImage(big, 0, 0, N, N);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, S, S);
    g.drawImage(small, 0, 0, S, S);
    return big.toDataURL('image/png');
  } catch {   // 사진을 못 읽으면 회색 칸
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#9e9e9e'; x.fillRect(0, 0, N, N);
    return c.toDataURL('image/png');
  }
}
