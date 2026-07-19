import type { AspectRatio, ImageSize, IntelligenceLevel, Settings, Turn } from './types'

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

const GPT_IMAGE_DEDICATED = 'openai/gpt-image-2'

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

function lastUserPrompt(history: Turn[]): { text: string; images: string[] } {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]
    if (turn.role === 'user' && !turn.error && !turn.pending) {
      return { text: turn.text.trim() || ' ', images: turn.images }
    }
  }
  return { text: ' ', images: [] }
}

function proxyHeaders(settings: Settings, path: 'chat/completions' | 'images'): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey.trim()}`,
    'X-OR-Base-URL': settings.baseUrl.trim(),
    'X-OR-Title': settings.siteTitle || 'GoogleBanana',
    'X-OR-Referer': typeof location !== 'undefined' ? location.origin : '',
    'X-OR-Path': path,
  }
}

async function parseJsonResponse(res: Response): Promise<unknown> {
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

function extractChatImages(data: unknown): GenerateResult {
  const choice = (data as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string; image_url?: { url?: string } }>
        images?: Array<{ image_url?: { url?: string } }>
      }
    }>
  })?.choices?.[0]

  const message = choice?.message
  const images = (message?.images ?? [])
    .map((img) => img?.image_url?.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  // Some providers embed images in content parts instead of message.images.
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url
      if (typeof url === 'string' && url.length > 0 && !images.includes(url)) {
        images.push(url)
      }
    }
  }

  const text =
    typeof message?.content === 'string'
      ? message.content
      : Array.isArray(message?.content)
        ? message.content
            .filter((p) => p?.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text)
            .join('\n')
        : ''

  if (images.length === 0 && !text) {
    throw new Error('The model returned no image. Try a different prompt or model.')
  }

  return { text, images }
}

function extractDedicatedImages(data: unknown): GenerateResult {
  const items = (data as {
    data?: Array<{ b64_json?: string; url?: string; media_type?: string }>
  })?.data

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('The model returned no image. Try a different prompt or model.')
  }

  const images = items
    .map((item) => {
      if (typeof item.url === 'string' && item.url.length > 0) return item.url
      if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
        const mime = item.media_type || 'image/png'
        return `data:${mime};base64,${item.b64_json}`
      }
      return null
    })
    .filter((u): u is string => typeof u === 'string')

  if (images.length === 0) {
    throw new Error('The model returned no image. Try a different prompt or model.')
  }

  return { text: '', images }
}

function buildGeminiBody(settings: Settings, history: Turn[], opts: GenerateOptions) {
  return {
    model: settings.model,
    messages: buildMessages(history),
    modalities: ['image', 'text'],
    image_config: {
      aspect_ratio: opts.aspectRatio,
      image_size: opts.imageSize,
    },
  }
}

function buildChatGptChatBody(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  intelligence: IntelligenceLevel,
) {
  return {
    model: settings.model,
    messages: buildMessages(history),
    modalities: ['image', 'text'],
    image_config: {
      aspect_ratio: opts.aspectRatio,
      quality: intelligence,
    },
    reasoning: {
      effort: intelligence,
    },
  }
}

function buildDedicatedImageBody(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  intelligence: IntelligenceLevel,
) {
  const { text, images } = lastUserPrompt(history)
  const body: Record<string, unknown> = {
    model: settings.model,
    prompt: text,
    quality: intelligence,
    aspect_ratio: opts.aspectRatio,
  }

  // Map Gemini-style size tiers to a resolution hint when present.
  if (opts.imageSize) {
    body.resolution = opts.imageSize
  }

  if (images.length > 0) {
    body.input_references = images.map((url) => ({
      type: 'image_url',
      image_url: { url },
    }))
  }

  return body
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

  const isChatGpt = settings.uiMode === 'chatgpt'
  const useDedicatedImages = isChatGpt && settings.model === GPT_IMAGE_DEDICATED
  const intelligence = settings.intelligence || 'medium'

  if (useDedicatedImages) {
    const body = buildDedicatedImageBody(settings, history, opts, intelligence)
    const res = await fetch('/proxy', {
      method: 'POST',
      headers: proxyHeaders(settings, 'images'),
      body: JSON.stringify(body),
      signal,
    })
    const data = await parseJsonResponse(res)
    return extractDedicatedImages(data)
  }

  const body = isChatGpt
    ? buildChatGptChatBody(settings, history, opts, intelligence)
    : buildGeminiBody(settings, history, opts)

  const res = await fetch('/proxy', {
    method: 'POST',
    headers: proxyHeaders(settings, 'chat/completions'),
    body: JSON.stringify(body),
    signal,
  })
  const data = await parseJsonResponse(res)
  return extractChatImages(data)
}
