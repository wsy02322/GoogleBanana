import type {
  Conversation,
  SessionBucket,
  Settings,
  Turn,
  Workspace,
  WorkspaceSessions,
} from './types'

const SETTINGS_KEY = 'googlebanana.settings.v1'
const SESSIONS_KEY_V1 = 'googlebanana.sessions.v1'
const SESSIONS_KEY = 'googlebanana.sessions.v2'
const UI_KEY = 'googlebanana.ui.v1'
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

function emptyBucket(): SessionBucket {
  const conv = createConversation()
  return { activeId: conv.id, conversations: [conv] }
}

function normalizeBucket(bucket: SessionBucket | undefined | null): SessionBucket {
  if (!bucket?.conversations?.length) return emptyBucket()
  const activeExists = bucket.conversations.some((c) => c.id === bucket.activeId)
  if (!activeExists) {
    return { ...bucket, activeId: bucket.conversations[0].id }
  }
  return bucket
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

function migrateLegacyHistory(): SessionBucket | null {
  const turns = loadLegacyHistory()
  if (turns.length === 0) return null
  const conv = createConversation(turns)
  localStorage.removeItem(LEGACY_HISTORY_KEY)
  return { activeId: conv.id, conversations: [conv] }
}

function loadSessionsV1(): SessionBucket | null {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY_V1)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionBucket
    if (parsed.conversations?.length > 0 && parsed.activeId) {
      return normalizeBucket(parsed)
    }
  } catch {
    // ignore
  }
  return null
}

function isWorkspaceSessions(value: unknown): value is WorkspaceSessions {
  if (!value || typeof value !== 'object') return false
  const v = value as WorkspaceSessions
  return Boolean(v.banana && v.gpt)
}

/**
 * Load per-workspace chat histories.
 * Migrates flat v1 sessions (and older single-history) into the banana bucket;
 * GPT starts with a fresh empty chat. Settings/API key are unchanged.
 */
export function loadWorkspaceSessions(): WorkspaceSessions {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isWorkspaceSessions(parsed)) {
        return {
          banana: normalizeBucket(parsed.banana),
          gpt: normalizeBucket(parsed.gpt),
        }
      }
    }
  } catch {
    // fall through
  }

  const fromV1 = loadSessionsV1()
  const fromLegacy = fromV1 ? null : migrateLegacyHistory()
  const banana = normalizeBucket(fromV1 ?? fromLegacy)

  const migrated: WorkspaceSessions = {
    banana,
    gpt: emptyBucket(),
  }
  saveWorkspaceSessions(migrated)
  // Drop flat v1 after successful split so we don't double-migrate later.
  try {
    localStorage.removeItem(SESSIONS_KEY_V1)
  } catch {
    // ignore
  }
  return migrated
}

export function saveWorkspaceSessions(data: WorkspaceSessions): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(data))
  } catch {
    // Ignore quota errors (base64 images can be large); history is best-effort.
  }
}

/** @deprecated Prefer loadWorkspaceSessions */
export function loadSessions(): SessionBucket {
  return loadWorkspaceSessions().banana
}

/** @deprecated Prefer saveWorkspaceSessions */
export function saveSessions(data: SessionBucket): void {
  const current = loadWorkspaceSessions()
  saveWorkspaceSessions({ ...current, banana: data })
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

export function loadLastWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return 'banana'
    const parsed = JSON.parse(raw) as { workspace?: Workspace }
    return parsed.workspace === 'gpt' ? 'gpt' : 'banana'
  } catch {
    return 'banana'
  }
}

export function saveLastWorkspace(workspace: Workspace): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ workspace }))
  } catch {
    // ignore
  }
}
