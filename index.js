'use strict';
// VLESS over WebSocket (TCP only), single file.
// Env: UUID (required for stable links), WS_PATH (default /ws), PORT (default 8080)
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const WS_PATH = process.env.WS_PATH || '/ws';
let UUID = (process.env.UUID || '').trim().toLowerCase();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(UUID)) {
  UUID = crypto.randomUUID();
  console.log('[warn] UUID env missing/invalid. Generated one for this run only: ' + UUID);
  console.log('[warn] Set UUID in the environment variables to keep it stable.');
}
const UUID_BYTES = Buffer.from(UUID.replace(/-/g, ''), 'hex');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('OK');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  if (url !== WS_PATH) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function parseHeader(buf) {
  if (buf.length < 24) return null;
  const version = buf[0];
  if (!buf.subarray(1, 17).equals(UUID_BYTES)) return null;
  const addonsLen = buf[17];
  let o = 18 + addonsLen;
  const cmd = buf[o++];
  if (cmd !== 1) return null; // TCP only
  const port = buf.readUInt16BE(o); o += 2;
  const atype = buf[o++];
  let host;
  if (atype === 1) {
    host = Array.from(buf.subarray(o, o + 4)).join('.'); o += 4;
  } else if (atype === 2) {
    const len = buf[o++];
    host = buf.subarray(o, o + len).toString('utf8'); o += len;
  } else if (atype === 3) {
    const parts = [];
    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(o + i * 2).toString(16));
    host = parts.join(':'); o += 16;
  } else {
    return null;
  }
  return { version, host, port, payload: buf.subarray(o) };
}

wss.on('connection', (ws) => {
  let remote = null;
  let headerDone = false;

  const cleanup = () => {
    if (remote) remote.destroy();
    try { ws.close(); } catch (_) {}
  };

  ws.on('message', (data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (headerDone) {
      if (remote && !remote.destroyed) remote.write(buf);
      return;
    }
    const h = parseHeader(buf);
    if (!h) { ws.close(); return; }
    headerDone = true;

    let first = true;
    remote = net.connect({ host: h.host, port: h.port }, () => {
      if (h.payload.length) remote.write(h.payload);
    });
    remote.on('data', (chunk) => {
      if (ws.readyState !== 1) return;
      if (first) {
        first = false;
        ws.send(Buffer.concat([Buffer.from([h.version, 0]), chunk]));
      } else {
        ws.send(chunk);
      }
    });
    remote.on('error', cleanup);
    remote.on('close', cleanup);
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Listening on :' + PORT + ' ws path ' + WS_PATH);
});
