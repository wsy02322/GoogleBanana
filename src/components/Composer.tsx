import { useEffect, useRef, useState } from 'react'
import type {
  AspectRatio,
  BananaMode,
  GptImageMode,
  ImageQuality,
  ImageSize,
  Workspace,
} from '../lib/types'
import {
  bananaModeHint,
  composerInfoSections,
  imageQualityCostHint,
} from '../lib/openrouter'
import { fileToDataUrl } from '../lib/image'
import InfoPopover, { InfoSection } from './InfoPopover'
import { ImageIcon, SendIcon, CloseIcon } from './icons'

interface Props {
  busy: boolean
  hasKey: boolean
  sessionsReady: boolean
  storageWarning?: string
  workspace: Workspace
  gptMode: GptImageMode
  bananaMode: BananaMode
  aspectRatio: AspectRatio
  imageSize: ImageSize
  imageQuality: ImageQuality
  onChangeGptMode: (v: GptImageMode) => void
  onChangeBananaMode: (v: BananaMode) => void
  onChangeAspectRatio: (v: AspectRatio) => void
  onChangeImageSize: (v: ImageSize) => void
  onChangeImageQuality: (v: ImageQuality) => void
  onNeedApiKey: () => void
  onSend: (text: string, images: string[]) => void
}

const ASPECT_RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4']
const IMAGE_SIZES: ImageSize[] = ['1K', '2K', '4K']
const IMAGE_QUALITIES: ImageQuality[] = ['auto', 'low', 'medium', 'high']

const GPT_MODES: { id: GptImageMode; label: string; hint: string }[] = [
  {
    id: 'pro-thinking',
    label: 'Pro Thinking',
    hint: 'gpt-5.4-image-2 · high reasoning · balances quality, multi-turn editing, and reasoning',
  },
  {
    id: 'direct',
    label: 'Direct',
    hint: 'gpt-image-2 · highest direct image quality · latest prompt only (no chat history)',
  },
]

const BANANA_MODES: { id: BananaMode; label: string }[] = [
  { id: 'fast', label: 'Fast' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'pro', label: 'Pro' },
]

export default function Composer({
  busy,
  hasKey,
  sessionsReady,
  storageWarning,
  workspace,
  gptMode,
  bananaMode,
  aspectRatio,
  imageSize,
  imageQuality,
  onChangeGptMode,
  onChangeBananaMode,
  onChangeAspectRatio,
  onChangeImageSize,
  onChangeImageQuality,
  onNeedApiKey,
  onSend,
}: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [actionHint, setActionHint] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const showGptQuality = workspace === 'gpt' && gptMode === 'direct'
  const infoSections = composerInfoSections(workspace, { gptMode, bananaMode })
  const infoTitle = workspace === 'gpt' ? 'GPT Image tips' : 'Banana tips'

  const hasContent = text.trim().length > 0 || images.length > 0
  const controlsDisabled = busy
  const sendInteractive = hasContent && !busy
  const sendDisabled = !sendInteractive

  useEffect(() => {
    if (sessionsReady && actionHint === 'Preparing your chat history…') {
      setActionHint(null)
    }
  }, [sessionsReady, actionHint])

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    try {
      const urls = await Promise.all(
        Array.from(files)
          .filter((f) => f.type.startsWith('image/'))
          .map(fileToDataUrl),
      )
      setImages((prev) => [...prev, ...urls])
      setActionHint(null)
    } catch {
      setActionHint('Could not attach that image. Try a different file.')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const submit = () => {
    if (!hasContent || busy) return

    if (!hasKey) {
      setActionHint('Add your OpenRouter API key in Settings to generate.')
      onNeedApiKey()
      return
    }

    if (!sessionsReady) {
      setActionHint('Preparing your chat history…')
      return
    }

    setActionHint(null)
    onSend(text.trim(), images)
    setText('')
    setImages([])
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {workspace === 'gpt' ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {GPT_MODES.map((m) => {
            const active = gptMode === m.id
            return (
              <button
                key={m.id}
                type="button"
                disabled={controlsDisabled}
                onClick={() => onChangeGptMode(m.id)}
                title={m.hint}
                className={pillClass(active)}
              >
                {m.label}
              </button>
            )
          })}
          <span className="hidden text-xs text-gray-400 dark:text-gray-500 sm:inline">
            {GPT_MODES.find((m) => m.id === gptMode)?.hint}
          </span>
          <div className="ml-auto">
            <InfoPopover label={`${infoTitle} — tap for details`} title={infoTitle} placement="above">
              {infoSections.map((section) => (
                <InfoSection key={section.title} title={section.title} lines={section.lines} />
              ))}
            </InfoPopover>
          </div>
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {BANANA_MODES.map((m) => {
            const active = bananaMode === m.id
            return (
              <button
                key={m.id}
                type="button"
                disabled={controlsDisabled}
                onClick={() => onChangeBananaMode(m.id)}
                title={bananaModeHint(m.id)}
                className={pillClass(active)}
              >
                {m.label}
              </button>
            )
          })}
          <span className="hidden text-xs text-gray-400 dark:text-gray-500 sm:inline">
            {bananaModeHint(bananaMode)}
          </span>
          <div className="ml-auto">
            <InfoPopover label={`${infoTitle} — tap for details`} title={infoTitle} placement="above">
              {infoSections.map((section) => (
                <InfoSection key={section.title} title={section.title} lines={section.lines} />
              ))}
            </InfoPopover>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((url, i) => (
              <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg">
                <img src={url} alt={`attachment ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                  aria-label="Remove attachment"
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (actionHint && actionHint !== 'Preparing your chat history…') {
              setActionHint(null)
            }
          }}
          onCompositionEnd={(e) => {
            setText(e.currentTarget.value)
          }}
          rows={1}
          placeholder={
            workspace === 'gpt'
              ? 'Describe an image for GPT Image…'
              : 'Describe an image, or attach one to edit…'
          }
          className="max-h-40 w-full resize-none bg-transparent px-2 py-1 text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
          aria-label="Image prompt"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-2 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label="Attach reference image"
            title="Attach a reference image (optional)"
          >
            <ImageIcon className="h-5 w-5" />
            <span className="text-xs">Attach</span>
          </button>

          <SelectPill
            value={aspectRatio}
            options={ASPECT_RATIOS.map((o) => ({ value: o, label: o }))}
            onChange={(v) => onChangeAspectRatio(v as AspectRatio)}
            title="Aspect ratio"
            disabled={controlsDisabled}
          />
          <SelectPill
            value={imageSize}
            options={IMAGE_SIZES.map((o) => ({ value: o, label: o }))}
            onChange={(v) => onChangeImageSize(v as ImageSize)}
            title="Resolution — 1K ~1×, 2K ~2–4×, 4K ~4–10× cost vs 1K (rough); higher = more detail"
            disabled={controlsDisabled}
          />
          {showGptQuality && (
            <SelectPill
              value={imageQuality}
              options={IMAGE_QUALITIES.map((o) => ({ value: o, label: imageQualityCostHint(o) }))}
              onChange={(v) => onChangeImageQuality(v as ImageQuality)}
              title="Quality (GPT Direct only) — low ~1×, medium ~2×, high ~4× cost (rough); higher = better fidelity"
              disabled={controlsDisabled}
            />
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={submit}
            disabled={sendDisabled}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition ${
              sendInteractive
                ? 'bg-gray-900 hover:bg-gray-700 dark:bg-banana-400 dark:text-gray-900 dark:hover:bg-banana-300'
                : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-500'
            }`}
            aria-label={hasKey ? 'Generate image' : 'Generate — API key required'}
            title={
              !hasContent
                ? 'Type a prompt or attach an image'
                : busy
                  ? 'Generation in progress'
                  : !hasKey
                    ? 'Add your API key in Settings'
                    : !sessionsReady
                      ? 'Preparing chat history…'
                      : 'Generate'
            }
          >
            {!sessionsReady && hasContent && !busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <SendIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {!sessionsReady && hasContent && !actionHint && (
        <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
          Restoring chat history… you can keep typing.
        </p>
      )}
      {actionHint && (
        <p className="mt-2 text-center text-xs font-medium text-amber-700 dark:text-amber-300">
          {actionHint}
        </p>
      )}
      {storageWarning && (
        <p className="mt-1 text-center text-xs font-medium leading-snug text-amber-700 dark:text-amber-300">
          {storageWarning}
        </p>
      )}
    </div>
  )
}

function pillClass(active: boolean): string {
  return active
    ? 'rounded-full border border-gray-900 bg-gray-900 px-3 py-1.5 text-xs text-white dark:border-banana-400 dark:bg-banana-400 dark:text-gray-900'
    : 'rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 hover:border-gray-300 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600'
}

function SelectPill({
  value,
  options,
  onChange,
  title,
  disabled,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
  title: string
  disabled?: boolean
}) {
  return (
    <select
      title={title}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[11rem] rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
