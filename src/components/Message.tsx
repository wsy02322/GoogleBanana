import { useState } from 'react'
import type { CapabilityReport, Turn } from '../lib/types'
import { bananaModeLabel } from '../lib/openrouter'
import { downloadDataUrl } from '../lib/image'
import { DownloadIcon, RefreshIcon, ChevronIcon } from './icons'

interface Props {
  turn: Turn
  busy?: boolean
  onRedoWithPro?: (turn: Turn) => void
}

type ChipTone = 'ok' | 'warn' | 'muted' | 'info'

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

function CapabilityChips({ report }: { report: CapabilityReport }) {
  const chips: { key: string; label: string; tone: ChipTone; title: string }[] = []

  chips.push({
    key: 'image',
    label: report.imageOk ? 'Image ✓' : 'No image',
    tone: report.imageOk ? 'ok' : 'warn',
    title: report.imageOk ? 'Image payload returned' : 'No image in response',
  })

  chips.push({
    key: 'mode',
    label: bananaModeLabel(report.mode),
    tone: 'info',
    title: report.model,
  })

  if (report.thinking === 'returned') {
    chips.push({
      key: 'think',
      label: 'Thinking ✓',
      tone: 'ok',
      title: 'Visible reasoning text returned',
    })
  } else if (report.thinking === 'not_returned') {
    chips.push({
      key: 'think',
      label: 'Thinking · no text',
      tone: 'warn',
      title:
        'High thinking was requested, but the upstream response had no reasoning field. The model may still have thought server-side.',
    })
  } else {
    chips.push({
      key: 'think',
      label: 'Thinking · minimal',
      tone: 'muted',
      title: 'Fast mode uses minimal thinking',
    })
  }

  // Search evidence ladder — never claim pixel-level influence.
  const pixelCaveat =
    'Cannot verify from the API that search results changed the image pixels.'

  if (report.searchEvidence === 'off') {
    chips.push({
      key: 'search',
      label: 'Search off',
      tone: 'muted',
      title: 'No search grounding requested',
    })
  } else if (report.searchFallback && report.searchEvidence === 'fallback') {
    chips.push({
      key: 'search',
      label: 'Image search rejected',
      tone: 'warn',
      title: `Web + Image Search tool was rejected; fell back to web, but still no search calls or citations. ${pixelCaveat}`,
    })
  } else if (report.searchEvidence === 'none') {
    chips.push({
      key: 'search',
      label: 'Search · no proof',
      tone: 'warn',
      title: `Search was enabled, but no search calls and no citations were reported — results were probably not used. ${pixelCaveat}`,
    })
  } else if (report.searchEvidence === 'called') {
    chips.push({
      key: 'search',
      label: report.searchFallback
        ? `Image→Web · called · no cites${typeof report.searchCalls === 'number' ? ` · ${report.searchCalls}` : ''}`
        : `Search called · no cites${typeof report.searchCalls === 'number' ? ` · ${report.searchCalls}` : ''}`,
      tone: 'warn',
      title: `Upstream reported ${report.searchCalls ?? '?'} search call(s), but no url_citation annotations — we know search ran, not that results entered the reply or image. ${pixelCaveat}`,
    })
  } else {
    // cited — strongest verifiable signal
    chips.push({
      key: 'search',
      label: report.searchFallback
        ? `Image→Web · cited · ${report.citationCount}`
        : `Cited in reply · ${report.citationCount}`,
      tone: 'ok',
      title: `${report.citationCount} citation(s) in the response — strongest API proof that search results entered the model output. ${pixelCaveat}`,
    })
  }

  // Explicit second chip when search was on: pixel influence is never verified.
  if (report.searchRequested !== 'off') {
    chips.push({
      key: 'pixels',
      label:
        report.searchEvidence === 'cited'
          ? 'Pixels · unverified'
          : 'Pixels · not grounded',
      tone: report.searchEvidence === 'cited' ? 'info' : 'muted',
      title:
        report.searchEvidence === 'cited'
          ? 'Citations prove search entered the reply. Whether those facts affected the generated image cannot be verified from the API.'
          : 'No strong grounding evidence in the response, so search likely did not meaningfully condition the image.',
    })
  }

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Capability check">
      {chips.map((c) => (
        <span
          key={c.key}
          title={c.title}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${chipClass(c.tone)}`}
        >
          {c.label}
        </span>
      ))}
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
