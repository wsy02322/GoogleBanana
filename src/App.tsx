import { useEffect, useMemo, useRef, useState } from 'react'
import type { AspectRatio, ImageSize, Settings, SessionsData, Turn } from './lib/types'
import {
  loadSettings,
  saveSettings,
  loadSessions,
  saveSessions,
  createConversation,
  conversationTitle,
} from './lib/storage'
import { generateImage } from './lib/openrouter'
import Composer from './components/Composer'
import Message from './components/Message'
import SettingsModal from './components/SettingsModal'
import Sidebar from './components/Sidebar'
import { MenuIcon, PlusIcon, SettingsIcon, SunIcon, MoonIcon } from './components/icons'

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function applyTheme(theme: Settings['theme']) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
}

const EXAMPLE_PROMPTS = [
  'A photorealistic banana astronaut floating in space, cinematic lighting',
  'A cozy Scandinavian living room at golden hour, ultra detailed',
  'Logo for a fruit startup called "GoogleBanana", minimal flat vector',
  'A watercolor painting of Tokyo streets in the rain at night',
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
    setSettings(next)
    saveSettings(next)
    setShowSettings(false)
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

  return (
    <div className="flex h-full bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
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
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
              aria-label="Open chat history"
              title="Chat history"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <span className="text-2xl">🍌</span>
            <h1 className="truncate text-lg font-semibold">GoogleBanana</h1>
            <span className="hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 sm:inline dark:bg-gray-800 dark:text-gray-400">
              {settings.model || 'no model'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={newChat}
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="New chat"
              title="New chat"
            >
              <PlusIcon className="h-5 w-5" />
            </button>
            <button
              onClick={toggleTheme}
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              <SunIcon className="h-5 w-5 dark:hidden" />
              <MoonIcon className="hidden h-5 w-5 dark:block" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
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
              <div className="mb-4 text-6xl">🍌</div>
              <h2 className="mb-2 text-2xl font-semibold">Generate images with nano banana</h2>
              <p className="mb-8 text-gray-500 dark:text-gray-400">
                {hasKey
                  ? 'Type a prompt below, or attach an image to edit it.'
                  : 'Add your API key in Settings to get started.'}
              </p>
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    disabled={!hasKey || busy}
                    onClick={() => send(p, [])}
                    className="rounded-xl border border-gray-200 p-3 text-left text-sm text-gray-700 transition hover:border-banana-400 hover:bg-banana-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:border-banana-400 dark:hover:bg-gray-900"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
              {turns.map((t) => (
                <Message key={t.id} turn={t} />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-4 py-4 dark:border-gray-800">
          <Composer
            disabled={!hasKey || busy}
            aspectRatio={aspectRatio}
            imageSize={imageSize}
            onChangeAspectRatio={setAspectRatio}
            onChangeImageSize={setImageSize}
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
