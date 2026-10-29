/**
 * Simple static file server for the pre-built frontend.
 * Serves client/dist on port 7001 (or PORT env var).
 * Handles SPA routing — all unknown paths return index.html.
 * No vite, no npm install needed.
 */
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT    = parseInt(process.env.FRONTEND_PORT || '7001');
const DIST    = path.join(__dirname, 'client', 'dist');

const MIME = {
  '.html' : 'text/html; charset=utf-8',
  '.js'   : 'application/javascript',
  '.mjs'  : 'application/javascript',
  '.css'  : 'text/css',
  '.json' : 'application/json',
  '.png'  : 'image/png',
  '.jpg'  : 'image/jpeg',
  '.jpeg' : 'image/jpeg',
  '.gif'  : 'image/gif',
  '.svg'  : 'image/svg+xml',
  '.ico'  : 'image/x-icon',
  '.woff' : 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf'  : 'font/ttf',
  '.webp' : 'image/webp',
  '.mp4'  : 'video/mp4',
  '.webm' : 'video/webm',
};

const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url);
  let   filePath = path.join(DIST, parsed.pathname);

  // Prevent path traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  // Directory → try index.html inside it
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // File not found → SPA fallback (return root index.html)
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST, 'index.html');
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  // Cache headers for assets
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`);
  if (isAsset) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }

  res.setHeader('Content-Type', mime);
  res.setHeader('Access-Control-Allow-Origin', '*');

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  PRIMESTACK POS — Frontend Static Server             ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  URL      : http://0.0.0.0:${PORT}                      ║`);
  console.log(`║  Serving  : ${DIST.split('\\').slice(-3).join('/')}  ║`);
  console.log('║  SPA mode : YES (all routes → index.html)            ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  POS Dashboard  → http://localhost:${PORT}/overview`);
  console.log(`  Vault Bank     → http://localhost:${PORT}/vault-bank`);
  console.log('');
});

server.on('error', (e) => {
  console.error('Frontend server error:', e.message);
  process.exit(1);
});
