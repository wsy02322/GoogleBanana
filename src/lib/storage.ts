import type { Conversation, SessionsData, Settings, Turn } from './types'

const SETTINGS_KEY = 'googlebanana.settings.v1'
const SESSIONS_KEY = 'googlebanana.sessions.v1'
const LEGACY_HISTORY_KEY = 'googlebanana.history.v1'

export const DEFAULT_MODEL = 'google/gemini-3-pro-image'

export const MODEL_OPTIONS = [
  { id: 'google/gemini-3-pro-image', label: 'Gemini 3 Pro Image (nano banana)' },
  { id: 'google/gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
]

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: DEFAULT_MODEL,
  siteTitle: 'GoogleBanana',
  theme: 'system',
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function conversationTitle(turns: Turn[]): string {
  const first = turns.find((t) => t.role === 'user' && t.text.trim())
  if (!first) return 'New chat'
  const text = first.text.trim().replace(/\s+/g, ' ')
  return text.length > 48 ? `${text.slice(0, 48)}…` : text
}

export function createConversation(turns: Turn[] = []): Conversation {
  const now = Date.now()
  return {
    id: uid(),
    title: conversationTitle(turns),
    turns,
    createdAt: now,
    updatedAt: now,
  }
}

function loadLegacyHistory(): Turn[] {
  try {
    const raw = localStorage.getItem(LEGACY_HISTORY_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Turn[]
  } catch {
    return []
  }
}

function migrateLegacyHistory(): SessionsData | null {
  const turns = loadLegacyHistory()
  if (turns.length === 0) return null
  const conv = createConversation(turns)
  localStorage.removeItem(LEGACY_HISTORY_KEY)
  return { activeId: conv.id, conversations: [conv] }
}

export function loadSessions(): SessionsData {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SessionsData
      if (parsed.conversations?.length > 0 && parsed.activeId) {
        const activeExists = parsed.conversations.some((c) => c.id === parsed.activeId)
        if (!activeExists) parsed.activeId = parsed.conversations[0].id
        return parsed
      }
    }
  } catch {
    // fall through to migration / default
  }

  const migrated = migrateLegacyHistory()
  if (migrated) return migrated

  const conv = createConversation()
  return { activeId: conv.id, conversations: [conv] }
}

export function saveSessions(data: SessionsData): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(data))
  } catch {
    // Ignore quota errors (base64 images can be large); history is best-effort.
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
