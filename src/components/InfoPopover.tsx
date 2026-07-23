import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CloseIcon, InfoIcon } from './icons'

interface Props {
  label: string
  title?: string
  placement?: 'above' | 'below'
  children: ReactNode
}

export default function InfoPopover({ label, title, placement = 'above', children }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const panelClass =
    placement === 'below'
      ? 'top-full left-0 mt-2'
      : 'bottom-full right-0 mb-2 sm:right-0 sm:left-auto'

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <InfoIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={title ?? label}
          className={`absolute z-50 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900 ${panelClass}`}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {title ?? label}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-64 space-y-3 overflow-y-auto text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

export function InfoSection({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section>
      <h4 className="mb-1 font-medium text-gray-800 dark:text-gray-200">{title}</h4>
      <ul className="space-y-1">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}
