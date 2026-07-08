import type { AspectRatio, ImageSize, Settings, Turn } from './types'

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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      'X-OR-Base-URL': settings.baseUrl.trim(),
      'X-OR-Title': settings.siteTitle || 'GoogleBanana',
      'X-OR-Referer': typeof location !== 'undefined' ? location.origin : '',
    },
    body: JSON.stringify(body),
    signal,
  })

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

  const choice = (data as {
    choices?: Array<{
      message?: {
        content?: string
        images?: Array<{ image_url?: { url?: string } }>
      }
    }>
  })?.choices?.[0]

  const message = choice?.message
  const images = (message?.images ?? [])
    .map((img) => img?.image_url?.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  const text = typeof message?.content === 'string' ? message.content : ''

  if (images.length === 0 && !text) {
    throw new Error('The model returned no image. Try a different prompt or model.')
  }

  return { text, images }
}
