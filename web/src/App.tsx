import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ClientAction } from './game/types'
import { createSession } from './net/session'
import { GameTable } from './ui/GameTable'
import { Lobby } from './ui/Lobby'
import './App.css'

function useQueryRoom(): string | null {
  return useMemo(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('room')
  }, [])
}

export default function App() {
  const session = useMemo(() => createSession(), [])
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const queryRoom = useQueryRoom()
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => () => session.destroy(), [session])

  useEffect(() => {
    if (bootstrapped || !queryRoom || snap.mode !== 'idle') return
    setBootstrapped(true)
  }, [bootstrapped, queryRoom, snap.mode])

  const send = (action: ClientAction) => session.sendAction(action)

  const inGame =
    snap.view &&
    snap.view.phase !== 'lobby' &&
    (snap.mode === 'host' || snap.mode === 'guest')

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden />
      <header className="hero">
        <p className="brand">THE NOODLES</p>
        <h1>ネット対戦</h1>
        <p className="lede">
          ホスト制の peer-to-peer。データベースなしで、部屋コードを共有してラーメンを競う。
        </p>
      </header>

      <main>
        {!inGame ? (
          <Lobby
            mode={snap.mode}
            status={snap.status}
            error={snap.error}
            view={snap.view}
            roomCode={snap.roomCode}
            onCreate={async (name) => {
              await session.createRoom(name)
              const code = session.getSnapshot().roomCode
              if (code) {
                const url = new URL(window.location.href)
                url.searchParams.set('room', code)
                window.history.replaceState({}, '', url)
              }
            }}
            onJoin={async (code, name) => {
              await session.joinRoom(code, name)
              const url = new URL(window.location.href)
              url.searchParams.set('room', code.trim().toLowerCase())
              window.history.replaceState({}, '', url)
            }}
            onReady={() => send({ type: 'ready' })}
            onStart={() => send({ type: 'startGame' })}
            onLeave={() => {
              session.destroy()
              const url = new URL(window.location.href)
              url.searchParams.delete('room')
              window.history.replaceState({}, '', url)
            }}
          />
        ) : (
          snap.view && <GameTable view={snap.view} onAction={send} />
        )}

        {snap.error && inGame && <p className="error footer-error">{snap.error}</p>}
      </main>

      <footer className="site-footer">
        <a href="/ルール.png" target="_blank" rel="noreferrer">
          ルール
        </a>
        <a href="/ラーメン効果表.png" target="_blank" rel="noreferrer">
          効果表
        </a>
        <span>DBなし · PeerJS / WebRTC</span>
      </footer>
    </div>
  )
}
