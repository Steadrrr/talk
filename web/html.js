// 화면 조각을 만드는 태그 문자열 (JSX 대신, 빌드 설정 없이)
import { h } from 'preact';
import htm from 'htm';

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

// 사진 고르기 → 가운데를 정사각형으로 잘라 size px JPEG 로 줄여 base64 로
export async function squareJpeg(file, size) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('사진을 열지 못했어요.')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } finally { URL.revokeObjectURL(url); }
}

// 사진 크게 보기 (누르면 닫힘)
export function PhotoViewer({ photo, caption, onClose }) {
  return html`
    <div class="viewer" onClick=${onClose} role="dialog" aria-label="사진 크게 보기">
      <img src=${photoUrl(photo)} alt="" />
      ${caption && html`<p>${caption}</p>`}
    </div>`;
}
