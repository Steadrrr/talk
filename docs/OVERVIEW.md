# SAKi Talk 소개 (다른 Claude Code 프로젝트용)

> 이 문서는 **다른 프로젝트의 Claude**(특히 Project S.A.K.i 계열)가 SAKi Talk 를 처음 볼 때 읽으라고 쓴 안내다.
> 2026-10-18 기준 (서버 15판). 이 저장소 안에서 작업한다면 `CLAUDE.md` 가 우선이다.

## 1. 한 줄 소개

**SAKi Talk** 는 가족·친구(전체 10명 이내)끼리만 쓰는 광고 없는 가벼운 메신저다. 휴대폰 브라우저로 열어 "홈 화면에 추가"하면 앱처럼 쓰는 웹앱(PWA)이고, 서버는 카페24 PHP 호스팅이다.

- 저장소: `Steadrrr/talk` (비공개), 기본 가지 `main`
- 주소: https://mysaki.mycafe24.com/talk/ (관리 화면 `…/talk/setup.php`, 설치 안내 `…/talk/guide/`)
- 관리자·주인: 일래 (GitHub `Steadrrr`). 보고·커밋 메시지는 한국어.
- 형제 프로젝트: **Project S.A.K.i** (저장소 `Steadrrr/SAKI`). 같은 카페24 계정·DB·도메인을 나눠 쓰고, 브랜드(핑크 SAKi 스플래시)를 공유한다.

## 2. SAKI 와 함께 쓰는 서버 (가장 중요)

같은 카페24 계정 위에 두 프로젝트가 있다. **서로의 파일·표를 건드리지 않는 것**이 규칙이다.

| | SAKI | SAKi Talk |
|---|---|---|
| 웹 폴더 | `/www/saki/` | `/www/talk/` |
| 비밀 설정 폴더 | (SAKI 쪽 규칙) | `/talk-private/` (웹 폴더 밖, 안 되면 `/www/talk/private/` + 접근 차단) |
| DB 표 이름 | SAKI 표 | 모두 `talk_` 로 시작 (같은 DB 를 써도 안 섞임) |
| PHP 함수 이름 | SAKI 함수 | 모두 `talk_` 로 시작 |
| 배포 시크릿 | SAKI 쪽 | `TALK_FTP_HOST`, `TALK_FTP_USER`, `TALK_FTP_PASSWORD` |

서버 조건 (두 프로젝트 공통):
- **PHP 8.1+ 와 MariaDB 만.** 상시 실행 프로세스·WebSocket·cron 없음 → 실시간은 **폴링 + Web Push** 로 흉내 낸다.
- 공유 호스팅이라 **PUT/DELETE 와 `Authorization` 헤더가 막히거나 사라질 수 있다** → 쓰기는 모두 POST, 로그인 토큰은 `X-Talk-Token` 머리.
- 디스크는 전체 **1.40GB** 를 나눠 쓴다 (2026-10-18 에 약 0.15GB 사용). 메신저 사진·영상 상한은 기본 **400MB** (관리 화면에서 바꿈). 트래픽 월 4000MB.
- 이 Claude 컨테이너에서는 `mysaki.mycafe24.com` 에 직접 접속이 안 되는 경우가 많다 → 실서버 확인은 일래에게 부탁하거나 GitHub Actions 로그를 본다.

## 3. 기술 구성

- 웹앱: **Vite + Preact + htm** (JSX 빌드 없음, 템플릿 문자열). 의존성은 `preact`, `htm`, `vite` 셋뿐.
- 서버: 순수 PHP (프레임워크·Composer 없음), PDO MariaDB. 웹 푸시도 외부 라이브러리 없이 openssl 로 직접 (SAKI 의 `webpush.php` 를 `talk_` 이름으로 옮긴 것).
- 시험: `scripts/server-test.mjs` 가 `server/public` 을 임시 `www/talk` 로 복사해 `php -S` + MariaDB 로 띄우고 API·관리 화면을 두드린다.

## 4. 폴더 구조

```
web/                      웹앱 소스 (Vite root)
  main.js                 시작·화면 전환, 처음 열 때 SAKi 스플래시
  store.js                상태·동기화(폴링)·보내기·기기 저장(IndexedDB/localStorage)
  api.js                  서버 부르기 (POST + X-Talk-Token, 사진은 octet-stream)
  auth.js / home.js / room.js / roomsettings.js / profile.js / notices.js …  화면들
  media.js                사진·영상 휴대폰에서 줄이기, 2MB 조각 업로드
  push.js / pushui.js     웹 푸시 구독·알림 켜기 화면
  update.js               새 버전 자동 새로고침
  saki-splash.js          Project S.A.K.i 공통 스플래시 (공유 파일의 복사본)
  public/                 sw.js(서비스 워커), manifest, 아이콘, guide/(설치 안내 페이지)
server/public/            카페24 /www/talk/ 에 그대로 올라가는 폴더
  api.php                 API 입구. /talk/api.php/<경로> (PATH_INFO 가 안 되면 ?r=<경로>)
  setup.php (+ setup.js)  처음 설정(올린 뒤 24시간 안) + 관리 화면
  .htaccess               목록 숨김, config-path.php·deploy.json 차단, html/sw.js no-cache
  lib/                    웹에서 직접 못 엶 (.htaccess 로 막음)
    core.php              설정 읽기, DB, 표 만들기(마이그레이션), JSON 응답
    accounts.php          계정·기기(토큰)·그룹·초대 코드
    chat.php              방·메시지·동기화·답장·반응·검색·방 공지·입력 중
    media.php             사진·영상 업로드·내려주기(Range)·자동 정리
    push.php              Web Push (VAPID + aes128gcm)
    notices.php           공지사항 게시판 (관리자 글 + 배포 자동 글)
    backup.php            관리 화면 백업 내려받기 (txt/json)
scripts/server-test.mjs   서버 시험 (npm test)
.github/workflows/deploy.yml  main → 빌드·시험·FTP 배포
docs/PLAN.md              단계별 계획과 결정 기록 (자세한 "왜"는 여기)
```

`npx vite build` 결과(`index.html`, `assets/`, `sw.js`, `build.json` 등)는 `server/public/` 에 생기지만 **git 에 넣지 않는다** (배포 때 Actions 가 만든다).

## 5. 데이터 모델 (DB 표, 모두 `talk_`)

| 표 | 내용 |
|---|---|
| `talk_meta` | 키-값: 스키마 판, VAPID 키, 알림 기록(push_log), 관리 화면 표(admin_ticket), 마지막 배포 sha(release_sha) 등 |
| `talk_users` | 사람. `name`=본명이자 로그인 아이디(서버 전체에서 하나), `nick`=채팅 표시 이름, `is_admin`, 프로필 사진(MEDIUMBLOB + 무작위 `photo_key`) |
| `talk_devices` | 로그인한 기기. 토큰은 sha256 만 저장, `device_key`(재로그인 때 같은 줄 재사용), `active_at`/`active_room`(지금 보고 있는 방) |
| `talk_login_fails` | IP 별 로그인 실패 (잠금) |
| `talk_groups`, `talk_group_members`, `talk_invites` | 그룹·소속·그룹별 초대 코드. **같은 그룹 사람끼리만 서로 보인다.** 한 사람이 여러 그룹 가능, 관리자는 모든 그룹에 자동 포함 |
| `talk_rooms`, `talk_room_members` | 방(`dm` 1:1 / `group` 여럿, 한 그룹 안), 방 사진·공지. 멤버별 `last_read_id`, `muted`, `pinned`, `typing_at` |
| `talk_messages` | 메시지. `kind` = text / photo / video / system / deleted, `client_id`(중복 전송 방지), `reply_to` |
| `talk_reactions` | 메시지마다 한 사람 이모지 하나 |
| `talk_events` | **동기화용 변경 기록** (방, 종류, 대상 번호). 30일 보관 |
| `talk_media` | 사진·영상 정보와 영상 미리보기. 파일 자체는 `<설정 폴더>/media/<무작위32자>.<확장자>` |
| `talk_push_subs` | 기기별 웹 푸시 구독 |
| `talk_notices` | 공지사항 게시판 (`admin` / `auto`) |

마이그레이션: `lib/core.php` 의 `talk_migrate()` 에 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS` 를 더하고 `TALK_SERVER_VERSION` 을 올린다. 새 판이 올라간 뒤 첫 요청에서 저절로 한 번 돈다 (`talk_meta.schema` 로 판별).

## 6. API 와 동기화

- 모든 응답은 JSON `{ok: true, …}` / `{ok: false, error: "한국어 문장"}`.
- 로그인 없이: `health`, `auth/login`, `auth/invite`, `auth/register`, `photo/<24자>`, `media/<32자>[/thumb]` (사진·영상은 `<img>`/`<video>` 가 머리를 못 붙여서 무작위 열쇠 주소로만 보호).
- 로그인 필요(`X-Talk-Token`): `me`, `sync`, `messages/send|history|search|react|delete`, `rooms/dm|create|read|prefs|rename|invite|leave|photo|notice|typing`, `media/start|chunk|thumb|finish`, `push/key|subscribe|unsubscribe|test`, `notices`, `groups/join`, `auth/password|logout`, `me/nick|photo|away`, `admin/ticket` (앱 → 관리 화면 60초짜리 입장권).

**동기화 (`sync?since=<cursor>`):** 앱은 마지막으로 받은 `talk_events` 번호를 들고 다시 묻는다. 서버는 그 뒤로 바뀐 방과 메시지만 준다 (처음이거나 기록이 정리됐으면 `full: true` 로 방마다 최근 30개). 함께 주는 것: `room_ids`(지금 들어가 있는 방 전부, 나간 방 지우기용), `groups_rev`, `typing`(보고 있는 방에서 입력 중인 사람), `app`(서버에 올라간 웹앱 판), `notice`(공지사항 최신 한 줄).
폴링 간격: 방을 보고 있으면 2초(누가 입력 중이면 1초), 목록이면 5초, 앱이 뒤로 가면 멈춤.

**웹 푸시:** 메시지를 보내면 응답을 먼저 돌려주고(`talk_after_response`) 같은 방 사람들의 기기로 보낸다. **그 방을 보고 있는 기기에는 안 보낸다** (목록 화면이면 보냄). `Urgency: high`, `TTL: 86400`. 받을 수 있는 곳은 알려진 푸시 서비스 주소만 (`TALK_PUSH_HOSTS`). 관리 화면에 최근 30건 알림 기록.

**사진·영상:** 휴대폰에서 줄인다(사진 긴 쪽 1600px WebP, 영상 60초까지·크면 480p 로 다시 만듦) → `media/start` → `media/chunk?key&offset` 2MB 조각 → `media/finish` 가 메시지를 만든다. 사진 14일·영상 3일 보관, 상한을 넘으면 오래된 것부터 지운다 (본문에 `gone`).

## 7. 배포 흐름

`main` 에 푸시 → `.github/workflows/deploy.yml`:
1. `npm install` → `npx vite build`
2. 모든 PHP `php -l` → MariaDB 띄워 `node scripts/server-test.mjs` (CI 는 DB root 가 없어 시험 계정 `talk`/`talkpass` 사용)
3. 지금 서버의 `api.php/health` 에서 올라가 있는 `sha` 를 읽어, 그 뒤 커밋 제목들을 `deploy.json` 에 넣음
4. FTP 로 `server/public/` → `/www/talk/` (바뀐 파일만, 서버에서 만든 `config-path.php`·설정 파일은 안 건드림)
5. `health` 다시 확인

시크릿: `TALK_FTP_HOST`, `TALK_FTP_USER`, `TALK_FTP_PASSWORD` (없으면 배포만 건너뜀). 변수(선택): `TALK_SERVER_URL`. **값은 절대 대화·저장소·문서에 쓰지 않는다.** DB 비밀번호는 서버의 `/talk-private/config.php` 에만 있다 (setup.php 가 만듦).

## 8. 새 버전 자동 반영과 공지사항

- 빌드마다 판 번호(`sha 앞 7자 + 시각`)를 만들어 앱 코드(`__TALK_BUILD__`), `index.html` 의 `<meta name="talk-build">`, `build.json` 에 같이 넣는다.
- 서버는 `sync` 응답의 `app` 으로 지금 판을 알려 준다. 앱(`web/update.js`)은 자기 판과 다르면 새 `index.html` 과 스크립트가 다 올라왔는지 확인한 뒤, 쓰는 중이 아닐 때 조용히 새로고침한다. 로그인은 그대로, 보던 방·탭도 다시 연다.
- 서비스 워커(`sw.js`)는 html 은 네트워크 먼저, `assets/` 는 캐시 먼저, `api.php` 는 절대 캐시 안 함.
- **공지사항:** 배포 뒤 첫 `sync` 때 `deploy.json` 의 커밋 제목들이 "업데이트: …" 자동 공지(`auto`)로 올라간다. 30분 안에 이어진 배포는 한 글로 모은다. 관리자는 관리 화면에서 글을 쓰고 고치고 지우고 푸시로 알릴 수 있다.
- 그래서 **커밋 제목은 그대로 가족에게 보이는 "바뀐 점"이 된다.** 사용자가 읽을 수 있는 한국어로, 무엇이 왜 바뀌었는지 쓴다. 문서만 고친 커밋도 `main` 에 올리면 배포와 공지가 생긴다.

## 9. SAKi 브랜드 스플래시 (`saki-splash.js`)

Project S.A.K.i 모든 앱(웹앱·PC 런처 웹뷰)이 같이 쓰는 시작 화면. 검은 바탕에 `#ff8fbd` 핑크, 가는 글씨 "SAKi" 가 위에서 내려오고 막대와 "Sensitive AI of Kind interaction" 이 왼쪽에서 오른쪽으로 함께 그려진다 (약 1.9초). 의존성 없음.

- **원본:** 이 Claude 프로젝트의 공유 폴더 `saki-brand/saki-splash.js` (미리보기 `saki-brand/preview.html`). SAKi Talk 의 `web/saki-splash.js` 는 그 복사본이다 (2026-10-18 기준 동일).
- 쓰는 법:
  ```html
  <script src="saki-splash.js" data-auto></script>        <!-- 열자마자 자동 재생 -->
  ```
  ```js
  SakiSplash.show({ duration: 1650, onDone() {} });         // 원할 때 재생, Promise 도 돌려줌
  ```
  화면을 누르면 바로 넘어가고, '동작 줄이기' 설정이면 짧게 페이드만 한다.
- SAKi Talk 에서는 `web/main.js` 가 `import './saki-splash.js'` 후, 앱을 새로 열 때(sessionStorage `talk_splash` 가 없을 때)와 새 버전 자동 새로고침 때만 띄운다.
- **바꿀 때 규칙:** 공유 원본을 먼저 고치고, 각 앱으로 같은 파일을 복사해 모두 똑같이 유지한다. 다른 저장소에서 쓰려면 원본을 복사해 가면 된다 (공유 폴더에 못 닿으면 이 저장소의 `web/saki-splash.js` 를 그대로 가져가도 같다).

## 10. 알려진 함정

- **카페24 웹 방화벽이 base64 가 든 요청 본문을 막는다.** JSON 안에 사진을 base64 로 넣어 보내면 내용에 따라 공격으로 오인해 **404** 를 돌려준다 (PHP 까지 오지도 않음). → 바이너리는 `Content-Type: application/octet-stream` 으로 그대로 보낸다 (`web/api.js` 의 Blob 처리, `api.php` 의 `$photoBody`). 이상한 404 가 나오면 이것부터 의심.
- `Authorization` 헤더가 사라지고 PUT/DELETE 가 막힐 수 있다 → `X-Talk-Token` + POST.
- **애플 푸시는 `Topic` 머리 "room1" 같은 값을 400 으로 거절했다** → 지금은 Topic 을 쓰지 않는다 (빈 값으로 호출). VAPID `sub` 는 https 주소나 mailto 여야 한다.
- 아이폰 사파리: 날짜는 `2026-10-18T12:00:00Z` 꼴로 (가운데 빈칸이면 잘못 읽음). 영상은 서버가 **Range 요청**을 받아야 재생된다. `textarea` 를 주소 칸으로 보고 연락처 자동 완성을 띄워서 메시지 입력칸은 글만 받는 편집 칸으로 바꿨다. 웹 푸시는 홈 화면에 추가한 앱에서만 된다.
- OPcache: 방금 쓴 `.php` 설정 파일을 몇 초간 예전 것으로 읽을 수 있다 → `talk_forget_cached()`.
- 관리 화면은 CSP 로 인라인 스크립트가 막혀 있다 → 스크립트는 `server/public/setup.js` 에.
- 처음 설정(`setup.php`)은 **올린 뒤 24시간 안에만** 된다 (SAKI 는 2시간). 지났으면 setup.php 를 다시 올린다.
- 이 서버 15판 전의 앱은 자동 새로고침 기능이 없어서 한 번은 강제 종료가 필요했다.

## 11. 로컬에서 돌려 보기

```bash
npm install
npx vite build            # 웹앱 → server/public
service mariadb start     # 없으면 apt-get install -y mariadb-server
npm test                  # 서버 시험 (커밋 전 항상)
# 화면 개발
php -S 127.0.0.1:8080 -t server/public   # API
npm run dev                               # Vite, api.php 를 8080 으로 넘김
```

## 12. 다른 프로젝트에서 바꿀 일이 생기면

- **SAKi Talk 저장소는 직접 고치지 말고** 일래에게 이 프로젝트(Claude 프로젝트 "S.A.K.i Talk")에서 요청하도록 하는 것이 기본이다. 여기 Claude 가 `CLAUDE.md` 규칙(한국어 커밋, `main` 직접 푸시 → 자동 배포, 덜 된 기능은 화면에 숨기기, 커밋 전 `npm test`)대로 처리한다.
- **카페24 서버를 같이 쓰므로** 한쪽의 변경이 다른 쪽에 영향을 줄 수 있다:
  - `/www/talk/`, `/talk-private/`, `talk_` 표는 SAKi Talk 것. SAKI 쪽 배포·정리 스크립트가 이것들을 지우거나 덮어쓰면 안 된다 (FTP 배포 대상 폴더를 꼭 `/www/saki/` 로 한정).
  - DB 를 공유하므로 SAKI 가 `DROP`/전체 정리를 할 때 `talk_` 표를 빼야 한다.
  - 디스크 1.40GB 를 나눠 쓴다. SAKI 가 큰 파일을 올릴 계획이면 메신저 상한(400MB)과 같이 따져야 한다.
  - `.htaccess`·PHP 설정을 계정 전체(웹 루트)에서 바꾸면 두 앱 모두 영향받는다.
- **공유 브랜드**(스플래시·색 `#ff8fbd`/`#ff5c9a`)를 바꾸면 공유 원본을 고치고 각 앱에 복사한다 (위 9절).
- **웹 푸시 코드**는 SAKI `server/public/lib/webpush.php` 에서 왔다. 한쪽에서 애플·안드로이드 관련 버그를 고치면 다른 쪽에도 같은 고침이 필요한지 확인한다.
- 비밀번호·FTP·DB 정보는 어느 프로젝트에서도 대화나 저장소에 넣지 않는다.
