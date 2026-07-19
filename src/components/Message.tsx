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
          label: '已出图',
          tone: 'ok',
          infoTitle: '图片已生成',
          infoBody: '这次请求成功返回了图片，可以直接查看或下载。',
        }
      : {
          key: 'image',
          label: '未出图',
          tone: 'warn',
          infoTitle: '没有收到图片',
          infoBody: '模型这次没有返回图片。可以换个提示词，或切换 Fast / Thinking / Pro 后再试。',
        },
  )

  chips.push({
    key: 'mode',
    label: bananaModeLabel(report.mode),
    tone: 'info',
    infoTitle: `模式：${bananaModeLabel(report.mode)}`,
    infoBody: `${bananaModeHint(report.mode)}。实际模型：${report.model}`,
  })

  if (report.thinking === 'returned') {
    chips.push({
      key: 'think',
      label: '思考可见',
      tone: 'ok',
      infoTitle: '思考过程已返回',
      infoBody: '模型把思考内容一并返回了。点下方「思考过程」可以展开查看它怎么想的。',
    })
  } else if (report.thinking === 'not_returned') {
    chips.push({
      key: 'think',
      label: '思考未显示',
      tone: 'warn',
      infoTitle: '没有看到思考内容',
      infoBody:
        '这次用了较深的思考模式，但回复里没有附带思考文本。模型后台可能仍在思考，只是我们看不到过程。',
    })
  } else {
    chips.push({
      key: 'think',
      label: '快速思考',
      tone: 'muted',
      infoTitle: '快速模式',
      infoBody: 'Fast 模式为了速度，只做很轻的思考，一般不会展开详细思考过程。',
    })
  }

  if (report.searchEvidence === 'off') {
    chips.push({
      key: 'search',
      label: '未开搜索',
      tone: 'muted',
      infoTitle: '没有使用搜索',
      infoBody: '这次没有打开联网搜索。图片只依据模型已有知识生成，不含实时网页信息。',
    })
  } else if (report.searchEvidence === 'cited') {
    chips.push({
      key: 'search',
      label: report.searchFallback
        ? `搜索已用上（网页）· ${report.citationCount}`
        : `搜索已用上 · ${report.citationCount}`,
      tone: 'ok',
      infoTitle: '搜索结果进入了回复',
      infoBody: report.searchFallback
        ? `图片搜索不可用，已改用网页搜索。回复里列出了 ${report.citationCount} 个来源，说明搜索内容进了文字回复。但系统无法确认这些信息是否真的改变了最终画面。`
        : `回复里列出了 ${report.citationCount} 个来源，这是目前能确认的最强信号：搜索结果进入了模型输出。但系统无法确认这些信息是否真的改变了最终画面。`,
    })
  } else if (report.searchEvidence === 'called') {
    chips.push({
      key: 'search',
      label: '搜索已调用',
      tone: 'warn',
      infoTitle: '搜索跑了，但看不出用没用上',
      infoBody: `检测到搜索被调用了${typeof report.searchCalls === 'number' ? ` ${report.searchCalls} 次` : ''}，但回复里没有来源链接。只能确定「搜过了」，不能确定结果有没有写进回复或影响画面。`,
    })
  } else if (report.searchEvidence === 'fallback') {
    chips.push({
      key: 'search',
      label: '搜索降级',
      tone: 'warn',
      infoTitle: '图片搜索不可用',
      infoBody:
        '你选了「网页 + 图片搜索」，但图片搜索接口不可用，已自动改用网页搜索；这次也没有看到明确的搜索来源。画面很可能没有用到实时搜索。',
    })
  } else {
    chips.push({
      key: 'search',
      label: '搜索可能没用上',
      tone: 'warn',
      infoTitle: '看不到搜索证据',
      infoBody:
        '你打开了搜索，但既没有搜索调用记录，也没有来源链接。更可能是模型这次跳过了搜索，画面主要靠已有知识生成。',
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
      <div className="flex flex-wrap gap-1.5" aria-label="能力检查">
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
              aria-label="关闭说明"
            >
              关闭
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
      ? '正在搜索并生成…'
      : turn.bananaMode === 'thinking' || turn.bananaMode === 'pro'
        ? '正在思考并生成…'
        : '正在生成图片…'

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
                  思考过程
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
                <p className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">搜索来源</p>
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
            用 Pro 重做
          </button>
        )}
      </div>
    </div>
  )
}
