// 아래 탭 아이콘: 동글동글한 핑크 그림 (고른 탭은 진하게 + 통통 튀기)
import { html } from './html.js';

// 친구: 토끼 귀 달린 동그란 얼굴 둘
const friends = html`
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <ellipse cx="31" cy="9" rx="3.2" ry="7" fill="var(--i2)" transform="rotate(12 31 9)"/>
    <ellipse cx="38" cy="10" rx="3.2" ry="7" fill="var(--i2)" transform="rotate(28 38 10)"/>
    <circle cx="33" cy="24" r="11" fill="var(--i2)"/>
    <ellipse cx="11" cy="12" rx="3.6" ry="8" fill="var(--i1)" transform="rotate(-14 11 12)"/>
    <ellipse cx="20" cy="11" rx="3.6" ry="8" fill="var(--i1)" transform="rotate(8 20 11)"/>
    <ellipse cx="11" cy="12" rx="1.5" ry="5" fill="var(--i3)" transform="rotate(-14 11 12)"/>
    <ellipse cx="20" cy="11" rx="1.5" ry="5" fill="var(--i3)" transform="rotate(8 20 11)"/>
    <circle cx="17" cy="30" r="14" fill="var(--i1)"/>
    <circle cx="12" cy="28" r="1.8" fill="var(--ie)"/><circle cx="22" cy="28" r="1.8" fill="var(--ie)"/>
    <path d="M14.5 33 q2.5 2.4 5 0" stroke="var(--ie)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <ellipse cx="8.5" cy="32.5" rx="2.6" ry="1.6" fill="var(--i3)"/><ellipse cx="25.5" cy="32.5" rx="2.6" ry="1.6" fill="var(--i3)"/>
    <circle cx="11" cy="23" r="2.2" fill="#fff" opacity=".55"/>
  </svg>`;

// 채팅: 몽글몽글 말풍선 + 하트
const chats = html`
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path d="M24 5c11.6 0 20 7.4 20 16.6S35.6 38.2 24 38.2c-2 0-3.9-.2-5.7-.6L9.5 43c-1.2.7-2.6-.5-2.1-1.8l2.4-6.2C6 32 4 27.1 4 21.6 4 12.4 12.4 5 24 5z" fill="var(--i1)"/>
    <path d="M24 30.5s-8.5-5-8.5-10.4c0-2.8 2.1-4.7 4.6-4.7 1.7 0 3.1.9 3.9 2.2.8-1.3 2.2-2.2 3.9-2.2 2.5 0 4.6 1.9 4.6 4.7 0 5.4-8.5 10.4-8.5 10.4z" fill="#fff"/>
    <circle cx="12" cy="13" r="2.4" fill="#fff" opacity=".55"/>
    <circle cx="40" cy="9" r="2" fill="var(--i3)"/><circle cx="44" cy="15" r="1.3" fill="var(--i3)"/>
  </svg>`;

// 설정: 꽃잎 톱니 + 웃는 얼굴
const settings = html`
  <svg viewBox="0 0 48 48" aria-hidden="true">
    ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => html`<circle cx="24" cy="8.5" r="6.2" fill="var(--i2)" transform=${`rotate(${a} 24 24)`}/>`)}
    <circle cx="24" cy="24" r="14" fill="var(--i1)"/>
    <circle cx="19" cy="22" r="1.8" fill="var(--ie)"/><circle cx="29" cy="22" r="1.8" fill="var(--ie)"/>
    <path d="M21 27 q3 2.8 6 0" stroke="var(--ie)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <ellipse cx="16" cy="27" rx="2.4" ry="1.5" fill="var(--i3)"/><ellipse cx="32" cy="27" rx="2.4" ry="1.5" fill="var(--i3)"/>
    <circle cx="18" cy="17" r="2" fill="#fff" opacity=".55"/>
  </svg>`;

export const TAB_ICONS = { friends, chats, settings };
