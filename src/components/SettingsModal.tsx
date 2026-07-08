import { useState } from 'react'
import type { Settings } from '../lib/types'
import { MODEL_OPTIONS, DEFAULT_SETTINGS } from '../lib/storage'
import { CloseIcon } from './icons'

interface Props {
  settings: Settings
  onSave: (settings: Settings) => void
  onClose: () => void
}

export default function SettingsModal({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [showKey, setShowKey] = useState(false)

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const modelIsCustom = !MODEL_OPTIONS.some((m) => m.id === draft.model)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close settings"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="API Key" hint="Stored only in your browser. Never sent to any server except your API base URL.">
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => update('apiKey', e.target.value)}
                placeholder="sk-or-v1-..."
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-banana-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <Field label="API Base URL" hint="Any OpenRouter-compatible (OpenAI-style) endpoint.">
            <input
              type="text"
              value={draft.baseUrl}
              onChange={(e) => update('baseUrl', e.target.value)}
              placeholder={DEFAULT_SETTINGS.baseUrl}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-banana-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </Field>

          <Field label="Model">
            <select
              value={modelIsCustom ? '__custom__' : draft.model}
              onChange={(e) => {
                if (e.target.value !== '__custom__') update('model', e.target.value)
                else update('model', '')
              }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-banana-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
            {modelIsCustom && (
              <input
                type="text"
                value={draft.model}
                onChange={(e) => update('model', e.target.value)}
                placeholder="provider/model-id"
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-banana-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            )}
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-banana-400 dark:text-gray-900 dark:hover:bg-banana-300"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
    </label>
  )
}
