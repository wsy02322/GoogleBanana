const DB_NAME = 'googlebanana'
const DB_VERSION = 1
const SESSIONS_STORE = 'sessions'
const IMAGES_STORE = 'images'
const SESSIONS_RECORD_KEY = 'workspace'

export const IMAGE_REF_PREFIX = 'idbimg:'

export function isImageRef(url: string): boolean {
  return url.startsWith(IMAGE_REF_PREFIX)
}

export function toImageRef(id: string): string {
  return `${IMAGE_REF_PREFIX}${id}`
}

export function imageRefId(url: string): string {
  return url.slice(IMAGE_REF_PREFIX.length)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE)
      }
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'))
  })
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'))
  })
}

export async function idbGetSessionsRecord<T>(): Promise<T | undefined> {
  const db = await openDb()
  try {
    const tx = db.transaction(SESSIONS_STORE, 'readonly')
    const store = tx.objectStore(SESSIONS_STORE)
    const value = await reqToPromise(store.get(SESSIONS_RECORD_KEY) as IDBRequest<T | undefined>)
    await txDone(tx)
    return value
  } finally {
    db.close()
  }
}

export async function idbPutSessionsRecord<T>(value: T): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite')
    tx.objectStore(SESSIONS_STORE).put(value, SESSIONS_RECORD_KEY)
    await txDone(tx)
  } finally {
    db.close()
  }
}

export async function idbGetImage(id: string): Promise<Blob | undefined> {
  const db = await openDb()
  try {
    const tx = db.transaction(IMAGES_STORE, 'readonly')
    const value = await reqToPromise(tx.objectStore(IMAGES_STORE).get(id) as IDBRequest<Blob | undefined>)
    await txDone(tx)
    return value instanceof Blob ? value : undefined
  } finally {
    db.close()
  }
}

export async function idbPutImages(entries: Array<{ id: string; blob: Blob }>): Promise<void> {
  if (entries.length === 0) return
  const db = await openDb()
  try {
    const tx = db.transaction(IMAGES_STORE, 'readwrite')
    const store = tx.objectStore(IMAGES_STORE)
    for (const entry of entries) {
      store.put(entry.blob, entry.id)
    }
    await txDone(tx)
  } finally {
    db.close()
  }
}

export async function idbDeleteImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await openDb()
  try {
    const tx = db.transaction(IMAGES_STORE, 'readwrite')
    const store = tx.objectStore(IMAGES_STORE)
    for (const id of ids) {
      store.delete(id)
    }
    await txDone(tx)
  } finally {
    db.close()
  }
}

export async function idbListImageIds(): Promise<string[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(IMAGES_STORE, 'readonly')
    const keys = await reqToPromise(tx.objectStore(IMAGES_STORE).getAllKeys())
    await txDone(tx)
    return keys.map(String)
  } finally {
    db.close()
  }
}

export function newImageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
