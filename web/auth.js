// 로그인·가입 화면. 초대 링크(#invite=코드)로 열면 가입 화면에 코드가 채워져 있다
import { useEffect, useState } from 'preact/hooks';
import { html } from './html.js';
import { api, setToken } from './api.js';

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return '아이폰';
  if (/iPad/.test(ua)) return '아이패드';
  if (/Android/.test(ua)) return '안드로이드';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Mac/.test(ua)) return 'Mac';
  return '브라우저';
}

// 이 기기의 고정 번호: 다시 로그인해도 관리 화면에 기기가 쌓이지 않고 예전 줄을 바꿔 쓴다
function deviceKey() {
  try {
    let k = localStorage.getItem('talk.deviceKey');
    if (!/^[0-9a-f]{32}$/.test(k || '')) {
      k = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('talk.deviceKey', k);
    }
    return k;
  } catch { return ''; }
}

export function inviteFromHash() {
  const m = location.hash.match(/invite=([A-Za-z0-9-]+)/);
  return m ? m[1].toUpperCase() : '';
}

// 아이디 저장·자동 로그인 선택은 이 기기에 기억한다 (처음엔 둘 다 켜짐)
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } };

export function Auth({ onDone }) {
  const [invite, setInvite] = useState(inviteFromHash());
  const [mode, setMode] = useState(invite ? 'register' : 'login');
  const [saveId, setSaveId] = useState(pref('talk.saveId', '1') === '1');
  const [auto, setAuto] = useState(pref('talk.autoLogin', '1') === '1');
  const [name, setName] = useState(saveId ? pref('talk.savedId', '') : '');
  const [nick, setNick] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [group, setGroup] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGroup('');
    if (mode !== 'register' || invite.replace(/[^A-Z0-9]/gi, '').length !== 8) return;
    api('auth/invite', { invite }).then((r) => { setGroup(r.group); setErr(''); }).catch((e) => setErr(e.message));
  }, [invite, mode]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (mode === 'register' && pw !== pw2) { setErr('비밀번호 두 칸이 서로 달라요.'); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), password: pw, device: deviceName(), device_key: deviceKey() };
      const r = mode === 'login' ? await api('auth/login', body) : await api('auth/register', { ...body, nick: nick.trim(), invite });
      setToken(r.token, auto);
      setPref('talk.saveId', saveId ? '1' : '0');
      setPref('talk.autoLogin', auto ? '1' : '0');
      setPref('talk.savedId', saveId ? name.trim() : '');
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      onDone();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <main class="auth">
      <img class="logo" src="./icon-192.png" alt="" width="80" height="80" />
      <h1>SAKi Talk</h1>
      <div class="seg">
        <button class=${mode === 'login' ? 'on' : ''} onClick=${() => { setMode('login'); setErr(''); }}>로그인</button>
        <button class=${mode === 'register' ? 'on' : ''} onClick=${() => { setMode('register'); setErr(''); }}>초대받아 가입</button>
      </div>
      <form onSubmit=${submit}>
        ${mode === 'register' && html`
          <label>초대 코드
            <input value=${invite} onInput=${(e) => setInvite(e.target.value.toUpperCase())} required autocomplete="off" autocapitalize="characters" placeholder="8자리" />
          </label>
          ${group && html`<p class="ok">"${group}" 그룹에 들어가요.</p>`}`}
        <label>${mode === 'register' ? html`본명 <span class="hint">(로그인할 때 써요)</span>` : '본명'}
          <input value=${name} onInput=${(e) => setName(e.target.value)} required maxlength="20" autocomplete="username" />
        </label>
        ${mode === 'register' && html`
          <label>닉네임 <span class="hint">(채팅에 보이는 이름, 비우면 본명)</span>
            <input value=${nick} onInput=${(e) => setNick(e.target.value)} maxlength="20" autocomplete="nickname" />
          </label>`}
        <label>비밀번호
          <input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} required minlength=${mode === 'register' ? 6 : 1} autocomplete=${mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        ${mode === 'register' && html`
          <label>비밀번호 한 번 더
            <input type="password" value=${pw2} onInput=${(e) => setPw2(e.target.value)} required minlength="6" autocomplete="new-password" />
          </label>`}
        <div class="opts">
          <label class="opt"><input type="checkbox" checked=${saveId} onChange=${(e) => setSaveId(e.target.checked)} /> 아이디 저장</label>
          <label class="opt"><input type="checkbox" checked=${auto} onChange=${(e) => setAuto(e.target.checked)} /> 자동 로그인</label>
        </div>
        ${err && html`<p class="err">${err}</p>`}
        <button class="primary" type="submit" disabled=${busy}>${busy ? '잠깐만요…' : mode === 'login' ? '로그인' : '가입하기'}</button>
      </form>
      <p class="hint">자동 로그인을 켜 두면 로그아웃할 때까지 다시 묻지 않아요. 비밀번호는 휴대폰(아이폰 암호, 구글 비밀번호 관리자)이 저장하겠냐고 물어볼 때 저장하면 돼요.</p>
      ${mode === 'login' && html`<p class="hint">비밀번호를 잊었으면 관리자에게 새 비밀번호를 받아 주세요.</p>`}
    </main>
  `;
}
