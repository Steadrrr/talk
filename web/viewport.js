// 휴대폰 키보드: 아이폰은 키보드가 올라오면 화면 크기는 그대로 두고 보이는 부분만 위로 옮겨서
// 채팅방 위쪽·대화가 가려졌다. 앱 틀(#app)을 실제로 보이는 부분(visualViewport)의 위치·높이에 맞춘다.
//  - 예전처럼 scrollTo(0,0) 으로 되돌리면 아이폰이 다시 입력칸 쪽으로 옮기며 서로 싸워 화면이 떨렸음 → 되돌리지 않고 따라감
//  - 바꾸는 것은 한 화면 그리기(프레임)에 한 번만
export function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const touch = matchMedia('(pointer: coarse)').matches;
  let full = vv.height;            // 키보드 없을 때의 높이 (가장 컸던 높이, 화면을 돌리면 다시 잼)
  let raf = 0, last = '', lastH = 0;
  // 글 입력칸(편집 칸 포함)에 커서가 있는지: 키보드가 막 올라오는 중에도 여백을 바로 빼려고
  const typing = () => touch && !!document.activeElement?.matches?.('textarea, input:not([type=file]):not([type=checkbox]), [contenteditable]:not([contenteditable=false])');
  const fit = () => {
    raf = 0;
    if (vv.height > full) full = vv.height;
    const kb = typing() || full - vv.height > 120;   // 홈 화면 앱은 innerHeight 도 같이 줄어서 '가장 컸던 높이'와 비교
    const h = Math.round(vv.height);
    // 보이는 부분의 위치는 키보드가 떠 있을 때만 따라감. 유튜브 PIP 가 붙은 채로 알림을 눌러 앱이 열리면
    // 바뀌는 중의 위치(offsetTop)가 남아 앱 전체가 아래로 밀려 있었음 → 그 밖에는 늘 맨 위(0), 화면 밖으로는 안 내려감
    const top = kb ? Math.max(0, Math.min(Math.round(vv.offsetTop), innerHeight - h)) : 0;
    const key = `${h}|${top}|${kb}`;
    if (key === last) return;      // 같으면 아무것도 안 바꿈 (불필요한 다시 그리기 = 떨림)
    last = key;
    root.style.setProperty('--app-h', h + 'px');
    root.style.setProperty('--app-top', top + 'px');
    root.classList.toggle('kb', kb);  // 키보드가 떠 있음 → 입력줄 아래 안전 여백 빼기
    // 높이가 바뀔 때만 알림 (위치만 바뀔 때도 알렸더니 대화 목록이 맨 아래로 계속 끌려가 스크롤이 안 됐음)
    if (h !== lastH) { lastH = h; window.dispatchEvent(new Event('talk:fit')); }
  };
  const soon = () => { if (!raf) raf = requestAnimationFrame(fit); };
  document.addEventListener('focusin', soon);
  document.addEventListener('focusout', () => setTimeout(soon, 120)); // 입력칸 사이를 옮길 때 잠깐 꺼졌다 켜지지 않게
  vv.addEventListener('resize', soon);
  vv.addEventListener('scroll', soon);
  addEventListener('orientationchange', () => { full = 0; setTimeout(soon, 300); });
  // 다른 앱(유튜브 PIP 등)에서 돌아올 때: 화면이 바뀌는 동안 알림이 빠지거나 중간 값이 올 수 있어 조금 뒤에 다시 맞춤
  const again = () => { soon(); setTimeout(soon, 300); setTimeout(soon, 1000); };
  addEventListener('resize', again);
  addEventListener('pageshow', again);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) again(); });
  fit();
  if (touch) holdPage();
}

// 키보드가 떠 있을 때 아이폰은 화면 전체를 손가락으로 위아래로 밀 수 있다(보이는 부분이 움직임).
// 그러면 앱 틀이 따라 움직이며 떨리고, 대화 목록 대신 화면이 밀려 스크롤이 안 되는 것처럼 보였음.
// → 스크롤할 수 있는 칸(대화 목록·긴 입력칸 등) 안에서, 그 칸이 더 움직일 수 있을 때만 손가락 이동을 허용
function holdPage() {
  const root = document.documentElement;
  let x = 0, y = 0;
  const canScroll = (el, dy) => {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      if (dy > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    }
    return false;
  };
  document.addEventListener('touchstart', (e) => { x = e.touches[0].clientX; y = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!root.classList.contains('kb') || e.touches.length > 1) return;
    const t = e.touches[0], dx = t.clientX - x, dy = t.clientY - y;
    x = t.clientX; y = t.clientY;
    if (Math.abs(dx) > Math.abs(dy) || dy === 0) return;      // 옆으로 밀기는 그대로
    if (!canScroll(e.target, dy) && e.cancelable) e.preventDefault();
  }, { passive: false });
}
