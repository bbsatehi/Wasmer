'use strict';
// VLESS over WebSocket (TCP only) + /debug endpoint for diagnosing the Wasmer runtime.
// Env: UUID, WS_PATH (default /ws), PORT (default 8080)
const http = require('http');
const crypto = require('crypto');

const stats = { upgrades: 0, wsConn: 0, badHeader: 0, remoteOk: 0, remoteErr: 0, lastErr: '', loadErr: {} };

let net = null;
try { net = require('net'); } catch (e) { stats.loadErr.net = String(e && e.message || e); }
let WebSocketServer = null;
try { WebSocketServer = require('ws').WebSocketServer; } catch (e) { stats.loadErr.ws = String(e && e.message || e); }

const PORT = Number(process.env.PORT) || 8080;
const WS_PATH = process.env.WS_PATH || '/ws';
let UUID = (process.env.UUID || '').trim().toLowerCase();
const uuidFromEnv = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(UUID);
if (!uuidFromEnv) {
  UUID = crypto.randomUUID();
  console.log('[warn] UUID env missing/invalid. Generated: ' + UUID);
}
const UUID_BYTES = Buffer.from(UUID.replace(/-/g, ''), 'hex');

function testOutbound() {
  return new Promise((resolve) => {
    if (!net) return resolve('net module missing');
    let done = false;
    const fin = (r) => { if (!done) { done = true; try { s.destroy(); } catch (_) {} resolve(r); } };
    const s = net.connect({ host: '1.1.1.1', port: 80 }, () => fin('ok'));
    s.on('error', (e) => fin('error: ' + (e && e.message || e)));
    setTimeout(() => fin('timeout'), 4000);
  });
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0];
  if (url === '/debug') {
    const out = await testOutbound();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      node: process.version,
      versions: process.versions,
      uuidFromEnv,
      wsPath: WS_PATH,
      wsLoaded: !!WebSocketServer,
      netLoaded: !!net,
      outboundTcp: out,
      stats,
    }, null, 2));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('OK');
});

function parseHeader(buf) {
  if (buf.length < 24) return null;
  const version = buf[0];
  if (!buf.subarray(1, 17).equals(UUID_BYTES)) return null;
  const addonsLen = buf[17];
  let o = 18 + addonsLen;
  const cmd = buf[o++];
  if (cmd !== 1) return null;
  const port = buf.readUInt16BE(o); o += 2;
  const atype = buf[o++];
  let host;
  if (atype === 1) { host = Array.from(buf.subarray(o, o + 4)).join('.'); o += 4; }
  else if (atype === 2) { const len = buf[o++]; host = buf.subarray(o, o + len).toString('utf8'); o += len; }
  else if (atype === 3) {
    const p = []; for (let i = 0; i < 8; i++) p.push(buf.readUInt16BE(o + i * 2).toString(16));
    host = p.join(':'); o += 16;
  } else return null;
  return { version, host, port, payload: buf.subarray(o) };
}

if (WebSocketServer && net) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    stats.upgrades++;
    const url = (req.url || '').split('?')[0];
    if (url !== WS_PATH) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    stats.wsConn++;
    let remote = null;
    let headerDone = false;
    const cleanup = () => { if (remote) remote.destroy(); try { ws.close(); } catch (_) {} };

    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (headerDone) { if (remote && !remote.destroyed) remote.write(buf); return; }
      const h = parseHeader(buf);
      if (!h) { stats.badHeader++; ws.close(); return; }
      headerDone = true;
      let first = true;
      remote = net.connect({ host: h.host, port: h.port }, () => {
        stats.remoteOk++;
        if (h.payload.length) remote.write(h.payload);
      });
      remote.on('data', (chunk) => {
        if (ws.readyState !== 1) return;
        if (first) { first = false; ws.send(Buffer.concat([Buffer.from([h.version, 0]), chunk])); }
        else ws.send(chunk);
      });
      remote.on('error', (e) => { stats.remoteErr++; stats.lastErr = String(e && e.message || e); cleanup(); });
      remote.on('close', cleanup);
    });
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Listening on :' + PORT + ' ws=' + !!WebSocketServer + ' net=' + !!net);
});
let UUID = (process.env.UUID || 'fb3ff46a-5789-40b9-836a-ce41e0b9d23c').trim().toLowerCase();
