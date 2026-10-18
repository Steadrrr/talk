// 글씨 크기: 이 기기에 기억하고 화면 전체 글씨에 배율(--fs)로 적용 (휴대폰 설정과 상관없이 앱에서 고름)
export const FONT_SIZES = [
  { key: 'small', label: '작게', scale: 0.9 },
  { key: 'normal', label: '보통', scale: 1 },
  { key: 'large', label: '크게', scale: 1.15 },
  { key: 'xlarge', label: '아주 크게', scale: 1.3 },
];
const KEY = 'talk.fontSize';

export function getFontSize() {
  try { return localStorage.getItem(KEY) || 'normal'; } catch { return 'normal'; }
}
export function applyFontSize(key = getFontSize()) {
  const f = FONT_SIZES.find((x) => x.key === key) || FONT_SIZES[1];
  document.documentElement.style.setProperty('--fs', String(f.scale));
}
export function setFontSize(key) {
  try { localStorage.setItem(KEY, key); } catch { /* 이번 실행 동안만 */ }
  applyFontSize(key);
}
