// racey_proxy_t5058e15f.cjs — t_5058e15f 회귀용 단일 오리진 서빙 + 레이시 주입 프록시
//   GET /*(정적) → DIST 서빙 | GET /api|/health → 백엔드(3079) 포워드(첫 3연 REFRESH_DELAY_MS 지연)
//   GET /state → 카운터(JSON) | POST /park-ws → 이후 /ws 업그레이드 PARK_MS 주차(=talk.ready false 창)
//   POST /release-ws → 주차 즉시 방출. 정적+API+WS가 한 오리진(8147)이라 CORS 무관.
// 실행: EXPO_DIST=dist-t5058e15f node tests/e2e/racey_proxy_t5058e15f.cjs (백엔드 기동 후)
const http = require('http');
const fs = require('fs');
const path = require('path');

const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3079);
const PORT = Number(process.env.PROXY_PORT || 8147);
const DELAY_MS = Number(process.env.REFRESH_DELAY_MS || 2500);
const PARK_MS = Number(process.env.PARK_WS_MS || 15000);
const DIST = path.resolve(__dirname, '..', '..', process.env.EXPO_DIST || 'dist-t5058e15f');

const state = { postAgents: 0, delayed: 0, wsUpgrades: 0, wsParked: 0, wsReleased: 0 };
let remainingDelays = 3; // health → (agents ∥ sessions) 첫 왕복
let parkMode = false;
const parked = [];

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.map': 'application/json' };

function forwardHttp(req, res, body) {
  const p = http.request(
    { host: '127.0.0.1', port: BACKEND_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` } },
    (pr) => { res.writeHead(pr.statusCode || 502, pr.headers); pr.pipe(res); },
  );
  p.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"ok":false,"error":"proxy"}'); });
  if (body && body.length) p.write(body);
  p.end();
}

function serveStatic(p, res) {
  const file = path.join(DIST, p === '/' ? 'index.html' : p);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { // SPA 폴백
      fs.readFile(path.join(DIST, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); return res.end('nf'); }
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(b2);
      });
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}

function releaseParked() {
  state.wsReleased += parked.length;
  const q = parked.splice(0);
  q.forEach((item) => tunnel(item.req, item.socket, item.head));
}

// WS 업그레이드 터널: 요청 라인+헤더를 재직렬화해 백엔드에 재전송 후 바이트 양방향 계류.
// (서버가 upgrade를 파싱한 시점에 원 요청 헤더는 소켓에서 소비됨 — raw pipe는 무효)
function tunnel(req, socket, head) {
  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const k = req.rawHeaders[i];
    lines.push(`${k}: ${k.toLowerCase() === 'host' ? `127.0.0.1:${BACKEND_PORT}` : req.rawHeaders[i + 1]}`);
  }
  const up = require('net').connect(BACKEND_PORT, '127.0.0.1', () => {
    up.write(Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1'));
    if (head && head.length) up.write(head);
    socket.pipe(up); up.pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
  socket.on('close', () => up.destroy());
}

const server = http.createServer((req, res) => {
  const p = (req.url || '').split('?')[0];
  if (p === '/state') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(state)); }
  if (p === '/reset' && req.method === 'POST') { Object.keys(state).forEach((k) => { state[k] = 0; }); remainingDelays = 3; parkMode = false; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(state)); }
  if (p === '/park-ws' && req.method === 'POST') { parkMode = true; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(state)); }
  if (p === '/release-ws' && req.method === 'POST') { releaseParked(); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(state)); }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.method === 'POST' && p === '/api/agents') state.postAgents++;
    const apiish = p === '/health' || p.startsWith('/api/');
    if (!apiish) return serveStatic(p === '/state' ? '/index.html' : p, res);
    if (remainingDelays > 0 && req.method === 'GET' && (p === '/health' || p === '/api/agents' || p === '/api/sessions')) {
      remainingDelays--; state.delayed++;
      return setTimeout(() => forwardHttp(req, res, body), DELAY_MS);
    }
    forwardHttp(req, res, body);
  });
});

server.on('upgrade', (req, socket, head) => {
  const p = (req.url || '').split('?')[0];
  if (!p.startsWith('/ws')) { socket.destroy(); return; }
  state.wsUpgrades++;
  if (parkMode) {
    parkMode = false; // 일회성: park 요청 후 첫 업그레이드만 주차 — 이후 연결은 정상 터널
    state.wsParked++;
    const item = { req, socket, head };
    parked.push(item);
    setTimeout(() => { const i = parked.indexOf(item); if (i >= 0) { parked.splice(i, 1); state.wsReleased++; tunnel(req, socket, head); } }, PARK_MS);
    return;
  }
  tunnel(req, socket, head);
});

server.listen(PORT, '127.0.0.1', () => console.log(`racey proxy :${PORT} static=${DIST} → backend :${BACKEND_PORT} (refresh ${DELAY_MS}ms×3, ws park ${PARK_MS}ms)`));
