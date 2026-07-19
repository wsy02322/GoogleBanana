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
import {
  idbDeleteImages,
  idbGetImage,
  idbGetSessionsRecord,
  idbListImageIds,
  idbPutImages,
  idbPutSessionsRecord,
  imageRefId,
  isImageRef,
  newImageId,
  toImageRef,
} from './idb'

const SETTINGS_KEY = 'googlebanana.settings.v1'
const SESSIONS_KEY_V1 = 'googlebanana.sessions.v1'
const SESSIONS_KEY = 'googlebanana.sessions.v2'
const UI_KEY = 'googlebanana.ui.v1'
const LEGACY_HISTORY_KEY = 'googlebanana.history.v1'
const SESSIONS_BACKEND_KEY = 'googlebanana.sessions.backend.v1'

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
  backend: 'idb' | 'localStorage'
  warning?: string
}

export interface SessionsLoadResult {
  sessions: WorkspaceSessions
  backend: 'idb' | 'localStorage'
  warning?: string
}

type SessionsBackend = 'idb' | 'localStorage'

let preferredBackend: SessionsBackend | null = null
let saveChain: Promise<void> = Promise.resolve()
/** Reuse Blob IDs for unchanged in-memory image URLs within this page session. */
const urlToImageIdCache = new Map<string, string>()

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

export function emptyWorkspaceSessions(): WorkspaceSessions {
  return {
    banana: emptyBucket(),
    gpt: emptyBucket(),
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

function isWorkspaceSessions(value: unknown): value is WorkspaceSessions {
  if (!value || typeof value !== 'object') return false
  const v = value as WorkspaceSessions
  return Boolean(v.banana && v.gpt)
}

function normalizeWorkspaceSessions(value: WorkspaceSessions): WorkspaceSessions {
  return {
    banana: normalizeBucket(value.banana),
    gpt: normalizeBucket(value.gpt),
  }
}

function readBackendPreference(): SessionsBackend | null {
  try {
    const raw = localStorage.getItem(SESSIONS_BACKEND_KEY)
    return raw === 'idb' || raw === 'localStorage' ? raw : null
  } catch {
    return null
  }
}

function writeBackendPreference(backend: SessionsBackend): void {
  preferredBackend = backend
  try {
    localStorage.setItem(SESSIONS_BACKEND_KEY, backend)
  } catch {
    // ignore
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

function migrateLegacyHistory(): SessionBucket | null {
  const turns = loadLegacyHistory()
  if (turns.length === 0) return null
  const conv = createConversation(turns)
  try {
    localStorage.removeItem(LEGACY_HISTORY_KEY)
  } catch {
    // ignore
  }
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

function readLocalStorageSessionsRaw(): WorkspaceSessions | null {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isWorkspaceSessions(parsed)) return normalizeWorkspaceSessions(parsed)
    }
  } catch {
    // fall through
  }

  const fromV1 = loadSessionsV1()
  const fromLegacy = fromV1 ? null : migrateLegacyHistory()
  if (!fromV1 && !fromLegacy) return null

  return {
    banana: normalizeBucket(fromV1 ?? fromLegacy),
    gpt: emptyBucket(),
  }
}

function clearLegacyLocalSessionKeys(): void {
  try {
    localStorage.removeItem(SESSIONS_KEY)
    localStorage.removeItem(SESSIONS_KEY_V1)
    localStorage.removeItem(LEGACY_HISTORY_KEY)
  } catch {
    // ignore
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Invalid data URL')
  const header = dataUrl.slice(0, comma)
  const data = dataUrl.slice(comma + 1)
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
  const isBase64 = /;base64/i.test(header)
  if (isBase64) {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(data)], { type: mime })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read image blob.'))
    reader.readAsDataURL(blob)
  })
}

async function urlToBlob(url: string): Promise<Blob | null> {
  if (url.startsWith('data:image/')) {
    try {
      return dataUrlToBlob(url)
    } catch {
      return null
    }
  }
  if (url.startsWith('blob:') || /^https?:\/\//i.test(url)) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return await res.blob()
    } catch {
      return null
    }
  }
  return null
}

async function mapTurnImages(
  sessions: WorkspaceSessions,
  mapper: (url: string) => Promise<string | null>,
): Promise<WorkspaceSessions> {
  const mapBucket = async (bucket: SessionBucket): Promise<SessionBucket> => ({
    ...bucket,
    conversations: await Promise.all(
      bucket.conversations.map(async (conversation) => ({
        ...conversation,
        turns: await Promise.all(
          conversation.turns.map(async (turn) => ({
            ...turn,
            images: (
              await Promise.all(turn.images.map(async (url) => mapper(url)))
            ).filter((url): url is string => typeof url === 'string' && url.length > 0),
          })),
        ),
      })),
    ),
  })

  return {
    banana: await mapBucket(sessions.banana),
    gpt: await mapBucket(sessions.gpt),
  }
}

function collectImageRefs(sessions: WorkspaceSessions): Set<string> {
  const ids = new Set<string>()
  for (const workspace of ['banana', 'gpt'] as const) {
    for (const conversation of sessions[workspace].conversations) {
      for (const turn of conversation.turns) {
        for (const url of turn.images) {
          if (isImageRef(url)) ids.add(imageRefId(url))
        }
      }
    }
  }
  return ids
}

async function hydrateSessions(persisted: WorkspaceSessions): Promise<WorkspaceSessions> {
  return mapTurnImages(persisted, async (url) => {
    if (!isImageRef(url)) return url
    const id = imageRefId(url)
    const blob = await idbGetImage(id)
    if (!blob) return null
    try {
      const dataUrl = await blobToDataUrl(blob)
      urlToImageIdCache.set(dataUrl, id)
      return dataUrl
    } catch {
      return null
    }
  })
}

async function persistSessionsForIdb(
  live: WorkspaceSessions,
): Promise<{ persisted: WorkspaceSessions; imageEntries: Array<{ id: string; blob: Blob }> }> {
  const imageEntries: Array<{ id: string; blob: Blob }> = []
  const writtenIds = new Set<string>()

  const persisted = await mapTurnImages(live, async (url) => {
    if (isImageRef(url)) return url

    const cachedId = urlToImageIdCache.get(url)
    if (cachedId) return toImageRef(cachedId)

    const blob = await urlToBlob(url)
    if (!blob) {
      // Keep compact remote URLs when blob conversion fails.
      return /^https?:\/\//i.test(url) ? url : null
    }
    const id = newImageId()
    urlToImageIdCache.set(url, id)
    if (!writtenIds.has(id)) {
      imageEntries.push({ id, blob })
      writtenIds.add(id)
    }
    return toImageRef(id)
  })

  return { persisted, imageEntries }
}

async function gcUnreferencedImages(persisted: WorkspaceSessions): Promise<void> {
  const referenced = collectImageRefs(persisted)
  const existing = await idbListImageIds()
  const stale = existing.filter((id) => !referenced.has(id))
  await idbDeleteImages(stale)
}

function embeddedImageKeys(data: WorkspaceSessions): string[] {
  const refs: Array<{ key: string; createdAt: number }> = []
  for (const workspace of ['banana', 'gpt'] as const) {
    for (const conversation of data[workspace].conversations) {
      for (const turn of conversation.turns) {
        turn.images.forEach((url, index) => {
          if (url.startsWith('data:image/') || isImageRef(url) || url.startsWith('blob:')) {
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

function saveToLocalStorageWithTrim(data: WorkspaceSessions): SessionsSaveResult {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(data))
    writeBackendPreference('localStorage')
    return { status: 'saved', trimmedImages: 0, backend: 'localStorage' }
  } catch {
    const keys = embeddedImageKeys(data)
    if (keys.length === 0) {
      return {
        status: 'failed',
        trimmedImages: 0,
        backend: 'localStorage',
        warning:
          'Browser storage is full. Chat history may not survive a reload; download important images now.',
      }
    }

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
        writeBackendPreference('localStorage')
        return {
          status: 'trimmed',
          trimmedImages: best,
          backend: 'localStorage',
          warning: `${best} older embedded image${best === 1 ? ' was' : 's were'} removed from saved browser history to fit storage. Chat text is preserved. Download images you want to keep.`,
        }
      } catch {
        // fall through
      }
    }

    return {
      status: 'failed',
      trimmedImages: 0,
      backend: 'localStorage',
      warning:
        'Browser storage is full. Chat history may not survive a reload; download important images now.',
    }
  }
}

async function saveToIdb(data: WorkspaceSessions): Promise<SessionsSaveResult> {
  const { persisted, imageEntries } = await persistSessionsForIdb(data)
  await idbPutImages(imageEntries)
  await idbPutSessionsRecord(persisted)
  await gcUnreferencedImages(persisted)
  writeBackendPreference('idb')
  // Keep localStorage from holding bulky duplicates after a successful IDB write.
  clearLegacyLocalSessionKeys()
  return { status: 'saved', trimmedImages: 0, backend: 'idb' }
}

/**
 * Async session loader. Prefers IndexedDB (images as Blobs + text sessions).
 * Migrates legacy localStorage histories automatically. Falls back to
 * localStorage when IndexedDB is unavailable.
 */
export async function loadWorkspaceSessionsAsync(): Promise<SessionsLoadResult> {
  preferredBackend = preferredBackend ?? readBackendPreference()

  try {
    const existing = await idbGetSessionsRecord<WorkspaceSessions>()
    if (existing && isWorkspaceSessions(existing)) {
      const sessions = await hydrateSessions(normalizeWorkspaceSessions(existing))
      writeBackendPreference('idb')
      return { sessions, backend: 'idb' }
    }

    const fromLocal = readLocalStorageSessionsRaw()
    if (fromLocal) {
      await saveToIdb(fromLocal)
      const persisted = await idbGetSessionsRecord<WorkspaceSessions>()
      const sessions = await hydrateSessions(
        persisted && isWorkspaceSessions(persisted)
          ? normalizeWorkspaceSessions(persisted)
          : fromLocal,
      )
      return {
        sessions: normalizeWorkspaceSessions(sessions),
        backend: 'idb',
        warning: 'Migrated chat history to IndexedDB for larger image storage.',
      }
    }

    const empty = emptyWorkspaceSessions()
    await saveToIdb(empty)
    return { sessions: empty, backend: 'idb' }
  } catch {
    // Fall through to localStorage.
  }

  const local = readLocalStorageSessionsRaw() ?? emptyWorkspaceSessions()
  writeBackendPreference('localStorage')
  return {
    sessions: local,
    backend: 'localStorage',
    warning:
      'IndexedDB is unavailable; using limited browser storage. Download important images in case history is trimmed.',
  }
}

/**
 * Persist live in-memory sessions. Images are stored as Blobs in IndexedDB when
 * possible; otherwise falls back to localStorage with oldest-image trimming.
 */
export function saveWorkspaceSessionsAsync(data: WorkspaceSessions): Promise<SessionsSaveResult> {
  const run = async (): Promise<SessionsSaveResult> => {
    const backend = preferredBackend ?? readBackendPreference() ?? 'idb'
    if (backend !== 'localStorage') {
      try {
        return await saveToIdb(data)
      } catch {
        const fallback = saveToLocalStorageWithTrim(data)
        return {
          ...fallback,
          warning:
            fallback.warning ||
            'Could not save to IndexedDB; fell back to limited browser storage. Download important images now.',
        }
      }
    }
    return saveToLocalStorageWithTrim(data)
  }

  const next = saveChain.then(run, run)
  saveChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** Synchronous empty bootstrap for React initial state before async hydrate. */
export function loadWorkspaceSessions(): WorkspaceSessions {
  return emptyWorkspaceSessions()
}

/** @deprecated Prefer saveWorkspaceSessionsAsync */
export function saveWorkspaceSessions(data: WorkspaceSessions): SessionsSaveResult {
  return saveToLocalStorageWithTrim(data)
}

/** @deprecated Prefer loadWorkspaceSessionsAsync */
export function loadSessions(): SessionBucket {
  return loadWorkspaceSessions().banana
}

/** @deprecated Prefer saveWorkspaceSessionsAsync */
export function saveSessions(data: SessionBucket): void {
  saveToLocalStorageWithTrim({ ...emptyWorkspaceSessions(), banana: data })
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
