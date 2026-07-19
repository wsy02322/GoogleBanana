import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AspectRatio,
  BananaMode,
  GptImageMode,
  ImageSize,
  SearchGrounding,
  SessionBucket,
  Settings,
  Turn,
  Workspace,
  WorkspaceSessions,
} from './lib/types'
import {
  loadSettings,
  saveSettings,
  loadWorkspaceSessions,
  saveWorkspaceSessions,
  loadLastWorkspace,
  saveLastWorkspace,
  createConversation,
  conversationTitle,
} from './lib/storage'
import {
  generateImage,
  generateGptImage,
  generationAbortSignal,
  gptModeModelId,
  bananaModeLabel,
  bananaModeModelId,
} from './lib/openrouter'
import Composer from './components/Composer'
import Message from './components/Message'
import SettingsModal from './components/SettingsModal'
import Sidebar from './components/Sidebar'
import {
  MenuIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  MoonIcon,
} from './components/icons'

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
  "Infographic of today's weather in Tokyo with accurate current conditions",
  'Logo for a fruit startup called "GoogleBanana", minimal flat vector',
  'Use image search: a resplendent quetzal bird on a misty branch, natural light',
]

const GPT_EXAMPLE_PROMPTS = [
  'Four-panel infographic explaining OAuth 2.1 with labeled arrows in English and Japanese',
  'Product hero shot of a matte black mechanical keyboard, studio softbox lighting',
  'Technical cross-section of a bicycle hub with numbered callouts',
  'Editorial portrait of a chef plating dessert, shallow depth of field',
]

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [workspaceSessions, setWorkspaceSessions] = useState<WorkspaceSessions>(() =>
    loadWorkspaceSessions(),
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace>(() => loadLastWorkspace())
  const [gptMode, setGptMode] = useState<GptImageMode>('pro-thinking')
  const [bananaMode, setBananaMode] = useState<BananaMode>('thinking')
  const [searchGrounding, setSearchGrounding] = useState<SearchGrounding>('off')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [imageSize, setImageSize] = useState<ImageSize>('1K')
  const [modeNotice, setModeNotice] = useState<string | null>(null)
  const [busyByWorkspace, setBusyByWorkspace] = useState<Partial<Record<Workspace, boolean>>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const modeNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showModeNotice = (message: string) => {
    if (modeNoticeTimer.current) clearTimeout(modeNoticeTimer.current)
    setModeNotice(message)
    modeNoticeTimer.current = setTimeout(() => setModeNotice(null), 8000)
  }

  useEffect(() => {
    return () => {
      if (modeNoticeTimer.current) clearTimeout(modeNoticeTimer.current)
    }
  }, [])

  const sessions = workspaceSessions[workspace]
  const busy = Boolean(busyByWorkspace[workspace])
  const otherBusy =
    workspace === 'banana' ? Boolean(busyByWorkspace.gpt) : Boolean(busyByWorkspace.banana)

  const setWorkspaceBusy = (ws: Workspace, next: boolean) => {
    setBusyByWorkspace((prev) => ({ ...prev, [ws]: next }))
  }

  const activeConversation = useMemo(() => {
    return (
      sessions.conversations.find((c) => c.id === sessions.activeId) ?? sessions.conversations[0]
    )
  }, [sessions])

  const turns = useMemo(() => activeConversation?.turns ?? [], [activeConversation])

  useEffect(() => applyTheme(settings.theme), [settings.theme])
  useEffect(() => saveWorkspaceSessions(workspaceSessions), [workspaceSessions])
  useEffect(() => saveLastWorkspace(workspace), [workspace])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, sessions.activeId, workspace])

  useEffect(() => {
    if (!settings.apiKey.trim()) setShowSettings(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasKey = useMemo(() => settings.apiKey.trim().length > 0, [settings.apiKey])

  const updateWorkspaceBucket = (
    ws: Workspace,
    updater: SessionBucket | ((prev: SessionBucket) => SessionBucket),
  ) => {
    setWorkspaceSessions((prev) => {
      const nextBucket = typeof updater === 'function' ? updater(prev[ws]) : updater
      return { ...prev, [ws]: nextBucket }
    })
  }

  const updateConversationTurns = (
    ws: Workspace,
    conversationId: string,
    updater: Turn[] | ((prev: Turn[]) => Turn[]),
  ) => {
    updateWorkspaceBucket(ws, (prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) => {
        if (c.id !== conversationId) return c
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
    updateWorkspaceBucket(workspace, (prev) => ({ ...prev, activeId: id }))
  }

  const newChat = () => {
    if (busy) return
    const current = sessions.conversations.find((c) => c.id === sessions.activeId)
    if (current && current.turns.length === 0) return

    const conv = createConversation()
    updateWorkspaceBucket(workspace, (prev) => ({
      activeId: conv.id,
      conversations: [conv, ...prev.conversations],
    }))
  }

  const deleteConversation = (id: string) => {
    if (busy) return
    updateWorkspaceBucket(workspace, (prev) => {
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

  const enterGptWorkspace = () => {
    setWorkspace('gpt')
    setImageSize((prev) => (prev === '1K' ? '2K' : prev))
  }

  const leaveGptWorkspace = () => {
    setWorkspace('banana')
  }

  const changeBananaMode = (mode: BananaMode) => {
    setBananaMode(mode)
    // Native Image Search grounding is Nano Banana 2 only (Google docs).
    // Pro + Web is fine; Pro + Web/Image is not.
    if (mode === 'pro' && searchGrounding === 'web-image') {
      setSearchGrounding('web')
      showModeNotice(
        'Pro does not support the Web + Image lane. Switched to Web search. Use Fast/Thinking (Nano Banana 2) for Web + Image.',
      )
    }
  }

  const changeSearchGrounding = (search: SearchGrounding) => {
    setSearchGrounding(search)
    if (search === 'web-image' && bananaMode === 'pro') {
      setBananaMode('thinking')
      showModeNotice(
        'Web + Image uses Nano Banana 2 with OpenRouter web grounding (native Google Image Search is not available on this endpoint). Switched from Pro to Thinking.',
      )
    }
  }

  const runBananaGenerate = async (
    ws: Workspace,
    conversationId: string,
    history: Turn[],
    assistantId: string,
    mode: BananaMode,
    search: SearchGrounding,
  ) => {
    const result = await generateImage(
      settings,
      history,
      {
        aspectRatio,
        imageSize,
        bananaMode: mode,
        searchGrounding: search,
      },
      generationAbortSignal(),
    )
    updateConversationTurns(ws, conversationId, (prev) =>
      prev.map((t) =>
        t.id === assistantId
          ? {
              ...t,
              pending: false,
              text: result.text,
              images: result.images,
              reasoning: result.reasoning,
              citations: result.citations,
              bananaMode: result.bananaMode ?? mode,
              searchGrounding: result.searchGrounding ?? search,
              capability: result.capability,
            }
          : t,
      ),
    )
  }

  const send = async (text: string, images: string[]) => {
    if (busy || !activeConversation) return
    const jobWorkspace = workspace
    const jobConversationId = activeConversation.id
    const userTurn: Turn = { id: uid(), role: 'user', text, images, createdAt: Date.now() }
    const assistantTurn: Turn = {
      id: uid(),
      role: 'assistant',
      text: '',
      images: [],
      createdAt: Date.now(),
      pending: true,
      bananaMode: jobWorkspace === 'banana' ? bananaMode : undefined,
      searchGrounding: jobWorkspace === 'banana' ? searchGrounding : undefined,
      gptMode: jobWorkspace === 'gpt' ? gptMode : undefined,
    }
    const history = [...turns, userTurn]
    updateConversationTurns(jobWorkspace, jobConversationId, [...history, assistantTurn])
    setWorkspaceBusy(jobWorkspace, true)

    try {
      if (jobWorkspace === 'gpt') {
        const result = await generateGptImage(
          settings,
          history,
          {
            aspectRatio,
            imageSize,
            mode: gptMode,
          },
          generationAbortSignal(),
        )
        updateConversationTurns(jobWorkspace, jobConversationId, (prev) =>
          prev.map((t) =>
            t.id === assistantTurn.id
              ? {
                  ...t,
                  pending: false,
                  text: result.text,
                  images: result.images,
                  reasoning: result.reasoning,
                  gptMode,
                }
              : t,
          ),
        )
      } else {
        await runBananaGenerate(
          jobWorkspace,
          jobConversationId,
          history,
          assistantTurn.id,
          bananaMode,
          searchGrounding,
        )
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      let message =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'Request timed out after 10 minutes. Try Direct mode, or lower size to 1K.'
          : raw
      if (raw === 'Failed to fetch' || (err instanceof TypeError && /fetch/i.test(raw))) {
        message =
          'Connection lost while waiting for the image. Keep this browser tab open until the image finishes, or retry on a more stable network.'
      }
      updateConversationTurns(jobWorkspace, jobConversationId, (prev) =>
        prev.map((t) => (t.id === assistantTurn.id ? { ...t, pending: false, error: message } : t)),
      )
    } finally {
      setWorkspaceBusy(jobWorkspace, false)
    }
  }

  const redoWithPro = async (assistantTurn: Turn) => {
    if (busy || workspace !== 'banana' || !activeConversation) return
    const jobWorkspace = workspace
    const jobConversationId = activeConversation.id
    const idx = turns.findIndex((t) => t.id === assistantTurn.id)
    if (idx <= 0) return
    const history = turns.slice(0, idx).filter((t) => !t.error && !t.pending)

    const redoTurn: Turn = {
      id: uid(),
      role: 'assistant',
      text: '',
      images: [],
      createdAt: Date.now(),
      pending: true,
      bananaMode: 'pro',
      searchGrounding: assistantTurn.searchGrounding ?? searchGrounding,
    }
    updateConversationTurns(jobWorkspace, jobConversationId, [...turns, redoTurn])
    setWorkspaceBusy(jobWorkspace, true)
    setBananaMode('pro')

    try {
      await runBananaGenerate(
        jobWorkspace,
        jobConversationId,
        history,
        redoTurn.id,
        'pro',
        assistantTurn.searchGrounding ?? searchGrounding,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      updateConversationTurns(jobWorkspace, jobConversationId, (prev) =>
        prev.map((t) => (t.id === redoTurn.id ? { ...t, pending: false, error: message } : t)),
      )
    } finally {
      setWorkspaceBusy(jobWorkspace, false)
    }
  }

  const toggleTheme = () => {
    const next: Settings['theme'] = document.documentElement.classList.contains('dark')
      ? 'light'
      : 'dark'
    handleSaveSettings({ ...settings, theme: next })
  }

  const isEmpty = turns.length === 0
  const emptyPrompts = workspace === 'gpt' ? GPT_EXAMPLE_PROMPTS : EXAMPLE_PROMPTS
  const workspaceTitle = workspace === 'gpt' ? 'GPT Image' : 'GoogleBanana'
  const modeLine =
    workspace === 'gpt'
      ? `${gptMode === 'pro-thinking' ? 'Pro Thinking' : 'Direct'} · ${gptModeModelId(gptMode)}`
      : `${bananaModeLabel(bananaMode)} · ${bananaModeModelId(bananaMode)}`
  const switchLabel = workspace === 'gpt' ? 'switch to Banana' : 'switch to ChatGPT'
  const switchAction = workspace === 'gpt' ? leaveGptWorkspace : enterGptWorkspace

  return (
    <div className="flex h-full bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Sidebar
        conversations={sessions.conversations}
        activeId={sessions.activeId}
        workspace={workspace}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectConversation}
        onNewChat={newChat}
        onDelete={deleteConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2.5 dark:border-gray-800 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
              aria-label="Open chat history"
              title="Chat history"
            >
              <MenuIcon className="h-5 w-5" />
            </button>

            <span className="shrink-0 text-xl sm:text-2xl" aria-hidden>
              {workspace === 'gpt' ? '✨' : '🍌'}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h1 className="truncate text-base font-semibold sm:text-lg">{workspaceTitle}</h1>
                <span
                  className="max-w-full truncate text-xs text-gray-500 dark:text-gray-400 sm:text-sm"
                  title={modeLine}
                >
                  {modeLine}
                </span>
              </div>
              <button
                type="button"
                onClick={switchAction}
                className="mt-0.5 text-left text-xs font-medium text-banana-600 underline-offset-2 hover:underline dark:text-banana-400"
                aria-label={switchLabel}
                title="Switching workspaces keeps generation running. Closing this tab cancels it."
              >
                ({switchLabel})
              </button>
              {(busy || otherBusy) && (
                <p className="mt-0.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                  {otherBusy
                    ? 'Generation continues in the other workspace — result saves there. Closing this tab cancels it.'
                    : 'You can switch workspaces — generation keeps running. Closing this tab cancels it.'}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
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
              <div className="mb-4 text-6xl">{workspace === 'gpt' ? '✨' : '🍌'}</div>
              <h2 className="mb-2 text-2xl font-semibold">
                {workspace === 'gpt'
                  ? 'Generate with GPT Image on OpenRouter'
                  : 'Generate images with nano banana'}
              </h2>
              <p className="mb-8 text-gray-500 dark:text-gray-400">
                {!hasKey
                  ? 'Add your API key in Settings to get started.'
                  : workspace === 'gpt'
                    ? 'Pick Pro Thinking or Direct below, then describe an image.'
                    : 'Pick Fast / Thinking / Pro, optional search grounding, then describe an image.'}
              </p>
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                {emptyPrompts.map((p) => (
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
                <Message
                  key={t.id}
                  turn={t}
                  busy={busy}
                  onRedoWithPro={workspace === 'banana' ? redoWithPro : undefined}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-4 py-4 dark:border-gray-800">
          <Composer
            disabled={!hasKey || busy}
            workspace={workspace}
            gptMode={gptMode}
            bananaMode={bananaMode}
            searchGrounding={searchGrounding}
            aspectRatio={aspectRatio}
            imageSize={imageSize}
            modeNotice={workspace === 'banana' ? modeNotice : null}
            onDismissModeNotice={() => setModeNotice(null)}
            onChangeGptMode={setGptMode}
            onChangeBananaMode={changeBananaMode}
            onChangeSearchGrounding={changeSearchGrounding}
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
