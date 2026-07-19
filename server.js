// GoogleBanana self-hosted server.
// - In production it serves the built static frontend from ./dist.
// - In all modes it exposes POST /proxy which forwards a chat-completions
//   request to the user-configured OpenRouter-style base URL.
//
// The API key is never stored on the server: it is passed through per request
// via the Authorization header sent by the browser (kept in localStorage).

import express from 'express'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT) || 8787
const HOST = process.env.HOST || '0.0.0.0'
const isProd = process.env.NODE_ENV === 'production'

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

const ALLOWED_PROXY_PATHS = new Set(['chat/completions', 'images'])

app.post('/proxy', async (req, res) => {
  const baseUrl = sanitizeBaseUrl(req.get('x-or-base-url'))
  const auth = req.get('authorization')

  if (!baseUrl) {
    return res.status(400).json({ error: { message: 'Missing or invalid X-OR-Base-URL header.' } })
  }
  if (!auth) {
    return res.status(401).json({ error: { message: 'Missing Authorization header. Set your API key in Settings.' } })
  }

  // Optional path override for OpenRouter Image API (`/images`) vs chat completions.
  // Defaults to chat/completions for backward compatibility.
  const rawPath = (req.get('x-or-path') || 'chat/completions').trim().replace(/^\/+/, '')
  if (!ALLOWED_PROXY_PATHS.has(rawPath)) {
    return res.status(400).json({
      error: { message: `Invalid X-OR-Path "${rawPath}". Allowed: chat/completions, images.` },
    })
  }

  const target = `${baseUrl}/${rawPath}`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: auth,
  }
  const referer = req.get('x-or-referer')
  const title = req.get('x-or-title')
  if (referer) headers['HTTP-Referer'] = referer
  if (title) headers['X-Title'] = title

  // Guard against indefinitely hanging upstream requests. Image generation can
  // take a while, so allow a generous window.
  const timeoutMs = Number(process.env.PROXY_TIMEOUT_MS) || 300000

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    res.status(upstream.status)
    const contentType = upstream.headers.get('content-type')
    if (contentType) res.set('content-type', contentType)

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res)
    } else {
      res.end()
    }
  } catch (err) {
    if (res.headersSent) {
      res.end()
      return
    }
    const message =
      err?.name === 'TimeoutError'
        ? `Upstream request timed out after ${timeoutMs}ms.`
        : `Upstream request failed: ${err?.message || String(err)}`
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

app.listen(PORT, HOST, () => {
  const mode = isProd ? 'production (serving dist/ + proxy)' : 'dev proxy'
  console.log(`GoogleBanana ${mode} listening on http://${HOST}:${PORT}`)
})
