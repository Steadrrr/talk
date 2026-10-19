// 채팅방 꾸미기: 내 말풍선·상대 말풍선·배경 색, 배경화면 사진. 이 기기에만 기억 (서버 디스크를 안 씀)
// 색은 CSS 변수(--mine, --theirs, --chat-bg …)를 바꿔서 적용. '기본'이면 변수를 지워 밝은·어두운 화면 기본색을 따름
import { useState } from 'preact/hooks';
import { html } from './html.js';

const KEY = 'talk.chatTheme';     // { mine, theirs, bg, dim, lum }
const WALL_KEY = 'talk.chatWall'; // 배경화면 JPEG (data URL, 보통 150~300KB)

export const MINE_COLORS = ['#ff8fbd', '#fee500', '#9fd3ff', '#b8e986', '#c9b3ff', '#ffb38a', '#d9dde3', '#3a4a8c'];
export const THEIRS_COLORS = ['#ffffff', '#eef0f3', '#fff6c2', '#e3f2ff', '#ffe6f0', '#2a2e35', '#111111'];
export const BG_COLORS = ['#f3e9ef', '#b2c7d9', '#e3f1dc', '#f4ecdc', '#e8eaed', '#1f2a44', '#000000'];

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function getChatTheme() {
  try { return { dim: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { dim: 0 }; }
}
function getWall() {
  try { return localStorage.getItem(WALL_KEY) || ''; } catch { return ''; }
}

// 색의 밝기 (0 어두움 ~ 1 밝음)
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
// 그 색 위에 올릴 글씨 색
const inkOn = (hex) => (lum(hex) > 0.6 ? '#1c1f24' : '#ffffff');

// 배경화면을 얼마나 어둡게 덮을지: 어두운 화면에서는 눈부시지 않게 조금 더
function wallShade(t) {
  return Math.min(0.8, (t.dim || 0) / 100 + (dark() ? 0.25 : 0));
}

export function applyChatTheme(t = getChatTheme()) {
  const s = document.documentElement.style;
  const set = (k, v) => (v ? s.setProperty(k, v) : s.removeProperty(k));
  set('--mine', t.mine);
  set('--mine-fg', t.mine && inkOn(t.mine));
  set('--theirs', t.theirs);
  set('--theirs-fg', t.theirs && inkOn(t.theirs));
  set('--chat-bg', t.bg);
  const wall = getWall();
  const shade = wallShade(t);
  set('--chat-wall', wall && `linear-gradient(rgba(0,0,0,${shade}), rgba(0,0,0,${shade})), url("${wall}")`);
  // 방 안 이름·시각 글씨: 배경(색이나 사진)이 어두우면 밝게, 밝으면 어둡게
  const l = wall ? (t.lum ?? 0.5) * (1 - shade) : t.bg ? lum(t.bg) : null;
  set('--chat-dim', l === null ? '' : l > 0.55 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.85)');
  // 사진 위에서는 글씨 둘레에 반대 색 테두리를 둘러 무늬에 묻히지 않게
  set('--chat-halo', !wall ? '' : l > 0.55 ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.7)');
  document.documentElement.classList.toggle('chat-wall', !!wall);
}

function save(t) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* 이번 실행 동안만 */ }
  applyChatTheme(t);
}

try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyChatTheme()); } catch { /* 옛 브라우저 */ }

const loadImage = (url) => new Promise((ok, no) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => no(new Error('사진을 열지 못했어요.'));
  i.src = url;
});

// 고른 사진을 긴 쪽 1440px JPEG 로 줄이고 평균 밝기를 잼. 기기 저장 칸이 모자라면 더 작게
async function setWallpaper(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const probe = document.createElement('canvas');
    probe.width = probe.height = 16;
    const pc = probe.getContext('2d');
    pc.drawImage(img, 0, 0, 16, 16);
    const px = pc.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const avg = sum / (px.length / 4) / 255;
    for (const [side, q] of [[1440, 0.8], [1080, 0.72], [800, 0.65]]) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try {
        localStorage.setItem(WALL_KEY, c.toDataURL('image/jpeg', q));
        return avg;
      } catch { /* 저장 칸 모자람 → 더 작게 */ }
    }
    throw new Error('이 기기에 저장할 자리가 모자라요.');
  } finally { URL.revokeObjectURL(url); }
}

function Swatches({ colors, value, onPick }) {
  return html`
    <div class="swatches">
      <button class=${'swatch def' + (!value ? ' on' : '')} onClick=${() => onPick(null)}>기본</button>
      ${colors.map((c) => html`<button class=${'swatch' + (value === c ? ' on' : '')} style=${{ background: c }} aria-label=${c} onClick=${() => onPick(c)}></button>`)}
      <label class=${'swatch pick' + (value && !colors.includes(value) ? ' on' : '')} style=${value && !colors.includes(value) ? { background: value } : null} aria-label="직접 고르기">
        <input type="color" value=${value || '#ffffff'} onInput=${(e) => onPick(e.target.value)} />
      </label>
    </div>`;
}

// 설정 탭 "채팅방 꾸미기" 칸
export function ChatThemeCard() {
  const [t, setT] = useState(getChatTheme);
  const [hasWall, setHasWall] = useState(() => !!getWall());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const change = (p) => { const n = { ...t, ...p }; setT(n); save(n); };

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setBusy(true);
    try { const l = await setWallpaper(file); setHasWall(true); change({ lum: l }); } catch (e2) { setErr(e2.message || '사진을 열지 못했어요.'); } finally { setBusy(false); }
  }
  function removeWall() {
    try { localStorage.removeItem(WALL_KEY); } catch { /* 무시 */ }
    setHasWall(false);
    applyChatTheme(t);
  }
  function reset() {
    if (!confirm('채팅방 색과 배경화면을 처음대로 돌릴까요?')) return;
    try { localStorage.removeItem(WALL_KEY); } catch { /* 무시 */ }
    setHasWall(false);
    const n = { dim: 0 };
    setT(n); save(n);
  }

  return html`
    <div class="card">
      <b>채팅방 꾸미기</b>
      <div class="theme-preview">
        <div class="msg theirs first"><div class="bubble">안녕! 오늘 저녁 뭐 먹어?</div><span class="hint small">오후 7:02</span></div>
        <div class="msg mine first"><span class="hint small">오후 7:03</span><div class="bubble">치킨 어때 🍗</div></div>
      </div>
      <span class="theme-label">내 말풍선</span>
      <${Swatches} colors=${MINE_COLORS} value=${t.mine} onPick=${(c) => change({ mine: c })} />
      <span class="theme-label">상대 말풍선</span>
      <${Swatches} colors=${THEIRS_COLORS} value=${t.theirs} onPick=${(c) => change({ theirs: c })} />
      <span class="theme-label">배경 색</span>
      <${Swatches} colors=${BG_COLORS} value=${t.bg} onPick=${(c) => change({ bg: c })} />
      <span class="theme-label">배경화면</span>
      <div class="photo-btns">
        <label class="text left">${busy ? '줄이는 중…' : hasWall ? '사진 바꾸기' : '사진 고르기'}<input type="file" accept="image/*" hidden disabled=${busy} onChange=${pick} /></label>
        ${hasWall && html`<button class="text dim" onClick=${removeWall}>지우기</button>`}
      </div>
      ${hasWall && html`
        <label class="theme-dim">어둡게 <span class="hint">${t.dim || 0}%</span>
          <input type="range" class="crop-zoom" min="0" max="70" step="5" value=${t.dim || 0} style=${{ '--p': (t.dim || 0) / 70 }}
            onInput=${(e) => change({ dim: Number(e.target.value) })} />
        </label>`}
      ${err && html`<p class="err">${err}</p>`}
      <p class="hint">이 기기에만 적용돼요. '기본'은 밝은·어두운 화면에 맞춰 바뀌어요.</p>
      <button class="text left" onClick=${reset}>처음대로</button>
    </div>`;
}
