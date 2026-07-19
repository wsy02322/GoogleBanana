// GoogleBanana self-hosted server.
// - In production it serves the built static frontend from ./dist.
// - In all modes it exposes POST /proxy which forwards a request to the
//   user-configured OpenRouter-style base URL.
//
// Default upstream path is /chat/completions. Clients may override via the
// X-OR-Path header (e.g. "images" for OpenRouter's dedicated Image API).
//
// The API key is never stored on the server: it is passed through per request
// via the Authorization header sent by the browser (kept in localStorage).

import express from 'express'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT) || 8787
const HOST = process.env.HOST || '0.0.0.0'
const isProd = process.env.NODE_ENV === 'production'

/** Allowed relative paths under the OpenRouter-style base URL. */
const ALLOWED_PATHS = new Set(['chat/completions', 'images'])

/** Send whitespace over chunked encoding so mobile networks don't drop idle waits. */
const HEARTBEAT_MS = 15_000

const app = express()
app.use(express.json({ limit: '50mb' }))

app.get('/healthz', (_req, res) => res.json({ ok: true }))

function sanitizeBaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return null
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // Strip a trailing slash for consistent joining.
  return url.toString().replace(/\/+$/, '')
}

function sanitizePath(raw) {
  const fallback = 'chat/completions'
  if (!raw || typeof raw !== 'string') return fallback
  const cleaned = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return ALLOWED_PATHS.has(cleaned) ? cleaned : null
}

function armSocketTimeouts(req, res, timeoutMs) {
  const socketMs = timeoutMs + 60_000
  req.socket?.setKeepAlive?.(true, HEARTBEAT_MS)
  req.socket?.setTimeout?.(socketMs)
  res.setTimeout(socketMs)
}

/** Begin a chunked JSON response and emit padding until upstream finishes. */
function startProxyKeepAlive(res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Connection', 'close')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  // First byte immediately so proxies see an active response (GPT can take 2+ min).
  res.write(' ')

  const interval = setInterval(() => {
    if (!res.writableEnded) res.write(' ')
  }, HEARTBEAT_MS)

  return () => clearInterval(interval)
}

app.post('/proxy', async (req, res) => {
  const baseUrl = sanitizeBaseUrl(req.get('x-or-base-url'))
  const auth = req.get('authorization')
  const apiPath = sanitizePath(req.get('x-or-path'))

  if (!baseUrl) {
    return res.status(400).json({ error: { message: 'Missing or invalid X-OR-Base-URL header.' } })
  }
  if (!auth) {
    return res.status(401).json({ error: { message: 'Missing Authorization header. Set your API key in Settings.' } })
  }
  if (!apiPath) {
    return res.status(400).json({
      error: { message: `Invalid X-OR-Path. Allowed: ${[...ALLOWED_PATHS].join(', ')}` },
    })
  }

  const target = `${baseUrl}/${apiPath}`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: auth,
  }
  const referer = req.get('x-or-referer')
  const title = req.get('x-or-title')
  if (referer) headers['HTTP-Referer'] = referer
  if (title) headers['X-Title'] = title

  const timeoutMs = Number(process.env.PROXY_TIMEOUT_MS) || 600000
  armSocketTimeouts(req, res, timeoutMs)

  let stopHeartbeat = null
  try {
    stopHeartbeat = startProxyKeepAlive(res)

    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    const buf = Buffer.from(await upstream.arrayBuffer())
    stopHeartbeat()
    stopHeartbeat = null

    if (!upstream.ok) {
      console.warn(`[proxy] upstream HTTP ${upstream.status} (${buf.length} bytes) → ${target}`)
    } else {
      console.log(`[proxy] upstream OK (${buf.length} bytes) → ${target}`)
    }

    res.write(buf)
    res.end()
  } catch (err) {
    if (stopHeartbeat) stopHeartbeat()
    console.error('[proxy]', err?.name || 'Error', err?.message || err)

    const message =
      err?.name === 'TimeoutError' || err?.cause?.name === 'TimeoutError'
        ? `Upstream request timed out after ${timeoutMs}ms. Image generation can take several minutes — try 1K size or raise PROXY_TIMEOUT_MS.`
        : `Upstream request failed: ${err?.message || String(err)}`

    if (res.headersSent) {
      try {
        res.write(JSON.stringify({ error: { message } }))
        res.end()
      } catch {
        // ignore double-end
      }
      return
    }
    res.status(502).json({ error: { message } })
  }
})

if (isProd) {
  const distDir = path.join(__dirname, 'dist')
  if (!fs.existsSync(distDir)) {
    console.error('dist/ not found. Run "npm run build" before "npm start".')
    process.exit(1)
  }
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

const server = app.listen(PORT, HOST, () => {
  const mode = isProd ? 'production (serving dist/ + proxy)' : 'dev proxy'
  console.log(`GoogleBanana ${mode} listening on http://${HOST}:${PORT}`)
})

// Long image jobs (GPT Direct / Pro Thinking) can run several minutes end-to-end.
server.keepAliveTimeout = 650_000
server.headersTimeout = 650_000
if (typeof server.requestTimeout === 'number') server.requestTimeout = 650_000
