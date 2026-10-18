// 홈 화면 아이콘의 숫자 뱃지 (Badging API): 안 읽은 메시지 합계. 채팅 탭 숫자와 같은 수.
// 아이폰은 홈 화면에 추가한 앱 + 알림 허용일 때만 보인다 (iOS 16.4+). 앱이 닫혀 있을 때는 서비스 워커가 푸시로 받은 수를 단다.
import { state, subscribe } from './store.js';

let last = -1;
function apply(s) {
  const n = s.me ? Object.values(s.rooms).reduce((t, r) => t + (r.unread || 0), 0) : 0;
  if (n === last || !('setAppBadge' in navigator)) return;
  last = n;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
subscribe(apply);
apply(state);
