import { useState } from 'react'
import type { ClientView } from '../game/types'
import { MAX_PLAYERS, MIN_PLAYERS } from '../game/types'

interface Props {
  mode: 'idle' | 'host' | 'guest'
  status: string
  error: string | null
  view: ClientView | null
  roomCode: string | null
  onCreate: (name: string) => Promise<void>
  onJoin: (code: string, name: string) => Promise<void>
  onReady: () => void
  onStart: () => void
  onLeave: () => void
}

export function Lobby({
  mode,
  status,
  error,
  view,
  roomCode,
  onCreate,
  onJoin,
  onReady,
  onStart,
  onLeave,
}: Props) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const handleCreate = async () => {
    setBusy(true)
    try {
      await onCreate(name)
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  const handleJoin = async () => {
    setBusy(true)
    try {
      await onJoin(code, name)
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'idle') {
    return (
      <section className="panel lobby-entry">
        <label className="field">
          <span>ニックネーム</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: ラーメン太郎"
            maxLength={16}
          />
        </label>
        <div className="lobby-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={handleCreate}>
            部屋を作る
          </button>
        </div>
        <div className="join-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="部屋コード"
            maxLength={8}
          />
          <button type="button" className="btn" disabled={busy || !code.trim()} onClick={handleJoin}>
            参加する
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="hint">{status}</p>
      </section>
    )
  }

  const players = view?.players ?? []
  const canStart =
    view?.isHost &&
    players.length >= MIN_PLAYERS &&
    players.length <= MAX_PLAYERS &&
    players.every((p) => p.ready || p.id === view.youId)

  return (
    <section className="panel lobby-room">
      <div className="room-code-block">
        <span className="label">部屋コード</span>
        <strong className="room-code">{roomCode ?? view?.roomCode}</strong>
        <p className="hint">このコードを友達に共有してください</p>
      </div>
      <ul className="player-list">
        {players.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <span className={p.ready ? 'tag ready' : 'tag'}>
              {p.ready ? '準備OK' : '待機中'}
              {!p.connected ? ' / 切断' : ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        {MIN_PLAYERS}〜{MAX_PLAYERS}人 · {status}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="lobby-actions">
        {!view?.isHost && (
          <button type="button" className="btn primary" onClick={onReady}>
            準備完了
          </button>
        )}
        {view?.isHost && (
          <button type="button" className="btn primary" disabled={!canStart} onClick={onStart}>
            ゲーム開始
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onLeave}>
          退出
        </button>
      </div>
    </section>
  )
}
