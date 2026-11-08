# SAKi Talk

가족·친구끼리만 쓰는 광고 없는 가벼운 메신저. 휴대폰 브라우저에서 열고 **홈 화면에 추가**하면 앱처럼 씁니다.

## 처음 한 번 (관리자)

1. main 에 올라가면 GitHub Actions 가 자동으로 올립니다.
   - Lightsail(`https://talk.projectsaki.com/`, 웹 폴더 `/srv/talk/www`): `TALK_SSH_HOST`·`TALK_SSH_USER`·`TALK_SSH_KEY`·`TALK_SSH_KNOWN_HOSTS` 시크릿 → rsync. 저장소 변수 `TALK_SERVER_URL`.
   - 카페24(`/www/talk/`): `TALK_FTP_*` 시크릿 → FTP. 둘 다 있으면 둘 다 올립니다(옮기는 동안).
2. **올라간 뒤 24시간 안에** `https://talk.projectsaki.com/setup.php` 를 열고 DB 정보(카페24 는 `https://mysaki.mycafe24.com/talk/setup.php`, 카페24 관리 → 나의서비스관리 → DB 정보)와 관리자 이름·비밀번호를 넣습니다.
3. "설정을 마쳤어요"가 나오면 끝. `https://talk.projectsaki.com/` 를 열면 "서버 연결됨"이 보입니다.

설정 파일(DB 비밀번호)과 사진·영상은 웹 폴더 한 단계 위의 `talk-private/` 에 저장됩니다 (Lightsail: `/srv/talk/talk-private`). 사키(SAKi Lite) 주소는 관리 화면 → 사키 → "SAKi Lite 주소"에서 바꿉니다 (설정 칸 `saki_lite_url`). 초대 링크·안내서·사키가 보내는 사용법 링크는 어느 주소로 관리 화면을 열어도 `https://talk.projectsaki.com/` 로 나갑니다 (바꾸려면 설정 파일에 `public_url`, 기본값은 `lib/core.php` 의 `TALK_PUBLIC_URL`). 24시간이 지났으면 setup.php 를 다시 올린 뒤 설정하세요.

## 개발

- `npm install` → `npx vite build` (웹앱을 `server/public` 으로) → `npm test` (서버 시험, php + MariaDB 필요)
- 작업 규칙과 구조는 `CLAUDE.md`, 단계별 계획은 `docs/PLAN.md`.
