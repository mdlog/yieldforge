// Production server for the built app (Railway or any Node host): static files from dist/ with an SPA
// fallback, so client-side routes like /docs or /listing/1 load index.html. No dependencies.
//   npm run build && npm start        (listens on $PORT, default 3000)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const indexHtml = path.join(root, 'index.html')
const port = Number(process.env.PORT) || 3000
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

if (!fs.existsSync(indexHtml)) {
  console.error(`No build found at ${root}. Run "npm run build" first.`)
  process.exit(1)
}

function send(res, file, immutable, head) {
  res.writeHead(200, {
    'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    // Hashed files under /assets never change; everything else is revalidated.
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  if (head) return res.end()
  fs.createReadStream(file).pipe(res)
}

http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end()
      return
    }
    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end()
      return
    }
    const file = path.join(root, path.normalize(pathname))
    if (!file.startsWith(root)) {
      res.writeHead(400).end()
      return
    }
    const head = req.method === 'HEAD'
    fs.stat(file, (err, stat) => {
      if (!err && stat.isFile()) return send(res, file, pathname.startsWith('/assets/'), head)
      // A missing file is a real 404; any other path is a client-side route.
      if (pathname.startsWith('/assets/') || path.extname(pathname)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
        return
      }
      send(res, indexHtml, false, head)
    })
  })
  .listen(port, '0.0.0.0', () => console.log(`YieldForge serving ${root} on port ${port}`))
