import { useEffect, useRef, useState } from 'react'
import type { CapabilityReport, Turn } from '../lib/types'
import { bananaModeHint, bananaModeLabel } from '../lib/openrouter'
import { downloadDataUrl } from '../lib/image'
import { DownloadIcon, RefreshIcon, ChevronIcon, InfoIcon } from './icons'

interface Props {
  turn: Turn
  busy?: boolean
  onRedoWithPro?: (turn: Turn) => void
}

type ChipTone = 'ok' | 'warn' | 'muted' | 'info'

interface StatusChip {
  key: string
  label: string
  tone: ChipTone
  /** Short headline inside the info popover */
  infoTitle: string
  /** Plain-language explanation for ordinary users */
  infoBody: string
}

function chipClass(tone: ChipTone): string {
  if (tone === 'ok') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
  }
  if (tone === 'warn') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
  }
  if (tone === 'info') {
    return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300'
  }
  return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
}

function buildStatusChips(report: CapabilityReport): StatusChip[] {
  const chips: StatusChip[] = []

  chips.push(
    report.imageOk
      ? {
          key: 'image',
          label: 'Image ready',
          tone: 'ok',
          infoTitle: 'Image generated',
          infoBody: 'This request returned an image. You can view or download it.',
        }
      : {
          key: 'image',
          label: 'No image',
          tone: 'warn',
          infoTitle: 'No image received',
          infoBody: 'The model did not return an image. Try another prompt, or switch Fast / Thinking / Pro and retry.',
        },
  )

  chips.push({
    key: 'mode',
    label: bananaModeLabel(report.mode),
    tone: 'info',
    infoTitle: `Mode: ${bananaModeLabel(report.mode)}`,
    infoBody: `${bananaModeHint(report.mode)}. Model: ${report.model}`,
  })

  if (report.thinking === 'returned') {
    chips.push({
      key: 'think',
      label: 'Thinking shown',
      tone: 'ok',
      infoTitle: 'Thinking text returned',
      infoBody: 'The model included its thinking in the reply. Open “Thinking process” below to read it.',
    })
  } else if (report.thinking === 'not_returned') {
    chips.push({
      key: 'think',
      label: 'Thinking hidden',
      tone: 'warn',
      infoTitle: 'No thinking text',
      infoBody:
        'Deeper thinking was requested, but no thinking text came back. The model may still have thought behind the scenes.',
    })
  } else {
    chips.push({
      key: 'think',
      label: 'Light thinking',
      tone: 'muted',
      infoTitle: 'Fast mode',
      infoBody: 'Fast mode uses light thinking for speed, so a detailed thinking trace usually is not shown.',
    })
  }

  if (report.searchEvidence === 'off') {
    chips.push({
      key: 'search',
      label: 'Search off',
      tone: 'muted',
      infoTitle: 'Search was not used',
      infoBody: 'Web search was off for this image. It was generated from the model’s existing knowledge only.',
    })
  } else if (report.searchEvidence === 'cited') {
    chips.push({
      key: 'search',
      label: report.searchFallback
        ? `Search used (web) · ${report.citationCount}`
        : `Search used · ${report.citationCount}`,
      tone: 'ok',
      infoTitle: 'Search results appear in the reply',
      infoBody: report.searchFallback
        ? `Image search was unavailable, so web search was used instead. ${report.citationCount} source(s) are listed in the reply — the strongest sign search entered the text output. We still cannot prove those facts changed the final image.`
        : `${report.citationCount} source(s) are listed in the reply — the strongest sign search entered the model output. We still cannot prove those facts changed the final image.`,
    })
  } else if (report.searchEvidence === 'called') {
    chips.push({
      key: 'search',
      label: 'Search ran',
      tone: 'warn',
      infoTitle: 'Search ran, use unclear',
      infoBody: `Search was called${typeof report.searchCalls === 'number' ? ` ${report.searchCalls} time(s)` : ''}, but no sources were listed. We know a search happened, not whether results shaped the reply or the image.`,
    })
  } else if (report.searchEvidence === 'fallback') {
    chips.push({
      key: 'search',
      label: 'Search limited',
      tone: 'warn',
      infoTitle: 'Image search unavailable',
      infoBody:
        'You chose Web + Image Search, but image search was unavailable. We fell back to web search and still saw no clear sources. The image likely did not use live search.',
    })
  } else {
    chips.push({
      key: 'search',
      label: 'Search unused?',
      tone: 'warn',
      infoTitle: 'No search evidence',
      infoBody:
        'Search was on, but there were no search calls and no sources. The model probably skipped search, and the image was mostly from existing knowledge.',
    })
  }

  return chips
}

function CapabilityChips({ report }: { report: CapabilityReport }) {
  const chips = buildStatusChips(report)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openKey) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenKey(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenKey(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openKey])

  const openChip = chips.find((c) => c.key === openKey) ?? null

  return (
    <div ref={rootRef} className="relative w-full space-y-1.5">
      <div className="flex flex-wrap gap-1.5" aria-label="Capability check">
        {chips.map((c) => {
          const active = openKey === c.key
          return (
            <button
              key={c.key}
              type="button"
              aria-expanded={active}
              aria-controls={`capability-info-${c.key}`}
              onClick={() => setOpenKey((prev) => (prev === c.key ? null : c.key))}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${chipClass(c.tone)} ${
                active ? 'ring-2 ring-offset-1 ring-gray-300 dark:ring-gray-600 dark:ring-offset-gray-950' : ''
              }`}
            >
              <span>{c.label}</span>
              <InfoIcon className="h-3 w-3 opacity-70" />
            </button>
          )
        })}
      </div>

      {openChip && (
        <div
          id={`capability-info-${openChip.key}`}
          role="dialog"
          aria-label={openChip.infoTitle}
          className="animate-fade-in rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{openChip.infoTitle}</p>
            <button
              type="button"
              onClick={() => setOpenKey(null)}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Close info"
            >
              Close
            </button>
          </div>
          <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">{openChip.infoBody}</p>
        </div>
      )}
    </div>
  )
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

        {!isUser && !turn.pending && !turn.error && turn.capability && (
          <CapabilityChips report={turn.capability} />
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
                <p className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">Search sources</p>
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
