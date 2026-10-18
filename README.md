# SAKi Talk

가족·친구끼리만 쓰는 광고 없는 가벼운 메신저. 휴대폰 브라우저에서 열고 **홈 화면에 추가**하면 앱처럼 씁니다.

## 처음 한 번 (관리자)

1. main 에 올라가면 GitHub Actions 가 카페24 `/www/talk/` 로 자동으로 올립니다 (`TALK_FTP_*` 시크릿 필요).
2. **올라간 뒤 24시간 안에** `https://mysaki.mycafe24.com/talk/setup.php` 를 열고 DB 정보(카페24 관리 → 나의서비스관리 → DB 정보, SAKI 와 같은 DB 여도 됨)와 관리자 이름·비밀번호를 넣습니다.
3. "설정을 마쳤어요"가 나오면 끝. `https://mysaki.mycafe24.com/talk/` 를 열면 "서버 연결됨"이 보입니다.

설정 파일(DB 비밀번호)은 웹에서 열리지 않는 `/talk-private/` 에 저장됩니다. 24시간이 지났으면 setup.php 를 다시 올린 뒤 설정하세요.

## 개발

- `npm install` → `npx vite build` (웹앱을 `server/public` 으로) → `npm test` (서버 시험, php + MariaDB 필요)
- 작업 규칙과 구조는 `CLAUDE.md`, 단계별 계획은 `docs/PLAN.md`.
