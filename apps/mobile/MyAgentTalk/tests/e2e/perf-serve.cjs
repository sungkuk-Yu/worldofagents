// perf-serve.cjs — A/B 실측용 정적 서버: fr-serve와 달리 프로덕션 유사 캐시 헤더를 준다.
// Netlify 실환경: 해시 번들 js/woff2 = 1년 immutable + br. 로컬은 gzip(동일 파일 무손실, A/B 공정)
// + Cache-Control: public, max-age=31536000, immutable — warm(동일 브라우저 ctx 재접속)이 실환경처럼
// HTTP 캐시 히트하도록. no-store면 warm이 매번 3.9MB를 다시 내려받아 임계(warm≤0.8s)과 무관해진다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3]);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('nf'); }
      const ext = path.extname(file);
      const imm = ext !== '.html';
      const headers = {
        'Content-Type': mime[ext] || 'application/octet-stream',
        'Cache-Control': imm ? 'public, max-age=31536000, immutable' : 'no-cache',
      };
      if (ext === '.js' && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const gz = zlib.gzipSync(buf);
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
        res.writeHead(200, headers); res.end(gz); return;
      }
      res.writeHead(200, headers); res.end(buf);
    });
  } catch { res.writeHead(500); res.end(); }
}).listen(port, '127.0.0.1', () => console.log('perf-serve ' + root + ' :' + port));
