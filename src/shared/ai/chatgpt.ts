export interface ChatgptAccountView {
  id: string
  label: string
}

export interface ChatgptModelView {
  id: string
  label: string
}

export interface ChatgptAuthView {
  connected: boolean
  pending: boolean
  activeId: string | null
  accounts: ChatgptAccountView[]
  error: string | null
  sessionOnly: boolean
  needsWelcome: boolean
}

export const EMPTY_CHATGPT_AUTH: ChatgptAuthView = {
  connected: false,
  pending: false,
  activeId: null,
  accounts: [],
  error: null,
  sessionOnly: false,
  needsWelcome: false
}
