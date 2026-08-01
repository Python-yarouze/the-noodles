import { useEffect, useState } from 'react'
import type { ClientAction, ClientView, SingleDeclare } from '../game/types'
import { cardImageUrl } from './cardAssets'

interface Props {
  view: ClientView
  onAction: (action: ClientAction) => void
}

const PHASE_LABEL: Record<string, string> = {
  turnDraw: 'カードを引く',
  turnDiscard: '捨てて引く（任意）',
  ajimiWindow: '味見タイム',
  turnCook: '調理（任意）',
  turnEnd: '手札を3枚に調整',
  finished: '終了',
}

export function GameTable({ view, onAction }: Props) {
  const [selected, setSelected] = useState<number[]>([])
  const [declare, setDeclare] = useState<SingleDeclare>('とり')

  const toggle = (index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b),
    )
  }

  const clearSel = () => setSelected([])

  const needEndDiscard = Math.max(0, view.hand.length - 3)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (view.phase !== 'ajimiWindow') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [view.phase])

  const ajimiLeft = view.pendingDiscard
    ? Math.max(0, Math.ceil((view.pendingDiscard.deadline - now) / 1000))
    : 0

  return (
    <div className="table">
      <header className="table-bar">
        <div>
          <span className="phase">{PHASE_LABEL[view.phase] ?? view.phase}</span>
          <span className="meta">
            山 {view.deckCount} · 捨て札 {view.discardCount}
          </span>
        </div>
        <span className="room-mini">部屋 {view.roomCode}</span>
      </header>

      {view.phase === 'finished' && (
        <div className="banner win">
          {view.winnerName} の勝利！（50点先取）
        </div>
      )}

      {view.phase === 'ajimiWindow' && view.pendingDiscard && (
        <div className="banner ajimi">
          <p>
            {view.pendingDiscard.playerName} が
            {view.pendingDiscard.kind === 'single'
              ? `「${view.pendingDiscard.declare}」と宣言して1枚`
              : 'ペアとして2枚'}
            捨てました（引く枚数 {view.pendingDiscard.drawAmount}）
          </p>
          {view.pendingDiscard.playerId !== view.youId &&
            view.pendingDiscard.yourResponse === 'pending' && (
              <div className="btn-row">
                <button type="button" className="btn danger" onClick={() => onAction({ type: 'ajimi' })}>
                  味見する（嘘だと思う）
                </button>
                <button type="button" className="btn" onClick={() => onAction({ type: 'skipAjimi' })}>
                  スキップ
                </button>
                <span className="hint">残りおおよそ {ajimiLeft}s</span>
              </div>
            )}
          {view.pendingDiscard.playerId === view.youId && (
            <p className="hint">他プレイヤーの味見を待っています…</p>
          )}
        </div>
      )}

      <section className="opponents">
        {view.players.map((p) => (
          <div
            key={p.id}
            className={`seat ${p.isTurn ? 'turn' : ''} ${p.id === view.youId ? 'you' : ''}`}
          >
            <strong>{p.name}{p.id === view.youId ? '（あなた）' : ''}</strong>
            <div className="seat-meta">
              <span>{p.score}点</span>
              <span>手札 {p.handCount}</span>
              {!p.connected && <span className="warn">切断</span>}
            </div>
            <div className="backs">
              {Array.from({ length: Math.min(p.handCount, 8) }).map((_, i) => (
                <span key={i} className="card-back" />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="hand-area">
        <h2>あなたの手札</h2>
        <div className="hand">
          {view.hand.map((card, index) => (
            <button
              key={`${card}-${index}`}
              type="button"
              className={`card ${selected.includes(index) ? 'selected' : ''}`}
              onClick={() => toggle(index)}
            >
              <img src={cardImageUrl(card)} alt={card} />
              <span>{card}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="actions panel">
        {view.phase === 'turnDraw' && view.canAct && (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              clearSel()
              onAction({ type: 'draw' })
            }}
          >
            カードを1枚引く
          </button>
        )}

        {view.phase === 'turnDiscard' && view.canAct && (
          <>
            <div className="declare-row">
              <label>
                宣言
                <select
                  value={declare}
                  onChange={(e) => setDeclare(e.target.value as SingleDeclare)}
                >
                  <option value="とり">とり（2枚引き）</option>
                  <option value="ぶた">ぶた（3枚引き）</option>
                  <option value="えび">えび（4枚引き）</option>
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={view.usedSingleDiscard || selected.length !== 1}
                onClick={() => {
                  onAction({
                    type: 'discardDeclare',
                    kind: 'single',
                    declare,
                    cardIndices: selected,
                  })
                  clearSel()
                }}
              >
                1枚捨てて宣言
              </button>
              <button
                type="button"
                className="btn"
                disabled={view.usedPairDiscard || selected.length !== 2}
                onClick={() => {
                  onAction({
                    type: 'discardDeclare',
                    kind: 'pair',
                    cardIndices: selected,
                  })
                  clearSel()
                }}
              >
                ペアとして2枚捨てる
              </button>
            </div>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                clearSel()
                onAction({ type: 'skipDiscard' })
              }}
            >
              捨てフェーズを終える → 調理へ
            </button>
            <p className="hint">
              1枚捨て / ペア捨ては各ターン1回まで。カードを選んでから実行。
            </p>
          </>
        )}

        {view.phase === 'turnCook' && view.canAct && (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={selected.length < 3 || selected.length > 5}
              onClick={() => {
                onAction({ type: 'cook', cardIndices: selected })
                clearSel()
              }}
            >
              選んだカードで調理（3〜5枚・異種・必須食材）
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                clearSel()
                onAction({ type: 'passCook' })
              }}
            >
              調理しない
            </button>
          </>
        )}

        {view.phase === 'turnEnd' && view.canAct && (
          <>
            {needEndDiscard === 0 ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => onAction({ type: 'endTurnDiscard', cardIndices: [] })}
              >
                手番を終了する
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={selected.length !== needEndDiscard}
                onClick={() => {
                  onAction({ type: 'endTurnDiscard', cardIndices: selected })
                  clearSel()
                }}
              >
                {needEndDiscard}枚捨てて手番終了（選択 {selected.length}）
              </button>
            )}
          </>
        )}

        {!view.canAct && view.phase !== 'finished' && view.phase !== 'ajimiWindow' && (
          <p className="hint">他のプレイヤーの手番です…</p>
        )}
      </section>

      <section className="log panel">
        <h2>ログ</h2>
        <ul>
          {[...view.log].reverse().map((e) => (
            <li key={e.id}>{e.text}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
