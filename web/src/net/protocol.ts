import type { ClientAction, ClientView } from '../game/types'

export type HostToGuest =
  | { type: 'hello'; hostName: string; roomCode: string }
  | { type: 'state'; view: ClientView }
  | { type: 'error'; message: string }
  | { type: 'kicked'; reason: string }

export type GuestToHost =
  | { type: 'join'; name: string }
  | { type: 'action'; action: ClientAction }

export function roomPeerId(code: string): string {
  return `thenoodles-${code.toLowerCase()}`
}

export function generateRoomCode(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

export function parseMessage<T>(data: unknown): T | null {
  try {
    if (typeof data === 'string') return JSON.parse(data) as T
    if (typeof data === 'object' && data !== null) return data as T
    return null
  } catch {
    return null
  }
}
