import type {
  AspectRatio,
  BananaMode,
  GptImageMode,
  ImageQuality,
  ImageSize,
  Settings,
  Turn,
} from './types'

interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: ContentPart[]
}

export interface GenerateOptions {
  aspectRatio: AspectRatio
  imageSize: ImageSize
  /** GPT Direct Images API only; ignored by Banana / Pro Thinking. */
  imageQuality?: ImageQuality
  bananaMode?: BananaMode
}

export interface GenerateResult {
  text: string
  images: string[]
  reasoning?: string
  modelUsed?: string
  bananaMode?: BananaMode
}

export const GPT_PRO_THINKING_MODEL = 'openai/gpt-5.4-image-2'
export const GPT_DIRECT_MODEL = 'openai/gpt-image-2'

export const BANANA_FLASH_MODEL = 'google/gemini-3.1-flash-image'
export const BANANA_PRO_MODEL = 'google/gemini-3-pro-image'
/** 4K is only supported on preview variants routed by OpenRouter (not -20260528 stable). */
export const BANANA_FLASH_PREVIEW_MODEL = 'google/gemini-3.1-flash-image-preview'
export const BANANA_PRO_PREVIEW_MODEL = 'google/gemini-3-pro-image-preview'

export function bananaModeModelId(mode: BananaMode, imageSize?: ImageSize): string {
  if (imageSize === '4K') {
    return mode === 'pro' ? BANANA_PRO_PREVIEW_MODEL : BANANA_FLASH_PREVIEW_MODEL
  }
  return mode === 'pro' ? BANANA_PRO_MODEL : BANANA_FLASH_MODEL
}

export function bananaModeLabel(mode: BananaMode): string {
  if (mode === 'fast') return 'Fast'
  if (mode === 'thinking') return 'Thinking'
  return 'Pro'
}

export function bananaModeHint(mode: BananaMode): string {
  if (mode === 'fast') return 'Nano Banana 2 · minimal thinking'
  if (mode === 'thinking') return 'Nano Banana 2 · high thinking'
  return 'Nano Banana Pro · highest fidelity'
}

export function imageSizeCostHint(size: ImageSize): string {
  if (size === '1K') return '1K · ~1× cost · standard detail'
  if (size === '2K') return '2K · ~2–4× cost · sharper'
  return '4K · ~4–10× cost · max detail'
}

export function imageQualityCostHint(quality: ImageQuality): string {
  if (quality === 'auto') return 'auto · provider picks · mid cost'
  if (quality === 'low') return 'low · ~1× cost · draft quality'
  if (quality === 'medium') return 'medium · ~2× cost · good quality'
  return 'high · ~4× cost · best quality'
}

/** Footer copy explaining cost/quality knobs for the active workspace. */
export function composerCostFootnote(
  workspace: 'banana' | 'gpt',
  gptMode: 'pro-thinking' | 'direct',
): string {
  if (workspace === 'banana') {
    return 'Banana has no separate quality knob — resolution is the main cost/detail control (1K ~1×, 2K ~2–4×, 4K ~4–10×; rough). Enter to send.'
  }
  if (gptMode === 'direct') {
    return 'Direct: highest direct image quality; latest prompt only (no chat history). Re-attach a previous result and restate prior instructions to continue editing. Enter to send.'
  }
  return 'Pro Thinking balances image quality, multi-turn editing, and high reasoning. Resolution still affects cost (~1×/2–4×/4–10×); quality control is Direct-only. Enter to send.'
}

function bananaReasoningEffort(mode: BananaMode): 'minimal' | 'high' {
  return mode === 'fast' ? 'minimal' : 'high'
}

function turnToMessage(turn: Turn): ChatMessage {
  const content: ContentPart[] = []
  if (turn.text.trim()) content.push({ type: 'text', text: turn.text })
  for (const url of turn.images) {
    content.push({ type: 'image_url', image_url: { url } })
  }
  // A message must have at least one part.
  if (content.length === 0) content.push({ type: 'text', text: ' ' })
  return { role: turn.role, content }
}

/**
 * Build the OpenAI/OpenRouter-style messages array from the conversation so
 * far. Prior assistant images are included as context, enabling multi-turn
 * iterative editing (mirroring the official nano banana experience).
 */
function buildMessages(history: Turn[]): ChatMessage[] {
  return history
    .filter((t) => !t.error && !t.pending)
    .map(turnToMessage)
}

function proxyHeaders(settings: Settings, apiPath: 'chat/completions' | 'images'): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey.trim()}`,
    'X-OR-Base-URL': settings.baseUrl.trim(),
    'X-OR-Path': apiPath,
    'X-OR-Title': 'GoogleBanana',
    'X-OR-Referer': typeof location !== 'undefined' ? location.origin : '',
  }
}

export interface GenerateRequestOptions {
  /** Optional. Aborting only stops local polling — the server job keeps running. */
  signal?: AbortSignal
  /** Called as soon as the server reserves a job id (before the large body upload). */
  onJobStarted?: (jobId: string, claimToken: string) => void
}

const JOB_POLL_MS = 2_000

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Polling aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Polling aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Poll a server job until done/error. Safe to call again after reopening the tab. */
export async function waitForServerJob(
  jobId: string,
  claimToken: string,
  signal?: AbortSignal,
): Promise<{ apiPath: 'chat/completions' | 'images'; data: unknown }> {
  for (;;) {
    if (signal?.aborted) throw new DOMException('Polling aborted', 'AbortError')

    try {
      const res = await fetch(`/jobs/${encodeURIComponent(jobId)}`, {
        signal,
        headers: { 'X-Job-Claim-Token': claimToken },
      })
      const payload = (await res.json().catch(() => ({}))) as {
        status?: string
        apiPath?: string
        data?: unknown
        error?: { message?: string } | string
      }

      if (res.status === 404) {
        throw new Error(
          'Job not found. The server only keeps the newest 20 results; this one may have expired.',
        )
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : payload.error?.message || 'Invalid or missing job claim token.',
        )
      }

      if (!res.ok) {
        const msg =
          typeof payload.error === 'string'
            ? payload.error
            : payload.error?.message || `Job status failed (HTTP ${res.status})`
        throw new Error(msg)
      }

      if (payload.status === 'done') {
        const apiPath =
          payload.apiPath === 'images' ? 'images' : ('chat/completions' as const)
        return { apiPath, data: payload.data }
      }

      if (payload.status === 'error') {
        const msg =
          typeof payload.error === 'string'
            ? payload.error
            : payload.error?.message || 'Generation job failed'
        throw new Error(msg)
      }

      if (payload.status === 'accepted') {
        // Reserved, but the request body never reached /run (tab closed too early).
        throw new Error(
          'This job was reserved but never started. Please regenerate — close the tab only after generation has begun.',
        )
      }
    } catch (err) {
      if (signal?.aborted) throw err
      if (err instanceof Error && err.name === 'AbortError') throw err
      // Fatal job errors should surface; transient network blips retry.
      if (
        err instanceof Error &&
        !/Failed to fetch|NetworkError|Load failed|fetch/i.test(err.message) &&
        err.name !== 'TypeError'
      ) {
        throw err
      }
    }

    await sleep(JOB_POLL_MS, signal)
  }
}

/**
 * Two-phase server job:
 * 1) reserve id + claim token (bookmark immediately — safe to close tab after this)
 * 2) upload body and start OpenRouter work
 * 3) poll until done
 */
async function requestViaServerJob(
  settings: Settings,
  apiPath: 'chat/completions' | 'images',
  body: Record<string, unknown>,
  opts?: GenerateRequestOptions,
): Promise<unknown> {
  const acceptRes = await fetch('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts?.signal,
  })
  const accepted = (await acceptRes.json().catch(() => ({}))) as {
    id?: string
    claimToken?: string
    error?: { message?: string }
  }
  if (!acceptRes.ok) {
    throw new Error(accepted.error?.message || `Failed to reserve job (HTTP ${acceptRes.status})`)
  }
  if (!accepted.id || !accepted.claimToken) {
    throw new Error('Server did not return a job id and claim token.')
  }

  // Bookmark before the large upload so a mid-request tab close can still reclaim.
  opts?.onJobStarted?.(accepted.id, accepted.claimToken)

  const runRes = await fetch(`/jobs/${encodeURIComponent(accepted.id)}/run`, {
    method: 'POST',
    headers: {
      ...proxyHeaders(settings, apiPath),
      'X-Job-Claim-Token': accepted.claimToken,
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
  const started = (await runRes.json().catch(() => ({}))) as {
    id?: string
    status?: string
    error?: { message?: string }
  }
  if (!runRes.ok && runRes.status !== 409) {
    throw new Error(started.error?.message || `Failed to start job (HTTP ${runRes.status})`)
  }

  const { data } = await waitForServerJob(accepted.id, accepted.claimToken, opts?.signal)
  return data
}

/** @deprecated Prefer server jobs; kept for compatibility. */
export function generationAbortSignal(timeoutMs = 600_000): AbortSignal {
  return AbortSignal.timeout(timeoutMs)
}

export function resultFromChatCompletion(data: unknown): GenerateResult {
  return imagesFromChatCompletion(data)
}

export function resultFromImageApi(data: unknown): GenerateResult {
  return imagesFromImageApi(data)
}

function imagesFromChatCompletion(data: unknown): GenerateResult {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | ContentPart[]
        images?: Array<{ image_url?: { url?: string } }>
        reasoning?: string
        reasoning_details?: unknown
      }
    }>
  }

  const choice = payload?.choices?.[0]

  const message = choice?.message
  const images: string[] = []
  for (const img of message?.images ?? []) {
    const url = img?.image_url?.url
    if (typeof url === 'string' && url.length > 0) images.push(url)
  }

  let text = ''
  if (typeof message?.content === 'string') {
    text = message.content
  } else if (Array.isArray(message?.content)) {
    const textParts: string[] = []
    for (const part of message.content) {
      if (part.type === 'text' && part.text) textParts.push(part.text)
      // Some providers put generated images in content[] instead of message.images.
      const url = part.type === 'image_url' ? part.image_url?.url : undefined
      if (typeof url === 'string' && url.length > 0 && !images.includes(url)) {
        images.push(url)
      }
    }
    text = textParts.join('\n')
  }

  const reasoning =
    typeof message?.reasoning === 'string' && message.reasoning.trim()
      ? message.reasoning.trim()
      : undefined

  // Last resort: some providers embed data-URL images inside markdown/text.
  if (images.length === 0 && text) {
    const embedded = text.match(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+/g)
    if (embedded) {
      for (const match of embedded) {
        const cleaned = match.replace(/\s+/g, '')
        if (!images.includes(cleaned)) images.push(cleaned)
      }
      // Prefer showing the image; drop raw base64 blobs from visible text.
      if (images.length > 0) {
        text = text.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+/g, '').trim()
      }
    }
  }

  if (images.length === 0 && !text) {
    throw new Error('The model returned no image. Try a different prompt or model.')
  }

  return {
    text,
    images,
    reasoning,
  }
}

function imagesFromImageApi(data: unknown): GenerateResult {
  const rows = (data as {
    data?: Array<{ b64_json?: string; url?: string; media_type?: string }>
  })?.data

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('The Image API returned no image. Try a different prompt or quality.')
  }

  const images = rows
    .map((row) => {
      if (typeof row.url === 'string' && row.url.length > 0) return row.url
      if (typeof row.b64_json === 'string' && row.b64_json.length > 0) {
        const mime = row.media_type || 'image/png'
        return `data:${mime};base64,${row.b64_json}`
      }
      return null
    })
    .filter((u): u is string => typeof u === 'string')

  if (images.length === 0) {
    throw new Error('The Image API returned no usable image payload.')
  }

  return { text: '', images }
}

/** Latest user prompt text from history (for dedicated Image API). */
function latestUserPrompt(history: Turn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]
    if (t.role === 'user' && !t.error && !t.pending) {
      const text = t.text.trim()
      if (text) return text
    }
  }
  return 'Generate an image'
}

/** Reference images from the latest user turn (Image API input_references). */
function latestUserReferences(history: Turn[]): Array<{ type: 'image_url'; image_url: { url: string } }> {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]
    if (t.role === 'user' && !t.error && !t.pending && t.images.length > 0) {
      return t.images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
    }
  }
  return []
}

export async function generateImage(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  requestOpts?: GenerateRequestOptions,
): Promise<GenerateResult> {
  return generateBananaImage(settings, history, opts, requestOpts)
}

async function generateBananaImage(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  requestOpts?: GenerateRequestOptions,
): Promise<GenerateResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('No API key set. Open Settings and paste your OpenRouter API key.')
  }

  const bananaMode: BananaMode = opts.bananaMode ?? 'thinking'
  const model = bananaModeModelId(bananaMode, opts.imageSize)
  const effort = bananaReasoningEffort(bananaMode)

  const body: Record<string, unknown> = {
    model,
    messages: buildMessages(history),
    modalities: ['image', 'text'],
    stream: false,
    reasoning: { effort, exclude: false },
    reasoning_effort: effort,
    image_config: {
      aspect_ratio: opts.aspectRatio,
      image_size: opts.imageSize,
    },
  }

  const data = await requestViaServerJob(settings, 'chat/completions', body, requestOpts)
  const result = imagesFromChatCompletion(data)

  return {
    ...result,
    modelUsed: model,
    bananaMode,
  }
}

/**
 * Mode A — ChatGPT Pro Thinking–style path on OpenRouter:
 * openai/gpt-5.4-image-2 with reasoning.effort = high via chat/completions.
 */
async function generateProThinking(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  requestOpts?: GenerateRequestOptions,
): Promise<GenerateResult> {
  const body = {
    model: GPT_PRO_THINKING_MODEL,
    messages: buildMessages(history),
    modalities: ['image', 'text'],
    stream: false,
    // OpenRouter accepts both shapes; include both for max compatibility.
    reasoning: { effort: 'high' },
    reasoning_effort: 'high',
    image_config: {
      aspect_ratio: opts.aspectRatio,
      image_size: opts.imageSize,
    },
  }

  const data = await requestViaServerJob(settings, 'chat/completions', body, requestOpts)
  return imagesFromChatCompletion(data)
}

/**
 * Mode B — Direct openai/gpt-image-2 via OpenRouter Image API.
 * Uses quality: high (strongest documented knob). Also best-effort passes
 * thinking:"high" under provider.options.openai — OpenRouter currently only
 * lists "moderation" as an allowed passthrough, so thinking may be dropped.
 */
async function generateDirectGptImage2(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  requestOpts?: GenerateRequestOptions,
): Promise<GenerateResult> {
  const input_references = latestUserReferences(history)
  const body: Record<string, unknown> = {
    model: GPT_DIRECT_MODEL,
    prompt: latestUserPrompt(history),
    quality: opts.imageQuality ?? 'high',
    aspect_ratio: opts.aspectRatio,
    resolution: opts.imageSize,
    n: 1,
    // Best-effort: strongest reasoning form if OpenRouter/OpenAI accepts it.
    provider: {
      options: {
        openai: {
          thinking: 'high',
          moderation: 'auto',
        },
      },
    },
  }
  if (input_references.length > 0) {
    body.input_references = input_references
  }

  const data = await requestViaServerJob(settings, 'images', body, requestOpts)
  return imagesFromImageApi(data)
}

export async function generateGptImage(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions & { mode: GptImageMode },
  requestOpts?: GenerateRequestOptions,
): Promise<GenerateResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('No API key set. Open Settings and paste your OpenRouter API key.')
  }

  if (opts.mode === 'pro-thinking') {
    return generateProThinking(settings, history, opts, requestOpts)
  }
  return generateDirectGptImage2(settings, history, opts, requestOpts)
}

export function gptModeLabel(mode: GptImageMode): string {
  return mode === 'pro-thinking' ? 'Pro Thinking' : 'Direct gpt-image-2'
}

export function gptModeModelId(mode: GptImageMode): string {
  return mode === 'pro-thinking' ? GPT_PRO_THINKING_MODEL : GPT_DIRECT_MODEL
}
