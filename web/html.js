// 화면 조각을 만드는 태그 문자열 (JSX 대신, 빌드 설정 없이)
import { h } from 'preact';
import htm from 'htm';

export const html = htm.bind(h);

const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const shortFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' });

export const time = (iso) => timeFmt.format(new Date(iso));
export const dateLine = (iso) => dateFmt.format(new Date(iso));
export const dayKey = (iso) => new Date(iso).toDateString();

// 채팅 목록의 시각: 오늘이면 시각, 어제면 "어제", 그 전이면 날짜
export function listTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return timeFmt.format(d);
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '어제';
  return shortFmt.format(d);
}

// 이름 첫 글자로 만드는 동그란 얼굴 (프로필 사진은 2단계)
const COLORS = ['#f48fb1', '#ce93d8', '#9fa8da', '#80cbc4', '#ffcc80', '#a5d6a7', '#90caf9', '#ffab91'];
export function Avatar({ name, id, size = 40 }) {
  const c = COLORS[Math.abs(id || 0) % COLORS.length];
  return html`<span class="avatar" style=${{ width: size + 'px', height: size + 'px', background: c, fontSize: Math.round(size * 0.42) + 'px' }}>${(name || '?').slice(0, 1)}</span>`;
}
