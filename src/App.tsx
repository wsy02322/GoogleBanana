import { useEffect, useMemo, useRef, useState } from 'react'
import type { AspectRatio, ImageSize, IntelligenceLevel, Settings, SessionsData, Turn, UiMode } from './lib/types'
import {
  loadSettings,
  saveSettings,
  loadSessions,
  saveSessions,
  createConversation,
  conversationTitle,
  modelOptionsForMode,
  resolveModelForMode,
} from './lib/storage'
import { generateImage } from './lib/openrouter'
import Composer from './components/Composer'
import Message from './components/Message'
import SettingsModal from './components/SettingsModal'
import Sidebar from './components/Sidebar'
import { MenuIcon, PlusIcon, SettingsIcon, SunIcon, MoonIcon, SparklesIcon } from './components/icons'

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function applyTheme(theme: Settings['theme']) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
}

const GEMINI_EXAMPLE_PROMPTS = [
  'A photorealistic banana astronaut floating in space, cinematic lighting',
  'A cozy Scandinavian living room at golden hour, ultra detailed',
  'Logo for a fruit startup called "GoogleBanana", minimal flat vector',
  'A watercolor painting of Tokyo streets in the rain at night',
]

const CHATGPT_EXAMPLE_PROMPTS = [
  'A serene mountain lake at dawn with mist rolling over the water',
  'Product photo of matte black headphones on a marble desk, soft studio light',
  'Illustrated poster for a jazz night, bold typography, 1950s style',
  'Close-up portrait of an elderly craftsman, natural window light',
]

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [sessions, setSessions] = useState<SessionsData>(() => loadSessions())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const isChatGpt = settings.uiMode === 'chatgpt'
  const modelOptions = useMemo(() => modelOptionsForMode(settings.uiMode), [settings.uiMode])

  const activeConversation = useMemo(() => {
    return (
      sessions.conversations.find((c) => c.id === sessions.activeId) ?? sessions.conversations[0]
    )
  }, [sessions])

  const turns = useMemo(() => activeConversation?.turns ?? [], [activeConversation])

  useEffect(() => applyTheme(settings.theme), [settings.theme])
  useEffect(() => saveSessions(sessions), [sessions])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, sessions.activeId])

  useEffect(() => {
    if (!settings.apiKey.trim()) setShowSettings(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasKey = useMemo(() => settings.apiKey.trim().length > 0, [settings.apiKey])

  const persistSettings = (next: Settings) => {
    setSettings(next)
    saveSettings(next)
  }

  const updateActiveTurns = (updater: Turn[] | ((prev: Turn[]) => Turn[])) => {
    if (!activeConversation) return
    setSessions((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) => {
        if (c.id !== prev.activeId) return c
        const nextTurns = typeof updater === 'function' ? updater(c.turns) : updater
        const title = c.title === 'New chat' ? conversationTitle(nextTurns) : c.title
        return { ...c, turns: nextTurns, title, updatedAt: Date.now() }
      }),
    }))
  }

  const handleSaveSettings = (next: Settings) => {
    persistSettings(next)
    setShowSettings(false)
  }

  const switchUiMode = (mode: UiMode) => {
    if (busy || mode === settings.uiMode) return
    persistSettings({
      ...settings,
      uiMode: mode,
      model: resolveModelForMode(settings.model, mode),
    })
  }

  const setIntelligence = (intelligence: IntelligenceLevel) => {
    persistSettings({ ...settings, intelligence })
  }

  const setModel = (model: string) => {
    persistSettings({ ...settings, model })
  }

  const selectConversation = (id: string) => {
    if (busy) return
    setSessions((prev) => ({ ...prev, activeId: id }))
  }

  const newChat = () => {
    if (busy) return
    const current = sessions.conversations.find((c) => c.id === sessions.activeId)
    if (current && current.turns.length === 0) return

    const conv = createConversation()
    setSessions((prev) => ({
      activeId: conv.id,
      conversations: [conv, ...prev.conversations],
    }))
  }

  const deleteConversation = (id: string) => {
    if (busy) return
    setSessions((prev) => {
      const remaining = prev.conversations.filter((c) => c.id !== id)
      if (remaining.length === 0) {
        const conv = createConversation()
        return { activeId: conv.id, conversations: [conv] }
      }
      const activeId =
        prev.activeId === id
          ? [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
          : prev.activeId
      return { activeId, conversations: remaining }
    })
  }

  const send = async (text: string, images: string[]) => {
    if (busy || !activeConversation) return
    const userTurn: Turn = { id: uid(), role: 'user', text, images, createdAt: Date.now() }
    const assistantTurn: Turn = {
      id: uid(),
      role: 'assistant',
      text: '',
      images: [],
      createdAt: Date.now(),
      pending: true,
    }
    const history = [...turns, userTurn]
    updateActiveTurns([...history, assistantTurn])
    setBusy(true)

    try {
      const result = await generateImage(settings, history, { aspectRatio, imageSize })
      updateActiveTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurn.id
            ? { ...t, pending: false, text: result.text, images: result.images }
            : t,
        ),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      updateActiveTurns((prev) =>
        prev.map((t) => (t.id === assistantTurn.id ? { ...t, pending: false, error: message } : t)),
      )
    } finally {
      setBusy(false)
    }
  }

  const toggleTheme = () => {
    const next: Settings['theme'] = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    handleSaveSettings({ ...settings, theme: next })
  }

  const isEmpty = turns.length === 0
  const examplePrompts = isChatGpt ? CHATGPT_EXAMPLE_PROMPTS : GEMINI_EXAMPLE_PROMPTS
  const intelligenceLabel =
    settings.intelligence.charAt(0).toUpperCase() + settings.intelligence.slice(1)

  return (
    <div
      className={`flex h-full ${
        isChatGpt
          ? 'bg-chatgpt-bg text-gray-900 dark:bg-chatgpt-bg-dark dark:text-gray-100'
          : 'bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100'
      }`}
    >
      <Sidebar
        conversations={sessions.conversations}
        activeId={sessions.activeId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectConversation}
        onNewChat={newChat}
        onDelete={deleteConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`flex items-center justify-between px-4 py-3 ${
            isChatGpt
              ? 'border-b border-chatgpt-border/80 dark:border-chatgpt-border-dark'
              : 'border-b border-gray-100 dark:border-gray-800'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-full p-2 text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/10 lg:hidden"
              aria-label="Open chat history"
              title="Chat history"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            {isChatGpt ? (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-chatgpt-accent text-white">
                  <SparklesIcon className="h-4 w-4" />
                </span>
                <h1 className="truncate text-lg font-semibold tracking-tight">ChatGPT Image</h1>
                <span className="hidden rounded-full bg-chatgpt-surface px-2.5 py-0.5 text-xs text-gray-500 sm:inline dark:bg-chatgpt-surface-dark dark:text-gray-400">
                  {settings.model} · {intelligenceLabel}
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl">🍌</span>
                <h1 className="truncate text-lg font-semibold">GoogleBanana</h1>
                <span className="hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 sm:inline dark:bg-gray-800 dark:text-gray-400">
                  {settings.model || 'no model'}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => switchUiMode(isChatGpt ? 'gemini' : 'chatgpt')}
              disabled={busy}
              className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition sm:inline-flex disabled:opacity-50 ${
                isChatGpt
                  ? 'bg-banana-100 text-gray-800 hover:bg-banana-300 dark:bg-banana-400/20 dark:text-banana-300 dark:hover:bg-banana-400/30'
                  : 'bg-chatgpt-accent/10 text-chatgpt-accent hover:bg-chatgpt-accent/20'
              }`}
              title={isChatGpt ? 'Switch to Gemini nano banana' : 'Switch to ChatGPT Image mode'}
            >
              {isChatGpt ? (
                <>🍌 Gemini</>
              ) : (
                <>
                  <SparklesIcon className="h-3.5 w-3.5" />
                  ChatGPT Image
                </>
              )}
            </button>
            <button
              onClick={() => switchUiMode(isChatGpt ? 'gemini' : 'chatgpt')}
              disabled={busy}
              className="rounded-full p-2 text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/10 sm:hidden disabled:opacity-50"
              aria-label={isChatGpt ? 'Switch to Gemini' : 'Switch to ChatGPT Image'}
              title={isChatGpt ? 'Switch to Gemini' : 'Switch to ChatGPT Image'}
            >
              {isChatGpt ? <span className="text-base leading-none">🍌</span> : <SparklesIcon className="h-5 w-5 text-chatgpt-accent" />}
            </button>
            <button
              onClick={newChat}
              className="rounded-full p-2 text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/10"
              aria-label="New chat"
              title="New chat"
            >
              <PlusIcon className="h-5 w-5" />
            </button>
            <button
              onClick={toggleTheme}
              className="rounded-full p-2 text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/10"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              <SunIcon className="h-5 w-5 dark:hidden" />
              <MoonIcon className="hidden h-5 w-5 dark:block" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-full p-2 text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/10"
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 text-center">
              {isChatGpt ? (
                <>
                  <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-chatgpt-accent text-white shadow-lg shadow-chatgpt-accent/25 animate-soft-pop">
                    <SparklesIcon className="h-7 w-7" />
                  </div>
                  <h2 className="mb-2 text-3xl font-semibold tracking-tight">Create an image</h2>
                  <p className="mb-8 max-w-md text-gray-500 dark:text-gray-400">
                    {hasKey
                      ? 'Describe what you want to see. Adjust Intelligence for quality vs speed.'
                      : 'Add your API key in Settings to get started.'}
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-4 text-6xl">🍌</div>
                  <h2 className="mb-2 text-2xl font-semibold">Generate images with nano banana</h2>
                  <p className="mb-8 text-gray-500 dark:text-gray-400">
                    {hasKey
                      ? 'Type a prompt below, or attach an image to edit it.'
                      : 'Add your API key in Settings to get started.'}
                  </p>
                </>
              )}
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                {examplePrompts.map((p) => (
                  <button
                    key={p}
                    disabled={!hasKey || busy}
                    onClick={() => send(p, [])}
                    className={`rounded-xl p-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isChatGpt
                        ? 'border border-chatgpt-border bg-chatgpt-surface text-gray-700 hover:bg-white dark:border-chatgpt-border-dark dark:bg-chatgpt-surface-dark dark:text-gray-300 dark:hover:bg-chatgpt-composer-dark'
                        : 'border border-gray-200 text-gray-700 hover:border-banana-400 hover:bg-banana-50 dark:border-gray-800 dark:text-gray-300 dark:hover:border-banana-400 dark:hover:bg-gray-900'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
              {turns.map((t) => (
                <Message key={t.id} turn={t} chatgpt={isChatGpt} />
              ))}
            </div>
          )}
        </div>

        <div
          className={`px-4 py-4 ${
            isChatGpt ? '' : 'border-t border-gray-100 dark:border-gray-800'
          }`}
        >
          <Composer
            disabled={!hasKey || busy}
            uiMode={settings.uiMode}
            aspectRatio={aspectRatio}
            imageSize={imageSize}
            intelligence={settings.intelligence}
            model={settings.model}
            modelOptions={modelOptions}
            onChangeAspectRatio={setAspectRatio}
            onChangeImageSize={setImageSize}
            onChangeIntelligence={setIntelligence}
            onChangeModel={setModel}
            onSend={send}
          />
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
