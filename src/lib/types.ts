export interface Settings {
  baseUrl: string
  apiKey: string
  model: string
  siteTitle: string
  theme: 'light' | 'dark' | 'system'
}

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
export type ImageSize = '1K' | '2K' | '4K'

/** Banana = Gemini nano-banana path; gpt = OpenRouter GPT image studio */
export type Workspace = 'banana' | 'gpt'

/**
 * Mode A: chat multimodal with high reasoning effort.
 * Mode B: dedicated Images API with max quality (+ best-effort thinking passthrough).
 */
export type GptImageMode = 'pro-thinking' | 'direct'

/**
 * Gemini app–style image intelligence lanes:
 * - fast: Nano Banana 2 with minimal thinking
 * - thinking: Nano Banana 2 with high thinking
 * - pro: Nano Banana Pro (highest fidelity)
 */
export type BananaMode = 'fast' | 'thinking' | 'pro'

/** Grounding / search for banana image generation */
export type SearchGrounding = 'off' | 'web' | 'web-image'

export interface Citation {
  url: string
  title: string
  content?: string
}

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  images: string[] // data URLs
  createdAt: number
  pending?: boolean
  error?: string
  /** Banana intelligence metadata (assistant turns) */
  bananaMode?: BananaMode
  searchGrounding?: SearchGrounding
  reasoning?: string
  citations?: Citation[]
}

export interface Conversation {
  id: string
  title: string
  turns: Turn[]
  createdAt: number
  updatedAt: number
}

export interface SessionsData {
  activeId: string
  conversations: Conversation[]
}

export interface ModelOption {
  id: string
  label: string
}
