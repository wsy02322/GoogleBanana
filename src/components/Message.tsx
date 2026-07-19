import type { Turn } from '../lib/types'
import { downloadDataUrl } from '../lib/image'
import { DownloadIcon } from './icons'

interface Props {
  turn: Turn
  chatgpt?: boolean
}

export default function Message({ turn, chatgpt = false }: Props) {
  const isUser = turn.role === 'user'

  if (chatgpt) {
    return (
      <div className={`flex w-full animate-fade-in ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[min(100%,42rem)] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
          {turn.text && (
            <div
              className={`whitespace-pre-wrap px-4 py-2.5 text-[15px] leading-relaxed ${
                isUser
                  ? 'rounded-[20px] bg-chatgpt-user text-gray-900 dark:bg-chatgpt-user-dark dark:text-gray-100'
                  : 'text-gray-800 dark:text-gray-200'
              }`}
            >
              {turn.text}
            </div>
          )}

          {turn.pending && (
            <div className="flex items-center gap-3 rounded-2xl bg-chatgpt-surface px-4 py-3 dark:bg-chatgpt-surface-dark">
              <span className="relative flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chatgpt-accent opacity-60" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-chatgpt-accent" />
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">Creating image…</span>
            </div>
          )}

          {turn.error && (
            <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {turn.error}
            </div>
          )}

          {turn.images.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {turn.images.map((url, i) => (
                <figure
                  key={i}
                  className="group relative overflow-hidden rounded-2xl bg-chatgpt-surface dark:bg-chatgpt-surface-dark"
                >
                  <img src={url} alt={`generated ${i + 1}`} className="w-full" />
                  {!isUser && (
                    <button
                      onClick={() => downloadDataUrl(url, `chatgpt-image-${turn.id}-${i + 1}.png`)}
                      className="absolute right-2 top-2 rounded-full bg-black/55 p-2 text-white opacity-0 transition group-hover:opacity-100"
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
        </div>
      </div>
    )
  }

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
            <span className="text-sm text-gray-500 dark:text-gray-400">Generating image…</span>
          </div>
        )}

        {turn.error && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {turn.error}
          </div>
        )}

        {turn.images.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {turn.images.map((url, i) => (
              <figure key={i} className="group relative overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
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
      </div>
    </div>
  )
}
