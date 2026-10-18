// 이름 보이기: 채팅에는 닉네임(없으면 본명), 프로필에는 "닉네임(본명)"
export const nickOf = (p) => (p ? p.nick || p.name : '');
export const fullName = (p) => (!p ? '' : p.nick && p.nick !== p.name ? `${p.nick}(${p.name})` : p.name);
