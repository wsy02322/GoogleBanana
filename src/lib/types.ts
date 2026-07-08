export interface Settings {
  baseUrl: string
  apiKey: string
  model: string
  siteTitle: string
  theme: 'light' | 'dark' | 'system'
}

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
export type ImageSize = '1K' | '2K' | '4K'

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  images: string[] // data URLs
  createdAt: number
  pending?: boolean
  error?: string
}

export interface Conversation {
  id: string
  title: string
  turns: Turn[]
  createdAt: number
  updatedAt: number
}

export interface SessionsData {
  activeId: string
  conversations: Conversation[]
}

export interface ModelOption {
  id: string
  label: string
}
