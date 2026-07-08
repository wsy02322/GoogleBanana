import type { Settings, Turn } from './types'

const SETTINGS_KEY = 'googlebanana.settings.v1'
const HISTORY_KEY = 'googlebanana.history.v1'

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

export function loadHistory(): Turn[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Turn[]
  } catch {
    return []
  }
}

export function saveHistory(turns: Turn[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(turns))
  } catch {
    // Ignore quota errors (base64 images can be large); history is best-effort.
  }
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}
