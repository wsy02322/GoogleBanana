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
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { createJobStore } from './jobs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT) || 8787
const HOST = process.env.HOST || '0.0.0.0'
const isProd = process.env.NODE_ENV === 'production'

/** Allowed relative paths under the OpenRouter-style base URL. */
const ALLOWED_PATHS = new Set(['chat/completions', 'images'])

/**
 * Whitespace keep-alive while waiting for upstream.
 * Mobile carrier NATs often drop idle TCP before GPT Pro Thinking finishes;
 * keep this under ~15s. Do NOT emit heartbeats after JSON bytes start —
 * padding is only safe as a leading prefix (client strips it).
 */
const HEARTBEAT_MS = Number(process.env.PROXY_HEARTBEAT_MS) || 8_000

const app = express()
app.use(express.json({ limit: '50mb' }))

const jobStore = createJobStore(__dirname)

app.get('/healthz', (_req, res) =>
  res.json({ ok: true, jobCacheMax: jobStore.maxJobs }),
)

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
  req.socket?.setKeepAlive?.(true, Math.min(HEARTBEAT_MS, 15_000))
  req.socket?.setTimeout?.(socketMs)
  res.setTimeout(socketMs)
}

/** Begin a chunked JSON response and emit leading padding until upstream body starts. */
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
    if (!res.writableEnded && !res.destroyed) {
      try {
        res.write(' ')
      } catch {
        clearInterval(interval)
      }
    }
  }, HEARTBEAT_MS)

  return () => clearInterval(interval)
}

/** Write with backpressure so large image JSON does not reset mid-flush. */
async function writeChunk(res, chunk) {
  if (res.writableEnded || res.destroyed) {
    throw new Error('Client connection closed while sending image response')
  }
  const ok = res.write(chunk)
  if (!ok) await once(res, 'drain')
}

/**
 * Stream upstream bytes to the browser as they arrive.
 * Heartbeat runs only until the first upstream body byte (leading spaces only).
 */
async function forwardUpstreamBody(upstream, res, stopHeartbeat) {
  let stopped = false
  const stopHb = () => {
    if (!stopped) {
      stopped = true
      stopHeartbeat()
    }
  }

  if (!upstream.body || typeof upstream.body.getReader !== 'function') {
    const buf = Buffer.from(await upstream.arrayBuffer())
    stopHb()
    if (buf.length > 0) await writeChunk(res, buf)
    return buf.length
  }

  const reader = upstream.body.getReader()
  let total = 0
  let started = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      if (!started) {
        // Stop whitespace padding before any upstream payload bytes.
        stopHb()
        started = true
      }
      total += value.byteLength
      await writeChunk(res, Buffer.from(value))
    }
  } finally {
    stopHb()
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
  return total
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

  res.on('error', (err) => {
    console.warn('[proxy] client response error:', err?.message || err)
  })

  const startedAt = Date.now()
  let stopHeartbeat = null
  try {
    stopHeartbeat = startProxyKeepAlive(res)

    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    const bytes = await forwardUpstreamBody(upstream, res, stopHeartbeat)
    stopHeartbeat = null

    const elapsedMs = Date.now() - startedAt
    if (!upstream.ok) {
      console.warn(
        `[proxy] upstream HTTP ${upstream.status} (${bytes} bytes, ${elapsedMs}ms) → ${target}`,
      )
    } else {
      console.log(`[proxy] upstream OK (${bytes} bytes, ${elapsedMs}ms) → ${target}`)
    }

    if (!res.writableEnded) res.end()
  } catch (err) {
    if (stopHeartbeat) stopHeartbeat()
    console.error('[proxy]', err?.name || 'Error', err?.message || err)

    const message =
      err?.name === 'TimeoutError' || err?.cause?.name === 'TimeoutError'
        ? `Upstream request timed out after ${timeoutMs}ms. Image generation can take several minutes — try 1K size or raise PROXY_TIMEOUT_MS.`
        : /Client connection closed/i.test(String(err?.message || ''))
          ? 'Browser connection closed before the image finished downloading. Keep this tab open and retry on a more stable network (Wi‑Fi helps).'
          : `Upstream request failed: ${err?.message || String(err)}`

    if (res.headersSent) {
      try {
        if (!res.writableEnded) {
          res.write(JSON.stringify({ error: { message } }))
          res.end()
        }
      } catch {
        // ignore double-end
      }
      return
    }
    res.status(502).json({ error: { message } })
  }
})

/**
 * Async generation jobs (two-phase so the browser can bookmark the job id
 * before uploading a large body / before OpenRouter starts):
 *   POST /jobs              → { id, claimToken, status: "accepted" }
 *   POST /jobs/:id/run      → starts upstream work (requires claim token)
 *   GET  /jobs/:id          → status + result when done (requires claim token)
 *
 * Keeps only the newest JOB_CACHE_MAX (default 10) results on disk.
 * API keys stay in memory for the running job only.
 */
app.post('/jobs', (_req, res) => {
  const job = jobStore.acceptJob()
  res.status(202).json(job)
})

app.post('/jobs/:id/run', (req, res) => {
  const baseUrl = sanitizeBaseUrl(req.get('x-or-base-url'))
  const auth = req.get('authorization')
  const apiPath = sanitizePath(req.get('x-or-path'))
  const claimToken = req.get('x-job-claim-token') || req.body?.claimToken

  if (!baseUrl) {
    return res.status(400).json({ error: { message: 'Missing or invalid X-OR-Base-URL header.' } })
  }
  if (!auth) {
    return res.status(401).json({
      error: { message: 'Missing Authorization header. Set your API key in Settings.' },
    })
  }
  if (!apiPath) {
    return res.status(400).json({
      error: { message: `Invalid X-OR-Path. Allowed: ${[...ALLOWED_PATHS].join(', ')}` },
    })
  }
  if (!claimToken || typeof claimToken !== 'string') {
    return res.status(401).json({ error: { message: 'Missing X-Job-Claim-Token header.' } })
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: auth,
  }
  const referer = req.get('x-or-referer')
  const title = req.get('x-or-title')
  if (referer) headers['HTTP-Referer'] = referer
  if (title) headers['X-Title'] = title

  // Strip claimToken from upstream body if the client nested it there.
  const body = { ...(req.body || {}) }
  delete body.claimToken

  const timeoutMs = Number(process.env.PROXY_TIMEOUT_MS) || 600000
  const started = jobStore.startJob(req.params.id, claimToken, {
    target: `${baseUrl}/${apiPath}`,
    apiPath,
    headers,
    body,
    timeoutMs,
  })

  if (started.error === 'not_found') {
    return res.status(404).json({
      error: {
        message:
          'Job not found. The server only keeps the newest 10 results; this one may have expired.',
      },
    })
  }
  if (started.error === 'forbidden') {
    return res.status(403).json({ error: { message: 'Invalid job claim token.' } })
  }
  if (started.error === 'conflict') {
    return res.status(409).json(started.job)
  }

  res.status(202).json(started.job)
})

app.get('/jobs/:id', (req, res) => {
  const claimToken = req.get('x-job-claim-token') || req.query.claimToken
  if (!claimToken || typeof claimToken !== 'string') {
    return res.status(401).json({ error: { message: 'Missing X-Job-Claim-Token header.' } })
  }

  const got = jobStore.getJob(req.params.id, claimToken, { includeData: true })
  if (got.error === 'not_found') {
    return res.status(404).json({
      error: {
        message:
          'Job not found. The server only keeps the newest 10 results; this one may have expired.',
      },
    })
  }
  if (got.error === 'forbidden') {
    return res.status(403).json({ error: { message: 'Invalid job claim token.' } })
  }
  res.json(got.job)
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
  console.log(`[jobs] cache dir ${jobStore.jobsDir} (max ${jobStore.maxJobs})`)
})

// Long image jobs (GPT Direct / Pro Thinking) can run several minutes end-to-end.
server.keepAliveTimeout = 650_000
server.headersTimeout = 650_000
if (typeof server.requestTimeout === 'number') server.requestTimeout = 650_000
