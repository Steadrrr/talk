import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 웹앱: web → server/public (카페24 /www/talk/ 에 PHP 와 같이 올림)
// server/public 에는 PHP 파일이 같이 있으므로 폴더를 통째로 비우지 않고, 지난 빌드의 assets/ 만 지운다.
const OUT = path.resolve('server/public');
// 빌드마다 새 판 번호: 앱 코드(__TALK_BUILD__)·index.html(meta talk-build)·build.json(서버가 동기화 때 알려 줌)에 같이 넣는다.
// 앱은 서버 판이 자기와 다르면 스스로 새로고침한다 (web/update.js)
const BUILD = (process.env.GITHUB_SHA || '').slice(0, 7) + Date.now().toString(36);
export default defineConfig({
  root: 'web',
  base: './',
  define: { __TALK_BUILD__: JSON.stringify(process.argv.includes('build') ? BUILD : 'dev') },
  build: { outDir: OUT, emptyOutDir: false },
  server: {
    // 개발 중에는 api.php 를 php -S 로 띄운 서버(8080)로 넘긴다: php -S 127.0.0.1:8080 -t server/public
    proxy: { '/api.php': 'http://127.0.0.1:8080' },
  },
  plugins: [{
    name: 'talk-clean-assets',
    buildStart() { fs.rmSync(path.join(OUT, 'assets'), { recursive: true, force: true }); },
  }, {
    name: 'talk-build-stamp',
    apply: 'build',
    transformIndexHtml: (h) => h.replace('</head>', `  <meta name="talk-build" content="${BUILD}">\n</head>`),
    closeBundle() { fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify({ build: BUILD })); },
  }],
});
