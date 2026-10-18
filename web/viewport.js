// 휴대폰 키보드: 아이폰은 키보드가 올라오면 화면 크기는 그대로 두고 화면 전체를 위로 밀어 올려서
// 채팅방 위쪽·대화가 가려졌다. 실제로 보이는 높이(visualViewport)에 앱 높이를 맞추고 밀린 것은 되돌린다.
export function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const fit = () => {
    root.style.setProperty('--app-h', Math.round(vv.height) + 'px');
    root.classList.toggle('kb', window.innerHeight - vv.height > 120); // 키보드가 떠 있음 → 아래 안전 여백 빼기
    if (window.scrollY || vv.offsetTop) window.scrollTo(0, 0);
    window.dispatchEvent(new Event('talk:fit'));
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}
