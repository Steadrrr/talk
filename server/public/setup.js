// 관리 화면 스크립트 (CSP 때문에 setup.php 안에 스크립트를 못 넣어 따로 둠)

// data-copy 단추를 누르면 그 글을 복사 (클립보드 API, 안 되면 execCommand)
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-copy]');
  if (!b) return;
  const text = b.dataset.copy;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { ok = document.execCommand('copy'); } catch {}
    t.remove();
  }
  const label = b.dataset.label || (b.dataset.label = b.textContent);
  b.textContent = ok ? '복사했어요' : '복사 못 했어요';
  clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = label; }, 1500);
});

// 접었다 펴는 메뉴: 단추를 눌러 페이지가 새로 열려도 펴 둔 메뉴는 그대로 펴 둔다
const KEY = 'talk-admin-open';
let open = [];
try { open = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch {}
for (const d of document.querySelectorAll('details.menu[id]')) {
  if (open.includes(d.id)) d.open = true;
  d.addEventListener('toggle', () => {
    const ids = [...document.querySelectorAll('details.menu[id]')].filter((x) => x.open).map((x) => x.id);
    try { sessionStorage.setItem(KEY, JSON.stringify(ids)); } catch {}
  });
}
