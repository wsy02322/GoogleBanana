import type {
  AspectRatio,
  Conversation,
  ImagePreferences,
  ImageQuality,
  ImageSize,
  SessionBucket,
  Settings,
  Turn,
  Workspace,
  WorkspaceImagePreferences,
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
  theme: 'system',
}

export const DEFAULT_IMAGE_PREFERENCES: WorkspaceImagePreferences = {
  banana: { aspectRatio: '1:1', imageSize: '1K', imageQuality: 'high' },
  gpt: { aspectRatio: '1:1', imageSize: '2K', imageQuality: 'high' },
}

export interface SessionsSaveResult {
  status: 'saved' | 'trimmed' | 'failed'
  trimmedImages: number
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

function embeddedImageKeys(data: WorkspaceSessions): string[] {
  const refs: Array<{ key: string; createdAt: number }> = []
  for (const workspace of ['banana', 'gpt'] as const) {
    for (const conversation of data[workspace].conversations) {
      for (const turn of conversation.turns) {
        turn.images.forEach((url, index) => {
          if (url.startsWith('data:image/')) {
            refs.push({
              key: `${workspace}:${conversation.id}:${turn.id}:${index}`,
              createdAt: turn.createdAt,
            })
          }
        })
      }
    }
  }
  return refs.sort((a, b) => a.createdAt - b.createdAt).map((ref) => ref.key)
}

function withoutEmbeddedImages(
  data: WorkspaceSessions,
  keysToRemove: Set<string>,
): WorkspaceSessions {
  const compactBucket = (workspace: Workspace): SessionBucket => ({
    ...data[workspace],
    conversations: data[workspace].conversations.map((conversation) => ({
      ...conversation,
      turns: conversation.turns.map((turn) => ({
        ...turn,
        images: turn.images.filter(
          (_url, index) =>
            !keysToRemove.has(`${workspace}:${conversation.id}:${turn.id}:${index}`),
        ),
      })),
    })),
  })

  return {
    banana: compactBucket('banana'),
    gpt: compactBucket('gpt'),
  }
}

/**
 * Save complete history when possible. If browser storage is full, remove only
 * the minimum number of oldest embedded image payloads needed to fit, while
 * preserving chat text, conversation metadata, and newer images.
 */
export function saveWorkspaceSessions(data: WorkspaceSessions): SessionsSaveResult {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(data))
    return { status: 'saved', trimmedImages: 0 }
  } catch {
    const keys = embeddedImageKeys(data)
    if (keys.length === 0) return { status: 'failed', trimmedImages: 0 }

    let low = 1
    let high = keys.length
    let best = -1
    while (low <= high) {
      const count = Math.floor((low + high) / 2)
      const compacted = withoutEmbeddedImages(data, new Set(keys.slice(0, count)))
      try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(compacted))
        best = count
        high = count - 1
      } catch {
        low = count + 1
      }
    }

    if (best > 0) {
      const compacted = withoutEmbeddedImages(data, new Set(keys.slice(0, best)))
      try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(compacted))
        return { status: 'trimmed', trimmedImages: best }
      } catch {
        // Storage can change between attempts; report failure below.
      }
    }
    return { status: 'failed', trimmedImages: 0 }
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
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULT_SETTINGS.baseUrl,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULT_SETTINGS.apiKey,
      model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_SETTINGS.model,
      theme:
        parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
          ? parsed.theme
          : DEFAULT_SETTINGS.theme,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface StoredUiState {
  workspace?: Workspace
  imagePreferences?: Partial<Record<Workspace, Partial<ImagePreferences>>>
}

function loadUiState(): StoredUiState {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as StoredUiState) : {}
  } catch {
    return {}
  }
}

function saveUiState(next: StoredUiState): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(next))
  } catch {
    // UI preferences are best-effort.
  }
}

const ASPECT_RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4']
const IMAGE_SIZES: ImageSize[] = ['1K', '2K', '4K']
const IMAGE_QUALITIES: ImageQuality[] = ['auto', 'low', 'medium', 'high']

function normalizeImagePreferences(
  value: Partial<ImagePreferences> | undefined,
  fallback: ImagePreferences,
): ImagePreferences {
  return {
    aspectRatio: ASPECT_RATIOS.includes(value?.aspectRatio as AspectRatio)
      ? (value?.aspectRatio as AspectRatio)
      : fallback.aspectRatio,
    imageSize: IMAGE_SIZES.includes(value?.imageSize as ImageSize)
      ? (value?.imageSize as ImageSize)
      : fallback.imageSize,
    imageQuality: IMAGE_QUALITIES.includes(value?.imageQuality as ImageQuality)
      ? (value?.imageQuality as ImageQuality)
      : fallback.imageQuality,
  }
}

export function loadWorkspaceImagePreferences(): WorkspaceImagePreferences {
  const stored = loadUiState().imagePreferences
  return {
    banana: normalizeImagePreferences(stored?.banana, DEFAULT_IMAGE_PREFERENCES.banana),
    gpt: normalizeImagePreferences(stored?.gpt, DEFAULT_IMAGE_PREFERENCES.gpt),
  }
}

export function saveWorkspaceImagePreferences(preferences: WorkspaceImagePreferences): void {
  saveUiState({ ...loadUiState(), imagePreferences: preferences })
}

export function loadLastWorkspace(): Workspace {
  return loadUiState().workspace === 'gpt' ? 'gpt' : 'banana'
}

export function saveLastWorkspace(workspace: Workspace): void {
  saveUiState({ ...loadUiState(), workspace })
}
