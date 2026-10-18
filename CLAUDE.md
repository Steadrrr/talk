# SAKi Talk — Claude Code 작업 안내 (새 세션은 이것부터)

가족·친구(전체 10명 이내)끼리만 쓰는 광고 없는 가벼운 메신저. 웹앱(PWA) + 카페24 PHP 서버.
Project S.A.K.I(저장소 Steadrrr/SAKI)의 카페24 호스팅을 같이 쓴다: SAKI 는 `/www/saki/`, 메신저는 `/www/talk/` (https://mysaki.mycafe24.com/talk/).
사용자 호칭: 일래 (관리자). **계획은 `docs/PLAN.md`** — 지금 하는 단계만 읽고, 단계를 마치면 진행 표시를 고친다.

## 작업 규칙
- 보고는 한국어로 짧게. 커밋 메시지도 한국어로 무엇이 왜 바뀌었는지. 모델 이름은 커밋에 넣지 않기.
- main 에 바로 커밋·푸시 (SAKI 와 같은 방식). main 에 올라가면 GitHub Actions 가 시험 후 카페24 로 자동 배포.
- 덜 된 기능이 사용자 화면에 보이면 안 됨: 단계 안에서 끝까지 만든 뒤 올리거나, 화면에서 숨긴 채로 올린다.
- SAKI 와 섞지 않기: DB 표는 모두 `talk_` 로 시작, 설정 파일은 `/talk-private/`, 함수 이름은 `talk_`. SAKI 의 파일·표는 건드리지 않는다.
- 서버 조건: PHP 8.1+ 와 MariaDB 만. 상시 실행 프로세스·WebSocket·cron 없음 → 폴링 + Web Push. PUT/DELETE·Authorization 헤더 대신 POST + `X-Talk-Token`.
- 디스크: 카페24 전체 1.40GB 를 SAKI 와 나눠 씀. 메신저 사진·영상 상한 기본 400MB (관리 화면에서 바꿈). 압축은 휴대폰에서.
- 그룹: 일래가 그룹을 만들고 그룹별 초대 코드 → 같은 그룹끼리만 보임. 한 사람이 여러 그룹 가능.
- 비밀번호·FTP·DB 정보를 대화나 저장소에 절대 넣지 않기.

## 구조
- `web/` 웹앱 (Vite + Preact + htm, JSX 빌드 없음): `main.js` 시작·화면 전환, `store.js` 상태·동기화·보내기, `auth.js` 로그인·가입, `home.js` 친구·채팅 목록·설정 탭, `room.js` 채팅방, `api.js` 서버 부르기. `npx vite build` → `server/public/` 에 index.html·assets·sw.js 를 만든다 (빌드 결과는 git 에 넣지 않음).
- `server/public/` 카페24 에 올라가는 폴더: `api.php`(API, `/talk/api.php/<경로>`), `setup.php`(처음 설정·관리 화면), `lib/core.php`(설정·DB·표·JSON), `lib/accounts.php`(계정·기기·그룹·초대), `lib/chat.php`(방·메시지·동기화).
- `scripts/server-test.mjs` 서버 시험.

## 테스트
- `npm test` (= `node scripts/server-test.mjs`) — 커밋 전 항상. php + MariaDB 필요 (멈춰 있으면 `service mariadb start`, 없으면 `apt-get install -y mariadb-server`).
- 화면 개발: `php -S 127.0.0.1:8080 -t server/public` + `npm run dev` (Vite 가 api.php 를 8080 으로 넘김).
