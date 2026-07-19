import { useRef, useState } from 'react'
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
  composerCostFootnote,
  imageQualityCostHint,
  imageSizeCostHint,
} from '../lib/openrouter'
import { fileToDataUrl } from '../lib/image'
import { ImageIcon, SendIcon, CloseIcon } from './icons'

interface Props {
  disabled: boolean
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
  disabled,
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
  onSend,
}: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const canSend = !disabled && (text.trim().length > 0 || images.length > 0)
  const showGptQuality = workspace === 'gpt' && gptMode === 'direct'

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    const urls = await Promise.all(
      Array.from(files)
        .filter((f) => f.type.startsWith('image/'))
        .map(fileToDataUrl),
    )
    setImages((prev) => [...prev, ...urls])
    if (fileRef.current) fileRef.current.value = ''
  }

  const submit = () => {
    if (!canSend) return
    onSend(text.trim(), images)
    setText('')
    setImages([])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
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
                disabled={disabled}
                onClick={() => onChangeGptMode(m.id)}
                title={m.hint}
                className={pillClass(active)}
              >
                {m.label}
              </button>
            )
          })}
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {GPT_MODES.find((m) => m.id === gptMode)?.hint}
          </span>
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {BANANA_MODES.map((m) => {
            const active = bananaMode === m.id
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => onChangeBananaMode(m.id)}
                title={bananaModeHint(m.id)}
                className={pillClass(active)}
              >
                {m.label}
              </button>
            )
          })}
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {bananaModeHint(bananaMode)}
          </span>
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            workspace === 'gpt'
              ? 'Describe an image for GPT Image…'
              : 'Describe an image, or attach one to edit…'
          }
          className="max-h-40 w-full resize-none bg-transparent px-2 py-1 text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
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
            onClick={() => fileRef.current?.click()}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label="Attach image"
            title="Attach reference image"
          >
            <ImageIcon className="h-5 w-5" />
          </button>

          <SelectPill
            value={aspectRatio}
            options={ASPECT_RATIOS.map((o) => ({ value: o, label: o }))}
            onChange={(v) => onChangeAspectRatio(v as AspectRatio)}
            title="Aspect ratio"
          />
          <SelectPill
            value={imageSize}
            options={IMAGE_SIZES.map((o) => ({ value: o, label: imageSizeCostHint(o) }))}
            onChange={(v) => onChangeImageSize(v as ImageSize)}
            title="Resolution — 1K ~1×, 2K ~2–4×, 4K ~4–10× cost vs 1K (rough); higher = more detail"
          />
          {showGptQuality && (
            <SelectPill
              value={imageQuality}
              options={IMAGE_QUALITIES.map((o) => ({ value: o, label: imageQualityCostHint(o) }))}
              onChange={(v) => onChangeImageQuality(v as ImageQuality)}
              title="Quality (GPT Direct only) — low ~1×, medium ~2×, high ~4× cost (rough); higher = better fidelity"
            />
          )}

          <div className="flex-1" />

          <button
            onClick={submit}
            disabled={!canSend}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white transition enabled:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-banana-400 dark:text-gray-900 dark:enabled:hover:bg-banana-300"
            aria-label="Generate"
          >
            <SendIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      <p className="mt-2 text-center text-xs leading-snug text-gray-400 dark:text-gray-500">
        {composerCostFootnote(workspace, gptMode)}
      </p>
      <p className="mt-1 text-center text-xs leading-snug text-gray-400 dark:text-gray-500">
        Download images you want to keep. Chat history uses IndexedDB when available.
      </p>
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
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
  title: string
}) {
  return (
    <select
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[11rem] rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
