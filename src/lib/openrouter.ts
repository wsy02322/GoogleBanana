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

export function bananaModeModelId(mode: BananaMode): string {
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
    return 'Direct: resolution (1K→4K ~1×→4–10×) and quality (low→high ~1×→4×) both raise cost and detail — rough OpenRouter/OpenAI scales. Enter to send.'
  }
  return 'Pro Thinking: resolution still affects image size cost (~1×/2–4×/4–10×). Most spend is usually reasoning tokens, not the quality enum (Direct-only). Enter to send.'
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
    'X-OR-Title': settings.siteTitle || 'GoogleBanana',
    'X-OR-Referer': typeof location !== 'undefined' ? location.origin : '',
  }
}

async function parseProxyResponse(res: Response): Promise<unknown> {
  const raw = await res.text()
  let data: unknown
  try {
    data = raw ? parsePossiblyPaddedJson(raw) : {}
  } catch {
    throw new Error(`Unexpected response (HTTP ${res.status}): ${raw.slice(0, 300)}`)
  }

  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } })?.error?.message ||
      `Request failed with HTTP ${res.status}`
    throw new Error(msg)
  }

  const proxiedError = (data as { error?: { message?: string } })?.error?.message
  if (proxiedError) throw new Error(proxiedError)

  return data
}

/**
 * OpenRouter may prepend keep-alive whitespace or SSE-style comment lines
 * before the JSON object. JSON.parse allows whitespace, but not `: ping` lines.
 */
function parsePossiblyPaddedJson(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.search(/[{[]/)
    if (start <= 0) throw new Error('Response is not JSON')
    return JSON.parse(trimmed.slice(start))
  }
}

/** Client abort matching the proxy window (PROXY_TIMEOUT_MS, default 10 min). */
export function generationAbortSignal(timeoutMs = 600_000): AbortSignal {
  return AbortSignal.timeout(timeoutMs)
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
  signal?: AbortSignal,
): Promise<GenerateResult> {
  return generateBananaImage(settings, history, opts, signal)
}

async function generateBananaImage(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('No API key set. Open Settings and paste your OpenRouter API key.')
  }

  const bananaMode: BananaMode = opts.bananaMode ?? 'thinking'
  const model = bananaModeModelId(bananaMode)
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

  const res = await fetch('/proxy', {
    method: 'POST',
    headers: proxyHeaders(settings, 'chat/completions'),
    body: JSON.stringify(body),
    signal,
  })

  const data = await parseProxyResponse(res)
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
  signal?: AbortSignal,
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

  const res = await fetch('/proxy', {
    method: 'POST',
    headers: proxyHeaders(settings, 'chat/completions'),
    body: JSON.stringify(body),
    signal,
  })

  const data = await parseProxyResponse(res)
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
  signal?: AbortSignal,
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

  const res = await fetch('/proxy', {
    method: 'POST',
    headers: proxyHeaders(settings, 'images'),
    body: JSON.stringify(body),
    signal,
  })

  const data = await parseProxyResponse(res)
  return imagesFromImageApi(data)
}

export async function generateGptImage(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions & { mode: GptImageMode },
  signal?: AbortSignal,
): Promise<GenerateResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('No API key set. Open Settings and paste your OpenRouter API key.')
  }

  if (opts.mode === 'pro-thinking') {
    return generateProThinking(settings, history, opts, signal)
  }
  return generateDirectGptImage2(settings, history, opts, signal)
}

export function gptModeLabel(mode: GptImageMode): string {
  return mode === 'pro-thinking' ? 'Pro Thinking' : 'Direct gpt-image-2'
}

export function gptModeModelId(mode: GptImageMode): string {
  return mode === 'pro-thinking' ? GPT_PRO_THINKING_MODEL : GPT_DIRECT_MODEL
}
