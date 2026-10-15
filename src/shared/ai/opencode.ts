export interface OpenCodeAuthView {
  connected: boolean
  pending: boolean
  connectionId: string | null
  workspaceId: string | null
  userCode: string | null
  verificationUri: string | null
  error: string | null
  sessionOnly: boolean
}

export interface OpenCodeModelView {
  id: string
  label: string
  options?: ModelCapabilities
}

export const EMPTY_OPENCODE_AUTH: OpenCodeAuthView = {
  connected: false,
  pending: false,
  connectionId: null,
  workspaceId: null,
  userCode: null,
  verificationUri: null,
  error: null,
  sessionOnly: false
}
import type { ModelCapabilities } from './model-options'
