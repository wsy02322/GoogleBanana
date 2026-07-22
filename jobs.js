import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'

const MAX_JOBS = Number(process.env.JOB_CACHE_MAX) || 10
const TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS) || 600_000

function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  try {
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

/**
 * Minimal in-process job cache:
 * - API key is used only in memory while the job runs (never written to disk)
 * - Claim tokens are required to read results (capability URL style)
 * - Upstream JSON result is stored on disk
 * - Only the newest MAX_JOBS jobs are retained
 */
export function createJobStore(rootDir) {
  const jobsDir = path.join(rootDir, 'data', 'jobs')
  fs.mkdirSync(jobsDir, { recursive: true })

  /** @type {Map<string, object>} */
  const jobs = new Map()

  function metaPath(id) {
    return path.join(jobsDir, `${id}.meta.json`)
  }

  function resultPath(id) {
    return path.join(jobsDir, `${id}.result.json`)
  }

  function writeMeta(job) {
    const safe = {
      id: job.id,
      status: job.status,
      apiPath: job.apiPath,
      target: job.target,
      timeoutMs: job.timeoutMs,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      // Capability token — required to reclaim results after tab close.
      claimToken: job.claimToken,
    }
    fs.writeFileSync(metaPath(job.id), JSON.stringify(safe))
  }

  function loadExisting() {
    let entries = []
    try {
      entries = fs
        .readdirSync(jobsDir)
        .filter((name) => name.endsWith('.meta.json'))
        .map((name) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(jobsDir, name), 'utf8'))
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return
    }

    entries.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    for (const meta of entries.slice(-MAX_JOBS)) {
      const wasInFlight = meta.status === 'queued' || meta.status === 'running' || meta.status === 'accepted'
      jobs.set(meta.id, {
        ...meta,
        claimToken: meta.claimToken || randomUUID(),
        status: wasInFlight ? 'error' : meta.status,
        error: wasInFlight
          ? 'Server restarted while this job was running. Please regenerate.'
          : meta.error,
      })
    }

    for (const meta of entries.slice(0, Math.max(0, entries.length - MAX_JOBS))) {
      removeJobFiles(meta.id)
    }
  }

  function removeJobFiles(id) {
    for (const file of [metaPath(id), resultPath(id)]) {
      try {
        fs.unlinkSync(file)
      } catch {
        // ignore
      }
    }
  }

  function prune() {
    const ordered = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)
    while (ordered.length > MAX_JOBS) {
      const oldest = ordered.shift()
      if (!oldest) break
      jobs.delete(oldest.id)
      removeJobFiles(oldest.id)
    }
  }

  function publicStatus(job, { includeData = false } = {}) {
    const out = {
      id: job.id,
      status: job.status,
      apiPath: job.apiPath,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      claimToken: job.claimToken,
    }
    if (job.status === 'error') out.error = job.error || 'Job failed'
    if (includeData && job.status === 'done') {
      try {
        out.data = JSON.parse(fs.readFileSync(resultPath(job.id), 'utf8'))
      } catch {
        out.status = 'error'
        out.error = 'Job result file is missing or unreadable.'
      }
    }
    return out
  }

  function parseUpstreamJson(raw) {
    const trimmed = String(raw || '').trim()
    if (!trimmed) return {}
    try {
      return JSON.parse(trimmed)
    } catch {
      const start = trimmed.search(/[{[]/)
      if (start < 0) throw new Error('Upstream response is not JSON')
      return JSON.parse(trimmed.slice(start))
    }
  }

  async function runJob(job) {
    job.status = 'running'
    job.updatedAt = Date.now()
    writeMeta(job)

    const timeoutMs = job.timeoutMs || TIMEOUT_MS
    try {
      const upstream = await fetch(job.target, {
        method: 'POST',
        headers: job.headers,
        body: JSON.stringify(job.body),
        signal: AbortSignal.timeout(timeoutMs),
      })

      const raw = Buffer.from(await upstream.arrayBuffer()).toString('utf8')
      const data = parseUpstreamJson(raw)
      const upstreamError =
        data?.error?.message ||
        (!upstream.ok ? `Upstream HTTP ${upstream.status}` : null)

      delete job.headers
      delete job.body
      delete job.auth

      if (upstreamError) {
        job.status = 'error'
        job.error = upstreamError
        job.updatedAt = Date.now()
        writeMeta(job)
        prune()
        console.warn(`[jobs] ${job.id} error: ${upstreamError}`)
        return
      }

      fs.writeFileSync(resultPath(job.id), JSON.stringify(data))
      job.status = 'done'
      job.updatedAt = Date.now()
      writeMeta(job)
      prune()
      console.log(`[jobs] ${job.id} done (${raw.length} bytes)`)
    } catch (err) {
      delete job.headers
      delete job.body
      delete job.auth
      job.status = 'error'
      job.error =
        err?.name === 'TimeoutError' || err?.cause?.name === 'TimeoutError'
          ? `Upstream request timed out after ${timeoutMs}ms.`
          : err?.message || String(err)
      job.updatedAt = Date.now()
      writeMeta(job)
      prune()
      console.error(`[jobs] ${job.id} failed:`, job.error)
    }
  }

  /** Phase 1: reserve a job id + claim token before uploading the large body. */
  function acceptJob() {
    const id = randomUUID()
    const claimToken = randomUUID()
    const now = Date.now()
    const job = {
      id,
      claimToken,
      status: 'accepted',
      apiPath: null,
      target: null,
      timeoutMs: TIMEOUT_MS,
      createdAt: now,
      updatedAt: now,
    }
    jobs.set(id, job)
    writeMeta(job)
    prune()
    return publicStatus(job)
  }

  /**
   * Phase 2: attach upstream request and start OpenRouter work.
   * Survives browser disconnect after this point.
   */
  function startJob(id, claimToken, { target, apiPath, headers, body, timeoutMs }) {
    const job = jobs.get(id)
    if (!job) return { error: 'not_found' }
    if (!tokensEqual(job.claimToken, claimToken)) return { error: 'forbidden' }
    if (job.status !== 'accepted') {
      return { error: 'conflict', job: publicStatus(job) }
    }

    job.status = 'queued'
    job.apiPath = apiPath
    job.target = target
    job.headers = headers
    job.body = body
    job.timeoutMs = timeoutMs || TIMEOUT_MS
    job.updatedAt = Date.now()
    writeMeta(job)

    setImmediate(() => {
      runJob(job).catch((err) => {
        console.error(`[jobs] ${id} unhandled:`, err?.message || err)
      })
    })

    return { job: publicStatus(job) }
  }

  function getJob(id, claimToken, { includeData = false } = {}) {
    const job = jobs.get(id)
    if (!job) return { error: 'not_found' }
    if (!tokensEqual(job.claimToken, claimToken)) return { error: 'forbidden' }
    return { job: publicStatus(job, { includeData }) }
  }

  loadExisting()

  return {
    acceptJob,
    startJob,
    getJob,
    maxJobs: MAX_JOBS,
    jobsDir,
  }
}
