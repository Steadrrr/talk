// 알림 받기 (웹 푸시). 아이폰은 홈 화면에 추가한 SAKi Talk(iOS 16.4 이상)에서만, 안드로이드는 크롬에서 바로 된다.
// 켜면 이 기기의 알림 주소를 서버에 맡기고, 서버는 새 메시지가 오면 여기로 보낸다 (앱을 보고 있을 때는 안 보냄)
import { api } from './api.js';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (b64u) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration() {
  await navigator.serviceWorker.register('./sw.js');
  return navigator.serviceWorker.ready;
}

// 'on' | 'off' | 'denied'(휴대폰 설정에서 막힘) | 'install'(아이폰: 홈 화면에 먼저 추가) | 'unsupported'
export async function pushState() {
  if (isIos() && !standalone()) return 'install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export const deniedHelp = () => (isIos()
  ? '알림이 막혀 있어요. 아이폰 설정 > 알림 > SAKi Talk 에서 허용해 주세요.'
  : '알림이 막혀 있어요. 주소창 왼쪽 자물쇠(또는 휴대폰 설정 > 앱 > 크롬 > 알림)에서 허용해 주세요.');

// 켜기: 버튼을 누른 그 순간에 불러야 한다 (아이폰은 사용자가 누를 때만 권한을 물을 수 있음)
export async function enablePush() {
  const st = await pushState();
  if (st === 'install') throw new Error('아이폰은 홈 화면에 추가한 SAKi Talk 에서 알림을 켤 수 있어요.');
  if (st === 'unsupported') throw new Error('이 브라우저는 알림을 받을 수 없어요. (아이폰은 iOS 16.4 이상)');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? deniedHelp() : '알림을 허용하지 않았어요.');
  const reg = await registration();
  const { key } = await api('push/key');
  let sub = await reg.pushManager.getSubscription();
  // 서버 키가 바뀌었으면 다시 구독
  if (sub && sub.options?.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    const now = keyBytes(key);
    if (old.length !== now.length || old.some((b, i) => b !== now[i])) { await sub.unsubscribe().catch(() => {}); sub = null; }
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api('push/subscribe', sub.toJSON());
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  await api('push/unsubscribe', { endpoint: sub ? sub.endpoint : '' }).catch(() => {});
  if (sub) await sub.unsubscribe().catch(() => {});
}

// 로그인·앱을 열 때: 켜 둔 알림이면 서버에도 조용히 다시 알려 준다 (다시 로그인했거나 서버에서 정리된 경우)
export async function refreshPush() {
  try {
    if ((await pushState()) !== 'on') return;
    const reg = await navigator.serviceWorker.getRegistration();
    await api('push/subscribe', (await reg.pushManager.getSubscription()).toJSON());
  } catch { /* 다음에 다시 */ }
}

// 방을 열면 그 방 알림은 알림 센터에서 지운다
export async function clearRoomNotifications(roomId) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const n of (await reg?.getNotifications({ tag: 'room-' + roomId })) || []) n.close();
  } catch { /* 무시 */ }
}

// 첫 로그인 알림 팝업: 로그인마다 한 번만 (로그아웃하면 다시 물음)
const ASKED = 'talk.pushAsked';
export const pushAsked = () => { try { return localStorage.getItem(ASKED) === '1'; } catch { return true; } };
export const setPushAsked = (v) => { try { v ? localStorage.setItem(ASKED, '1') : localStorage.removeItem(ASKED); } catch { /* 무시 */ } };
