/* Project S.A.K.i 공통 스플래시 (웹앱·PC 런처 웹뷰 공용, 의존성 없음)
 * 쓰는 법:  <script src="saki-splash.js" data-auto></script>   ← 열자마자 자동 재생
 *      또는  SakiSplash.show({ duration: 1650, onDone() {} })    ← 원할 때 재생 (Promise 도 돌려줌)
 * 화면을 누르면 바로 넘어가고, '동작 줄이기' 설정이면 짧게 페이드만 한다. */
(function () {
  var CSS = '\
.saki-splash{position:fixed;inset:0;z-index:2147483647;background:#000;display:flex;align-items:center;justify-content:center;\
font-family:"Pretendard","Inter","Segoe UI","Apple SD Gothic Neo",system-ui,-apple-system,sans-serif;color:#fff;\
-webkit-font-smoothing:antialiased;cursor:default;user-select:none;transition:opacity .25s ease}\
.saki-splash.out{opacity:0}\
.saki-splash .sk-box{text-align:center;padding:0 16px}\
.saki-splash .sk-pre{font-size:clamp(11px,2.4vw,15px);font-weight:500;letter-spacing:.6em;text-indent:.6em;color:#ff8fbd;opacity:0;\
animation:sk-fade .6s .1s ease forwards}\
.saki-splash .sk-name{margin:.1em 0 .1em;font-size:clamp(44px,13vw,104px);font-weight:200;line-height:1;white-space:nowrap;display:flex;justify-content:space-between;color:#ff8fbd}\
.saki-splash .sk-name span{display:inline-block;opacity:0;animation:sk-rise .55s cubic-bezier(.2,.8,.2,1) forwards}\
.saki-splash .sk-mark{display:inline-block}\
.saki-splash .sk-line{height:2px;width:100%;background:#ff5c9a;\
transform:scaleX(0);transform-origin:left center;animation:sk-line .45s .7s cubic-bezier(.6,0,.2,1) forwards}\
.saki-splash .sk-tag{margin-top:.55em;font-size:clamp(10px,2.2vw,14px);font-weight:400;letter-spacing:.12em;margin-right:-.12em;color:#ff8fbd;white-space:nowrap;clip-path:inset(0 100% 0 0);animation:sk-wipe .45s .7s cubic-bezier(.6,0,.2,1) forwards}\
.saki-splash .sk-tag b{font-weight:inherit}\
@keyframes sk-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}\
@keyframes sk-rise{from{opacity:0;transform:translateY(-.35em);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}\
@keyframes sk-pop{from{opacity:0;transform:scale(0)}to{opacity:1;transform:none}}\
@keyframes sk-line{to{transform:scaleX(1)}}\
@keyframes sk-wipe{to{clip-path:inset(0 0 0 0)}}\
@media (prefers-reduced-motion:reduce){.saki-splash *{animation-duration:.01s!important;animation-delay:0s!important}}';

  var NAME = ['S', 'A', 'K', 'i'];
  var TAG = [['S', 'ensitive'], ['A', 'I'], ['', 'of'], ['K', 'ind'], ['i', 'nteraction']];

  function show(opts) {
    opts = opts || {};
    var duration = opts.duration || 1650;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) duration = Math.min(duration, 1200);
    if (!document.getElementById('saki-splash-css')) {
      var st = document.createElement('style');
      st.id = 'saki-splash-css'; st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    var root = document.createElement('div');
    root.className = 'saki-splash';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', 'project SAKi — Sensitive AI of Kind interaction');
    var name = NAME.map(function (c, i) {
      return '<span style="animation-delay:' + (0.3 + i * 0.09).toFixed(2) + 's">' + c + '</span>';
    }).join('');
    var tag = TAG.map(function (w) { return (w[0] ? '<b>' + w[0] + '</b>' : '') + w[1]; }).join(' ');
    root.innerHTML = '<div class="sk-box"><div class="sk-pre">project</div><div class="sk-mark"><div class="sk-name">' + name +
      '</div><div class="sk-line"></div><div class="sk-tag">' + tag + '</div></div></div>';
    (document.body || document.documentElement).appendChild(root);

    return new Promise(function (resolve) {
      var ended = false, timer;
      function end() {
        if (ended) return; ended = true; clearTimeout(timer);
        root.classList.add('out');
        setTimeout(function () { root.remove(); if (opts.onDone) opts.onDone(); resolve(); }, 250);
      }
      timer = setTimeout(end, duration);
      root.addEventListener('pointerdown', end);
    });
  }

  window.SakiSplash = { show: show };
  var me = document.currentScript;
  if (me && me.hasAttribute('data-auto')) {
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', function () { show(); });
  }
})();
