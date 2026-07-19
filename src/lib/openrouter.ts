import type {
  AspectRatio,
  BananaMode,
  CapabilityReport,
  Citation,
  GptImageMode,
  ImageSize,
  SearchGrounding,
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
  bananaMode?: BananaMode
  searchGrounding?: SearchGrounding
}

export interface GenerateResult {
  text: string
  images: string[]
  reasoning?: string
  citations?: Citation[]
  modelUsed?: string
  bananaMode?: BananaMode
  searchGrounding?: SearchGrounding
  capability?: CapabilityReport
  /** Internal: search calls reported by OpenRouter usage */
  searchCalls?: number
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

function bananaReasoningEffort(mode: BananaMode): 'minimal' | 'high' {
  return mode === 'fast' ? 'minimal' : 'high'
}

export function buildCapabilityReport(input: {
  mode: BananaMode
  model: string
  searchRequested: SearchGrounding
  searchUsed: SearchGrounding
  searchFallback?: boolean
  reasoning?: string
  citationCount: number
  searchCalls?: number
  imageOk: boolean
}): CapabilityReport {
  let thinking: CapabilityReport['thinking']
  if (input.mode === 'fast') {
    thinking = input.reasoning ? 'returned' : 'minimal'
  } else {
    thinking = input.reasoning ? 'returned' : 'not_returned'
  }

  let searchEvidence: CapabilityReport['searchEvidence']
  if (input.searchRequested === 'off') {
    searchEvidence = 'off'
  } else if (input.searchFallback) {
    // Fallback is always reported; refine if we still got cites/calls after retry.
    if (input.citationCount > 0) searchEvidence = 'cited'
    else if (typeof input.searchCalls === 'number' && input.searchCalls > 0) searchEvidence = 'called'
    else searchEvidence = 'fallback'
  } else if (input.citationCount > 0) {
    searchEvidence = 'cited'
  } else if (typeof input.searchCalls === 'number' && input.searchCalls > 0) {
    searchEvidence = 'called'
  } else {
    searchEvidence = 'none'
  }

  return {
    mode: input.mode,
    model: input.model,
    thinking,
    searchRequested: input.searchRequested,
    searchUsed: input.searchUsed,
    searchFallback: input.searchFallback,
    searchEvidence,
    citationCount: input.citationCount,
    searchCalls: input.searchCalls,
    imageOk: input.imageOk,
  }
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

function extractCitations(message: {
  annotations?: Array<{
    type?: string
    url_citation?: { url?: string; title?: string; content?: string }
  }>
}): Citation[] {
  const citations: Citation[] = []
  for (const ann of message.annotations ?? []) {
    if (ann?.type !== 'url_citation' || !ann.url_citation?.url) continue
    citations.push({
      url: ann.url_citation.url,
      title: ann.url_citation.title || ann.url_citation.url,
      content: ann.url_citation.content,
    })
  }
  return citations
}

function imagesFromChatCompletion(data: unknown): GenerateResult {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | ContentPart[]
        images?: Array<{ image_url?: { url?: string } }>
        reasoning?: string
        reasoning_details?: unknown
        annotations?: Array<{
          type?: string
          url_citation?: { url?: string; title?: string; content?: string }
        }>
      }
    }>
    usage?: {
      server_tool_use?: { web_search_requests?: number }
    }
  }

  const choice = payload?.choices?.[0]

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

  const reasoning =
    typeof message?.reasoning === 'string' && message.reasoning.trim()
      ? message.reasoning.trim()
      : undefined

  const citations = message ? extractCitations(message) : []
  const searchCalls = payload?.usage?.server_tool_use?.web_search_requests

  if (images.length === 0 && !text) {
    throw new Error('The model returned no image. Try a different prompt or model.')
  }

  return {
    text,
    images,
    reasoning,
    citations: citations.length > 0 ? citations : undefined,
    searchCalls: typeof searchCalls === 'number' ? searchCalls : undefined,
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

function buildBananaTools(search: SearchGrounding): unknown[] | undefined {
  if (search === 'off') return undefined

  // Web + Image Search: prefer Google-native tool shape (NB2 Image Search).
  // If OpenRouter/upstream rejects it, generateImage falls back to web-only.
  if (search === 'web-image') {
    return [
      {
        type: 'google_search',
        search_types: ['web_search', 'image_search'],
      },
    ]
  }

  // Web-only: OpenRouter server tool (native Google search when available).
  return [
    {
      type: 'openrouter:web_search',
      parameters: {
        engine: 'native',
        max_results: 5,
      },
    },
  ]
}

function withSearchHint(messages: ChatMessage[], search: SearchGrounding): ChatMessage[] {
  if (search === 'off' || messages.length === 0) return messages

  const hint =
    search === 'web-image'
      ? 'Use web search and image search grounding when helpful: look up current facts and accurate visual references before generating the image.'
      : 'Use web search grounding when helpful: look up current facts before generating the image.'

  // Prepend a light system-style user cue only if the latest user turn has no prior hint.
  const last = messages[messages.length - 1]
  if (last.role !== 'user') return messages

  const content: ContentPart[] = [{ type: 'text', text: hint }, ...last.content]
  return [...messages.slice(0, -1), { ...last, content }]
}

export async function generateImage(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  return generateBananaImage(settings, history, opts, signal, {
    searchRequested: opts.searchGrounding ?? 'off',
    searchFallback: false,
  })
}

async function generateBananaImage(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  signal: AbortSignal | undefined,
  meta: { searchRequested: SearchGrounding; searchFallback: boolean },
): Promise<GenerateResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('No API key set. Open Settings and paste your OpenRouter API key.')
  }

  const bananaMode: BananaMode = opts.bananaMode ?? 'thinking'
  const searchGrounding: SearchGrounding = opts.searchGrounding ?? 'off'
  const model = bananaModeModelId(bananaMode)
  const effort = bananaReasoningEffort(bananaMode)
  const tools = buildBananaTools(searchGrounding)
  const messages = withSearchHint(buildMessages(history), searchGrounding)

  const body: Record<string, unknown> = {
    model,
    messages,
    modalities: ['image', 'text'],
    reasoning: { effort, exclude: false },
    reasoning_effort: effort,
    image_config: {
      aspect_ratio: opts.aspectRatio,
      image_size: opts.imageSize,
    },
  }
  if (tools) body.tools = tools

  const res = await fetch('/proxy', {
    method: 'POST',
    headers: proxyHeaders(settings, 'chat/completions'),
    body: JSON.stringify(body),
    signal,
  })

  // If Image Search native tool is rejected, retry once with web-only search.
  if (!res.ok && searchGrounding === 'web-image') {
    const raw = await res.text()
    let msg = `Request failed with HTTP ${res.status}`
    try {
      const parsed = raw ? JSON.parse(raw) : {}
      msg = (parsed as { error?: { message?: string } })?.error?.message || msg
    } catch {
      if (raw) msg = raw.slice(0, 300)
    }
    const looksLikeToolError = /tool|google_search|search_types|unsupported/i.test(msg)
    if (looksLikeToolError) {
      return generateBananaImage(
        settings,
        history,
        { ...opts, searchGrounding: 'web' },
        signal,
        { searchRequested: meta.searchRequested, searchFallback: true },
      )
    }
    throw new Error(msg)
  }

  const data = await parseProxyResponse(res)
  const result = imagesFromChatCompletion(data)
  const citationCount = result.citations?.length ?? 0

  return {
    ...result,
    modelUsed: model,
    bananaMode,
    searchGrounding,
    capability: buildCapabilityReport({
      mode: bananaMode,
      model,
      searchRequested: meta.searchRequested,
      searchUsed: searchGrounding,
      searchFallback: meta.searchFallback || undefined,
      reasoning: result.reasoning,
      citationCount,
      searchCalls: result.searchCalls,
      imageOk: result.images.length > 0,
    }),
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
