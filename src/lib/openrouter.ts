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

  const citations = message ? extractCitations(message) : []
  const searchCalls = payload?.usage?.server_tool_use?.web_search_requests

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

function buildBananaSearchPlugins(
  search: SearchGrounding,
  engine: 'native' | 'exa' = 'native',
): unknown[] | undefined {
  if (search === 'off') return undefined

  // OpenRouter Gemini *image* endpoints do not advertise tool-calling, so
  // `tools: [{ type: "openrouter:web_search" }]` / `google_search` returns:
  // "No endpoints found that support tool use".
  // Use the web plugin instead — it injects search results into the prompt
  // without requiring a tool-capable endpoint.
  //
  // Native Google Image Search grounding is not exposed on these OpenRouter
  // image endpoints; Web + Image therefore uses a richer web plugin prompt.
  const today = new Date().toISOString().slice(0, 10)
  const search_prompt =
    search === 'web-image'
      ? `A web search was conducted on ${today}. Use these results as factual and visual references before generating the image. Prefer official/current pages for "today/current/latest" requests. Cite sources with markdown links named by domain.`
      : `A web search was conducted on ${today}. Incorporate the following web search results into your response and image. Cite them using markdown links named using the domain of the source.`

  return [
    {
      id: 'web',
      engine,
      max_results: search === 'web-image' ? 8 : 5,
      search_prompt,
    },
  ]
}

function withSearchHint(
  messages: ChatMessage[],
  search: SearchGrounding,
  evidenceRetry: boolean,
): ChatMessage[] {
  if (search === 'off' || messages.length === 0) return messages

  const requirement =
    search === 'web-image'
      ? 'Web search results are provided below/with this request. You MUST ground the image in those current results and cite sources. Do not invent dates, sources, or current events from memory.'
      : 'Web search results are provided below/with this request. You MUST ground current facts in those results and cite sources. Do not invent dates, sources, or current events from memory.'
  const retry =
    evidenceRetry
      ? ' This is a required retry because the previous result contained no verifiable sources. Cite at least one search result.'
      : ''
  const hint = `${requirement}${retry}`

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
    evidenceRetry: false,
  })
}

async function generateBananaImage(
  settings: Settings,
  history: Turn[],
  opts: GenerateOptions,
  signal: AbortSignal | undefined,
  meta: {
    searchRequested: SearchGrounding
    searchFallback: boolean
    evidenceRetry: boolean
    searchEngine?: 'native' | 'exa'
  },
): Promise<GenerateResult> {
  if (!settings.apiKey.trim()) {
    throw new Error('No API key set. Open Settings and paste your OpenRouter API key.')
  }

  const searchGrounding: SearchGrounding = opts.searchGrounding ?? 'off'
  // Image Search is a Nano Banana 2 capability on Google's API. On OpenRouter
  // we still route Web + Image to NB2 and use the web plugin (see below).
  const requestedMode: BananaMode = opts.bananaMode ?? 'thinking'
  const bananaMode: BananaMode =
    searchGrounding === 'web-image' && requestedMode === 'pro' ? 'thinking' : requestedMode
  const model = bananaModeModelId(bananaMode)
  const effort = bananaReasoningEffort(bananaMode)
  const searchEngine = meta.searchEngine ?? 'native'
  const plugins = buildBananaSearchPlugins(searchGrounding, searchEngine)
  const messages = withSearchHint(buildMessages(history), searchGrounding, meta.evidenceRetry)

  const body: Record<string, unknown> = {
    model,
    messages,
    modalities: ['image', 'text'],
    stream: false,
    reasoning: { effort, exclude: false },
    reasoning_effort: effort,
    image_config: {
      aspect_ratio: opts.aspectRatio,
      image_size: opts.imageSize,
    },
  }
  if (plugins) body.plugins = plugins

  const res = await fetch('/proxy', {
    method: 'POST',
    headers: proxyHeaders(settings, 'chat/completions'),
    body: JSON.stringify(body),
    signal,
  })

  // Native Google search may be unavailable for some image endpoints — fall back to Exa.
  if (!res.ok && searchGrounding !== 'off' && searchEngine === 'native') {
    const raw = await res.text()
    let msg = `Request failed with HTTP ${res.status}`
    try {
      const parsed = raw ? JSON.parse(raw) : {}
      msg = (parsed as { error?: { message?: string } })?.error?.message || msg
    } catch {
      if (raw) msg = raw.slice(0, 300)
    }
    const looksLikeSearchRouteError =
      /tool use|plugin|web search|native|endpoint|grounding|unsupported/i.test(msg)
    if (looksLikeSearchRouteError) {
      return generateBananaImage(settings, history, opts, signal, {
        ...meta,
        searchFallback: true,
        searchEngine: 'exa',
      })
    }
    throw new Error(msg)
  }

  const data = await parseProxyResponse(res)
  const result = imagesFromChatCompletion(data)
  const citationCount = result.citations?.length ?? 0
  const hasSearchEvidence =
    citationCount > 0 || (typeof result.searchCalls === 'number' && result.searchCalls > 0)

  if (meta.searchRequested !== 'off' && !hasSearchEvidence) {
    if (!meta.evidenceRetry) {
      return generateBananaImage(settings, history, opts, signal, {
        ...meta,
        evidenceRetry: true,
      })
    }
    throw new Error(
      'Search was required, but the response had no cited sources after two attempts. The ungrounded image was discarded. Try again, attach a reference image, or turn search off.',
    )
  }

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
