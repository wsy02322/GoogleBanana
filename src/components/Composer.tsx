import { useRef, useState } from 'react'
import type { AspectRatio, ImageSize, IntelligenceLevel, ModelOption, UiMode } from '../lib/types'
import { INTELLIGENCE_OPTIONS } from '../lib/storage'
import { fileToDataUrl } from '../lib/image'
import { ImageIcon, SendIcon, CloseIcon } from './icons'

interface Props {
  disabled: boolean
  uiMode: UiMode
  aspectRatio: AspectRatio
  imageSize: ImageSize
  intelligence: IntelligenceLevel
  model: string
  modelOptions: ModelOption[]
  onChangeAspectRatio: (v: AspectRatio) => void
  onChangeImageSize: (v: ImageSize) => void
  onChangeIntelligence: (v: IntelligenceLevel) => void
  onChangeModel: (v: string) => void
  onSend: (text: string, images: string[]) => void
}

const ASPECT_RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4']
const IMAGE_SIZES: ImageSize[] = ['1K', '2K', '4K']

export default function Composer({
  disabled,
  uiMode,
  aspectRatio,
  imageSize,
  intelligence,
  model,
  modelOptions,
  onChangeAspectRatio,
  onChangeImageSize,
  onChangeIntelligence,
  onChangeModel,
  onSend,
}: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const canSend = !disabled && (text.trim().length > 0 || images.length > 0)
  const isChatGpt = uiMode === 'chatgpt'

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

  if (isChatGpt) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-[28px] border border-chatgpt-border bg-chatgpt-composer p-3 shadow-sm dark:border-chatgpt-border-dark dark:bg-chatgpt-composer-dark">
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {images.map((url, i) => (
                <div key={i} className="relative h-16 w-16 overflow-hidden rounded-xl">
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
            placeholder="Describe an image to create…"
            className="max-h-40 w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-relaxed text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />

          <div className="mt-1 flex flex-wrap items-center gap-2 px-1">
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
              className="rounded-full p-2 text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/10"
              aria-label="Attach image"
              title="Attach reference image"
            >
              <ImageIcon className="h-5 w-5" />
            </button>

            <select
              title="Model"
              value={model}
              onChange={(e) => onChangeModel(e.target.value)}
              className="rounded-full border border-chatgpt-border bg-white px-3 py-1.5 text-xs font-medium text-gray-700 outline-none dark:border-chatgpt-border-dark dark:bg-chatgpt-surface-dark dark:text-gray-200"
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>

            <SelectPill
              value={aspectRatio}
              options={ASPECT_RATIOS}
              onChange={(v) => onChangeAspectRatio(v as AspectRatio)}
              title="Aspect ratio"
              chatgpt
            />

            <div
              className="inline-flex items-center rounded-full border border-chatgpt-border bg-white p-0.5 dark:border-chatgpt-border-dark dark:bg-chatgpt-surface-dark"
              role="group"
              aria-label="Intelligence level"
              title="Intelligence level"
            >
              {INTELLIGENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.hint}
                  onClick={() => onChangeIntelligence(opt.id)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    intelligence === opt.id
                      ? 'bg-chatgpt-accent text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <button
              onClick={submit}
              disabled={!canSend}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-chatgpt-accent text-white transition enabled:hover:bg-chatgpt-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Generate"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
          Intelligence controls image quality · Enter to send
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
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
          placeholder="Describe an image, or attach one to edit…"
          className="max-h-40 w-full resize-none bg-transparent px-2 py-1 text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
        />

        <div className="mt-2 flex items-center gap-2">
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

          <SelectPill value={aspectRatio} options={ASPECT_RATIOS} onChange={(v) => onChangeAspectRatio(v as AspectRatio)} title="Aspect ratio" />
          <SelectPill value={imageSize} options={IMAGE_SIZES} onChange={(v) => onChangeImageSize(v as ImageSize)} title="Resolution" />

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
      <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  )
}

function SelectPill({
  value,
  options,
  onChange,
  title,
  chatgpt = false,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  title: string
  chatgpt?: boolean
}) {
  return (
    <select
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        chatgpt
          ? 'rounded-full border border-chatgpt-border bg-white px-3 py-1.5 text-xs font-medium text-gray-700 outline-none dark:border-chatgpt-border-dark dark:bg-chatgpt-surface-dark dark:text-gray-200'
          : 'rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
      }
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}
