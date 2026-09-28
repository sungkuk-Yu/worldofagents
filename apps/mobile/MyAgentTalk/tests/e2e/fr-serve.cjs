// fr-serve.cjs — minimal static server (python http.server hangs under concurrent playwright keep-alives; node keeps each req non-blocking)
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.cwd(), process.argv[2] || 'dist-frbase');
const port = Number(process.argv[3] || 8113);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  } catch { res.writeHead(500); res.end(); }
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on ' + port));
