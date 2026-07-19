import type { AspectRatio, GptImageMode, ImageSize, Settings, Turn } from './types'

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
}

export interface GenerateResult {
  text: string
  images: string[]
}

export const GPT_PRO_THINKING_MODEL = 'openai/gpt-5.4-image-2'
export const GPT_DIRECT_MODEL = 'openai/gpt-image-2'

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
    data = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`Unexpected response (HTTP ${res.status}): ${raw.slice(0, 300)}`)
  }

  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } })?.error?.message ||
      `Request failed with HTTP ${res.status}`
    throw new Error(msg)
  }

  return data
}

function imagesFromChatCompletion(data: unknown): GenerateResult {
  const choice = (data as {
    choices?: Array<{
      message?: {
        content?: string | ContentPart[]
        images?: Array<{ image_url?: { url?: string } }>
        reasoning?: string
      }
    }>
  })?.choices?.[0]

  const message = choice?.message
  const images = (message?.images ?? [])
    .map((img) => img?.image_url?.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  let text = ''
  if (typeof message?.content === 'string') {
    text = message.content
  } else if (Array.isArray(message?.content)) {
    text = message.content
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text!)
      .join('\n')
  }

  if (images.length === 0 && !text) {
    throw new Error('The model returned no image. Try a different prompt or model.')
  }

  return { text, images }
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
  if (!settings.apiKey.trim()) {
    throw new Error('No API key set. Open Settings and paste your OpenRouter API key.')
  }

  const body = {
    model: settings.model,
    messages: buildMessages(history),
    modalities: ['image', 'text'],
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
    quality: 'high',
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
