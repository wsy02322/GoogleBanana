import type { Conversation, Workspace } from '../lib/types'
import { ChatIcon, CloseIcon, PlusIcon, TrashIcon } from './icons'

interface Props {
  conversations: Conversation[]
  activeId: string
  workspace: Workspace
  open: boolean
  onClose: () => void
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete: (id: string) => void
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export default function Sidebar({
  conversations,
  activeId,
  workspace,
  open,
  onClose,
  onSelect,
  onNewChat,
  onDelete,
}: Props) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
  const historyLabel = workspace === 'gpt' ? 'GPT Image chats' : 'Banana chats'

  const handleSelect = (id: string) => {
    onSelect(id)
    onClose()
  }

  const handleNewChat = () => {
    onNewChat()
    onClose()
  }

  return (
    <>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="Close sidebar"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-gray-200 bg-gray-50 transition-transform duration-200 dark:border-gray-800 dark:bg-gray-900 lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-gray-200 p-3 dark:border-gray-800">
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {historyLabel}
          </p>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleNewChat}
              className="flex flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <PlusIcon className="h-4 w-4 shrink-0" />
              New chat
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
              aria-label="Close sidebar"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sorted.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-gray-500 dark:text-gray-400">No chats yet</p>
          ) : (
            <ul className="space-y-0.5">
              {sorted.map((conv) => {
                const active = conv.id === activeId
                return (
                  <li key={conv.id}>
                    <div
                      className={`group flex items-center gap-1 rounded-lg ${
                        active
                          ? 'bg-white shadow-sm dark:bg-gray-800'
                          : 'hover:bg-white/80 dark:hover:bg-gray-800/80'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect(conv.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left"
                      >
                        <ChatIcon
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            active ? 'text-banana-500' : 'text-gray-400'
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm ${
                              active
                                ? 'font-medium text-gray-900 dark:text-gray-100'
                                : 'text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {conv.title}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-500">
                            {formatRelativeTime(conv.updatedAt)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(conv.id)
                        }}
                        className="mr-1 shrink-0 rounded-md p-1.5 text-gray-400 opacity-0 transition hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950 dark:hover:text-red-400"
                        aria-label={`Delete ${conv.title}`}
                        title="Delete chat"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}
