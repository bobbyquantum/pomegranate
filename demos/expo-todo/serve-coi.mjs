/**
 * Tiny static HTTP server with Cross-Origin Isolation headers.
 *
 * Serves the Expo static export (dist/) on port 19006 and adds
 * COOP + COEP headers so that SharedArrayBuffer / OPFS work —
 * which expo-sqlite's wa-sqlite Web Worker requires.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const PORT = 19006;
const DIST = resolve(import.meta.dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  // Cross-Origin Isolation headers
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

  let pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (pathname === '/') pathname = '/index.html';

  const filePath = resolve(DIST, `.${pathname}`);

  // Prevent path traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback — serve index.html for client-side routes
    try {
      const index = await readFile(resolve(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`COI static server listening on http://localhost:${PORT}`);
});
