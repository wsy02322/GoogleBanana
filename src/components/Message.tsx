import { useState } from 'react'
import type { Turn } from '../lib/types'
import { bananaModeLabel } from '../lib/openrouter'
import { downloadDataUrl } from '../lib/image'
import { DownloadIcon, RefreshIcon, ChevronIcon } from './icons'

interface Props {
  turn: Turn
  busy?: boolean
  onRedoWithPro?: (turn: Turn) => void
}

export default function Message({ turn, busy, onRedoWithPro }: Props) {
  const isUser = turn.role === 'user'
  const [showReasoning, setShowReasoning] = useState(false)
  const canRedo =
    !isUser &&
    !turn.pending &&
    !turn.error &&
    turn.bananaMode &&
    turn.bananaMode !== 'pro' &&
    typeof onRedoWithPro === 'function'

  const pendingLabel =
    turn.searchGrounding && turn.searchGrounding !== 'off'
      ? 'Searching & generating…'
      : turn.bananaMode === 'thinking' || turn.bananaMode === 'pro'
        ? 'Thinking & generating…'
        : 'Generating image…'

  return (
    <div className={`flex w-full animate-fade-in ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
        {turn.text && (
          <div
            className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
              isUser
                ? 'bg-gray-900 text-white dark:bg-banana-400 dark:text-gray-900'
                : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
            }`}
          >
            {turn.text}
          </div>
        )}

        {turn.pending && (
          <div className="flex items-center gap-3 rounded-2xl bg-gray-100 px-4 py-3 dark:bg-gray-800">
            <span className="relative flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-banana-400 opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-banana-500" />
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">{pendingLabel}</span>
          </div>
        )}

        {turn.error && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {turn.error}
          </div>
        )}

        {!isUser && !turn.pending && (turn.reasoning || (turn.citations && turn.citations.length > 0)) && (
          <div className="w-full space-y-2">
            {turn.reasoning && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                <button
                  type="button"
                  onClick={() => setShowReasoning((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-300"
                >
                  <ChevronIcon
                    className={`h-3.5 w-3.5 transition ${showReasoning ? 'rotate-90' : ''}`}
                  />
                  Thinking process
                  {turn.bananaMode && (
                    <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      {bananaModeLabel(turn.bananaMode)}
                    </span>
                  )}
                </button>
                {showReasoning && (
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
                    {turn.reasoning}
                  </pre>
                )}
              </div>
            )}

            {turn.citations && turn.citations.length > 0 && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
                <p className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
                  Search sources
                </p>
                <ul className="space-y-1">
                  {turn.citations.map((c, i) => (
                    <li key={`${c.url}-${i}`} className="text-xs">
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                        title={c.content || c.title}
                      >
                        {c.title || c.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {turn.images.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {turn.images.map((url, i) => (
              <figure
                key={i}
                className="group relative overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700"
              >
                <img src={url} alt={`generated ${i + 1}`} className="w-full" />
                {!isUser && (
                  <button
                    onClick={() => downloadDataUrl(url, `googlebanana-${turn.id}-${i + 1}.png`)}
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white opacity-0 transition group-hover:opacity-100"
                    aria-label="Download image"
                    title="Download"
                  >
                    <DownloadIcon className="h-4 w-4" />
                  </button>
                )}
              </figure>
            ))}
          </div>
        )}

        {canRedo && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRedoWithPro?.(turn)}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600"
            title="Regenerate with Nano Banana Pro"
          >
            <RefreshIcon className="h-3.5 w-3.5" />
            Redo with Pro
          </button>
        )}
      </div>
    </div>
  )
}
