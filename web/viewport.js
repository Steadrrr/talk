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
  let raf = 0, last = '';
  // 글 입력칸(편집 칸 포함)에 커서가 있는지: 키보드가 막 올라오는 중에도 여백을 바로 빼려고
  const typing = () => touch && !!document.activeElement?.matches?.('textarea, input:not([type=file]):not([type=checkbox]), [contenteditable]:not([contenteditable=false])');
  const fit = () => {
    raf = 0;
    if (vv.height > full) full = vv.height;
    const kb = typing() || full - vv.height > 120;   // 홈 화면 앱은 innerHeight 도 같이 줄어서 '가장 컸던 높이'와 비교
    const h = Math.round(vv.height), top = Math.max(0, Math.round(vv.offsetTop));
    const key = `${h}|${top}|${kb}`;
    if (key === last) return;      // 같으면 아무것도 안 바꿈 (불필요한 다시 그리기 = 떨림)
    last = key;
    root.style.setProperty('--app-h', h + 'px');
    root.style.setProperty('--app-top', top + 'px');
    root.classList.toggle('kb', kb);  // 키보드가 떠 있음 → 입력줄 아래 안전 여백 빼기
    window.dispatchEvent(new Event('talk:fit'));
  };
  const soon = () => { if (!raf) raf = requestAnimationFrame(fit); };
  document.addEventListener('focusin', soon);
  document.addEventListener('focusout', () => setTimeout(soon, 120)); // 입력칸 사이를 옮길 때 잠깐 꺼졌다 켜지지 않게
  vv.addEventListener('resize', soon);
  vv.addEventListener('scroll', soon);
  addEventListener('orientationchange', () => { full = 0; setTimeout(soon, 300); });
  fit();
}
