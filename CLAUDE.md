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
- `web/` 웹앱 (Vite + Preact + htm, JSX 빌드 없음): `main.js` 시작·화면 전환, `store.js` 상태·동기화·보내기, `auth.js` 로그인·가입, `home.js` 친구·채팅 목록·설정 탭, `room.js` 채팅방, `gallery.js` 사진 묶음 콜라주·좌우로 넘기는 크게 보기·채팅방 사진 모아보기·전달, `api.js` 서버 부르기. `update.js` 새 버전 자동 새로고침(빌드마다 판 번호 → 동기화의 `app` 이 다르면 쉬는 틈에 새로고침, 로그인 유지), `notices.js` 공지사항 게시판. `links.js` 글 속 주소를 링크로(누르면 "외부로 이동합니다" 묻고 밖의 브라우저로, 아이폰 홈 화면 앱은 x-safari- 로 사파리). `capture.js` 채팅 캡쳐(시작·끝 고르기 → 그림 한 장, html2canvas-pro 는 저장할 때만 받음). `npx vite build` → `server/public/` 에 index.html·assets·sw.js 를 만든다 (빌드 결과는 git 에 넣지 않음).
- `server/public/` 카페24 에 올라가는 폴더: `api.php`(API, `/talk/api.php/<경로>`), `setup.php`(처음 설정·관리 화면), `lib/core.php`(설정·DB·표·JSON), `lib/accounts.php`(계정·기기·그룹·초대), `lib/chat.php`(방·메시지·동기화), `lib/media.php`(사진·영상·묶음·전달, 파일 하나를 여러 메시지가 같이 씀 talk_media_uses), `lib/notices.php`(공지사항: 관리자 글 + 배포 때 deploy.json 의 커밋 제목을 30분 단위로 모은 자동 글), `lib/saki.php`(단체방 "사키" 봇: SAKI 서버의 SAKi Lite 를 서버에서 서버로 부름, 열쇠는 설정 파일 saki_lite_key 에만. 사키에게 보내는 앱 기능 설명 TALK_SAKI_APP 은 기능을 바꾸면 같이 고친다).
- `scripts/server-test.mjs` 서버 시험.

## 테스트
- `npm test` (= `node scripts/server-test.mjs`) — 커밋 전 항상. php + MariaDB 필요 (멈춰 있으면 `service mariadb start`, 없으면 `apt-get install -y mariadb-server`).
- 화면 개발: `php -S 127.0.0.1:8080 -t server/public` + `npm run dev` (Vite 가 api.php 를 8080 으로 넘김).
