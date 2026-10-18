import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 웹앱: web → server/public (카페24 /www/talk/ 에 PHP 와 같이 올림)
// server/public 에는 PHP 파일이 같이 있으므로 폴더를 통째로 비우지 않고, 지난 빌드의 assets/ 만 지운다.
const OUT = path.resolve('server/public');
export default defineConfig({
  root: 'web',
  base: './',
  build: { outDir: OUT, emptyOutDir: false },
  server: {
    // 개발 중에는 api.php 를 php -S 로 띄운 서버(8080)로 넘긴다: php -S 127.0.0.1:8080 -t server/public
    proxy: { '/api.php': 'http://127.0.0.1:8080' },
  },
  plugins: [{
    name: 'talk-clean-assets',
    buildStart() { fs.rmSync(path.join(OUT, 'assets'), { recursive: true, force: true }); },
  }],
});
