export interface Settings {
  baseUrl: string
  apiKey: string
  model: string
  siteTitle: string
  theme: 'light' | 'dark' | 'system'
}

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
/** Shared resolution tier for Banana + GPT (image_config / Images API). */
export type ImageSize = '1K' | '2K' | '4K'
/**
 * GPT Images API quality knob (openai/gpt-image-2).
 * Banana / Pro Thinking chat models do not expose this parameter.
 */
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high'

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
  /** GPT Image studio mode (assistant turns) */
  gptMode?: GptImageMode
  reasoning?: string
  /** @deprecated Kept optional so older localStorage chats still load. */
  searchGrounding?: string
  /** @deprecated Kept optional so older localStorage chats still load. */
  citations?: Array<{ url: string; title: string; content?: string }>
  /** @deprecated Kept optional so older localStorage chats still load. */
  capability?: unknown
}

export interface Conversation {
  id: string
  title: string
  turns: Turn[]
  createdAt: number
  updatedAt: number
}

/** One workspace's chat list + active conversation. */
export interface SessionBucket {
  activeId: string
  conversations: Conversation[]
}

/**
 * Banana and GPT Image keep independent chat histories.
 * Settings (API key, base URL, theme) stay shared across workspaces.
 */
export interface WorkspaceSessions {
  banana: SessionBucket
  gpt: SessionBucket
}

/** @deprecated Use SessionBucket / WorkspaceSessions — kept for migration typing. */
export type SessionsData = SessionBucket

export interface ModelOption {
  id: string
  label: string
}
