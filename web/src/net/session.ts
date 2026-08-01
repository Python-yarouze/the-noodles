import Peer, { type DataConnection } from 'peerjs'
import {
  addPlayer,
  applyAction,
  createLobby,
  setPlayerConnected,
  tickAjimiTimeout,
} from '../game/engine'
import { toClientView } from '../game/visibility'
import type { ClientAction, ClientView, GameState } from '../game/types'
import {
  generateRoomCode,
  parseMessage,
  roomPeerId,
  type GuestToHost,
  type HostToGuest,
} from './protocol'

export type SessionMode = 'idle' | 'host' | 'guest'

export interface SessionHandle {
  mode: SessionMode
  peerId: string | null
  roomCode: string | null
  youId: string
  view: ClientView | null
  status: string
  error: string | null
  createRoom: (name: string) => Promise<void>
  joinRoom: (code: string, name: string) => Promise<void>
  sendAction: (action: ClientAction) => void
  destroy: () => void
}

type Listener = () => void

export function createSession(): {
  subscribe: (fn: Listener) => () => void
  getSnapshot: () => Omit<
    SessionHandle,
    'createRoom' | 'joinRoom' | 'sendAction' | 'destroy'
  >
  createRoom: (name: string) => Promise<void>
  joinRoom: (code: string, name: string) => Promise<void>
  sendAction: (action: ClientAction) => void
  destroy: () => void
} {
  let mode: SessionMode = 'idle'
  let peer: Peer | null = null
  let roomCode: string | null = null
  let youId = ''
  let hostName = ''
  let state: GameState | null = null
  let view: ClientView | null = null
  let status = '待機中'
  let error: string | null = null
  const guests = new Map<string, DataConnection>()
  let hostConn: DataConnection | null = null
  let ajimiTimer: ReturnType<typeof setInterval> | null = null
  const listeners = new Set<Listener>()

  const notify = () => {
    for (const fn of listeners) fn()
  }

  const setError = (msg: string | null) => {
    error = msg
    notify()
  }

  const setStatus = (s: string) => {
    status = s
    notify()
  }

  const broadcastViews = () => {
    if (!state) return
    view = toClientView(state, youId)
    for (const [guestId, conn] of guests) {
      if (conn.open) {
        const msg: HostToGuest = { type: 'state', view: toClientView(state, guestId) }
        conn.send(msg)
      }
    }
    notify()
  }

  const hostApply = (actorId: string, action: ClientAction) => {
    if (!state) return
    state = applyAction(state, actorId, action)
    broadcastViews()
    ensureAjimiTimer()
  }

  const ensureAjimiTimer = () => {
    if (ajimiTimer) {
      clearInterval(ajimiTimer)
      ajimiTimer = null
    }
    if (!state || state.phase !== 'ajimiWindow') return
    ajimiTimer = setInterval(() => {
      if (!state || state.phase !== 'ajimiWindow') {
        if (ajimiTimer) clearInterval(ajimiTimer)
        ajimiTimer = null
        return
      }
      const before = state
      state = tickAjimiTimeout(state)
      if (state !== before) broadcastViews()
      if (state.phase !== 'ajimiWindow' && ajimiTimer) {
        clearInterval(ajimiTimer)
        ajimiTimer = null
      }
    }, 250)
  }

  const wireGuestConnection = (conn: DataConnection) => {
    conn.on('open', () => {
      const hello: HostToGuest = {
        type: 'hello',
        hostName,
        roomCode: roomCode ?? '',
      }
      conn.send(hello)
    })

    conn.on('data', (raw) => {
      const msg = parseMessage<GuestToHost>(raw)
      if (!msg || !state) return
      if (msg.type === 'join') {
        const guestId = conn.peer
        guests.set(guestId, conn)
        state = addPlayer(state, guestId, msg.name)
        broadcastViews()
        return
      }
      if (msg.type === 'action') {
        hostApply(conn.peer, msg.action)
      }
    })

    conn.on('close', () => {
      const guestId = conn.peer
      guests.delete(guestId)
      if (state) {
        state = setPlayerConnected(state, guestId, false)
        broadcastViews()
      }
    })
  }

  const createRoom = async (name: string) => {
    destroyPeerOnly()
    error = null
    hostName = name.trim() || 'ホスト'
    roomCode = generateRoomCode()
    youId = roomPeerId(roomCode)
    mode = 'host'
    setStatus('部屋を作成中…')

    peer = new Peer(youId, { debug: 1 })
    await waitPeerOpen(peer)
    state = createLobby(youId, hostName, roomCode)
    view = toClientView(state, youId)
    setStatus('参加者を待っています')

    peer.on('connection', (conn) => {
      wireGuestConnection(conn)
    })
    notify()
  }

  const joinRoom = async (code: string, name: string) => {
    destroyPeerOnly()
    error = null
    roomCode = code.trim().toLowerCase()
    const target = roomPeerId(roomCode)
    mode = 'guest'
    setStatus('接続中…')

    peer = new Peer({ debug: 1 })
    await waitPeerOpen(peer)
    youId = peer.id
    const displayName = name.trim() || 'ゲスト'

    hostConn = peer.connect(target, { reliable: true })
    await waitConnOpen(hostConn)
    setStatus('参加しました')

    hostConn.on('data', (raw) => {
      const msg = parseMessage<HostToGuest>(raw)
      if (!msg) return
      if (msg.type === 'state') {
        view = msg.view
        notify()
      } else if (msg.type === 'error') {
        setError(msg.message)
      } else if (msg.type === 'kicked') {
        setError(msg.reason)
      }
    })

    hostConn.on('close', () => {
      setStatus('ホストとの接続が切れました')
      setError('ホストが切断しました。部屋は終了です。')
    })

    const join: GuestToHost = { type: 'join', name: displayName }
    hostConn.send(join)
    notify()
  }

  const sendAction = (action: ClientAction) => {
    if (mode === 'host') {
      hostApply(youId, action)
      return
    }
    if (mode === 'guest' && hostConn?.open) {
      const msg: GuestToHost = { type: 'action', action }
      hostConn.send(msg)
    }
  }

  const destroyPeerOnly = () => {
    if (ajimiTimer) {
      clearInterval(ajimiTimer)
      ajimiTimer = null
    }
    for (const c of guests.values()) c.close()
    guests.clear()
    hostConn?.close()
    hostConn = null
    peer?.destroy()
    peer = null
    state = null
    view = null
  }

  const destroy = () => {
    destroyPeerOnly()
    mode = 'idle'
    roomCode = null
    youId = ''
    status = '待機中'
    error = null
    notify()
  }

  return {
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getSnapshot: () => ({
      mode,
      peerId: peer?.id ?? null,
      roomCode,
      youId,
      view,
      status,
      error,
    }),
    createRoom,
    joinRoom,
    sendAction,
    destroy,
  }
}

function waitPeerOpen(peer: Peer): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('PeerJS 接続タイムアウト')), 15000)
    peer.on('open', () => {
      clearTimeout(t)
      resolve()
    })
    peer.on('error', (err) => {
      clearTimeout(t)
      reject(err)
    })
  })
}

function waitConnOpen(conn: DataConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ホストへの接続タイムアウト')), 15000)
    conn.on('open', () => {
      clearTimeout(t)
      resolve()
    })
    conn.on('error', (err) => {
      clearTimeout(t)
      reject(err)
    })
  })
}
