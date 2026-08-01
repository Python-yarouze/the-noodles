import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  applyAction,
  createLobby,
  tickAjimiTimeout,
} from './engine'
import { toClientView } from './visibility'

function bootTwoPlayer() {
  let s = createLobby('host', 'ホスト', 'abc123')
  s = addPlayer(s, 'guest', 'ゲスト')
  s = applyAction(s, 'guest', { type: 'ready' })
  s = applyAction(s, 'host', { type: 'startGame' })
  return s
}

describe('game engine', () => {
  it('starts with 3 cards each and enters turnDraw', () => {
    const s = bootTwoPlayer()
    expect(s.phase).toBe('turnDraw')
    expect(s.players.every((p) => p.hand.length === 3)).toBe(true)
    expect(s.deck.length).toBe(28 - 6)
  })

  it('masks opponent hands in client view', () => {
    const s = bootTwoPlayer()
    const view = toClientView(s, 'guest')
    expect(view.hand.length).toBe(3)
    const hostSeat = view.players.find((p) => p.id === 'host')
    expect(hostSeat?.handCount).toBe(3)
  })

  it('draw then skip discard to cook', () => {
    let s = bootTwoPlayer()
    const cur = s.turnOrder[s.currentTurnIndex]
    s = applyAction(s, cur, { type: 'draw' })
    expect(s.phase).toBe('turnDiscard')
    s = applyAction(s, cur, { type: 'skipDiscard' })
    expect(s.phase).toBe('turnCook')
  })

  it('catches a lying single discard via ajimi', () => {
    let s = bootTwoPlayer()
    const cur = s.turnOrder[s.currentTurnIndex]
    const other = s.turnOrder.find((id) => id !== cur)!
    s = applyAction(s, cur, { type: 'draw' })

    // Force a non-とり card into index 0 for a lie
    s = {
      ...s,
      players: s.players.map((p) =>
        p.id === cur ? { ...p, hand: ['めん', 'ねぎ', 'しょうゆ', 'きのこ'] } : p,
      ),
    }
    s = applyAction(s, cur, {
      type: 'discardDeclare',
      kind: 'single',
      declare: 'とり',
      cardIndices: [0],
    })
    expect(s.phase).toBe('ajimiWindow')
    const beforeScore = s.players.find((p) => p.id === other)!.score
    s = applyAction(s, other, { type: 'ajimi' })
    expect(s.phase).toBe('turnDiscard')
    expect(s.players.find((p) => p.id === other)!.nextTurnBonusDraw).toBe(1)
    expect(s.players.find((p) => p.id === other)!.score).toBe(beforeScore)
    // discarder did not gain cards from the failed declare draw
  })

  it('resolves ajimi timeout by granting draw', () => {
    let s = bootTwoPlayer()
    const cur = s.turnOrder[s.currentTurnIndex]
    s = applyAction(s, cur, { type: 'draw' })
    s = {
      ...s,
      players: s.players.map((p) =>
        p.id === cur ? { ...p, hand: ['とり', 'ねぎ', 'しょうゆ', 'きのこ'] } : p,
      ),
    }
    const handBefore = s.players.find((p) => p.id === cur)!.hand.length
    s = applyAction(s, cur, {
      type: 'discardDeclare',
      kind: 'single',
      declare: 'とり',
      cardIndices: [0],
    })
    s = tickAjimiTimeout(s, Date.now() + 999999)
    expect(s.phase).toBe('turnDiscard')
    expect(s.players.find((p) => p.id === cur)!.hand.length).toBe(handBefore - 1 + 2)
  })

  it('cooks and awards points', () => {
    let s = bootTwoPlayer()
    const cur = s.turnOrder[s.currentTurnIndex]
    s = applyAction(s, cur, { type: 'draw' })
    s = applyAction(s, cur, { type: 'skipDiscard' })
    s = {
      ...s,
      players: s.players.map((p) =>
        p.id === cur ? { ...p, hand: ['めん', 'えび', 'しょうが', 'しょうゆ', 'ねぎ'] } : p,
      ),
    }
    s = applyAction(s, cur, { type: 'cook', cardIndices: [0, 1, 2, 3] })
    expect(s.players.find((p) => p.id === cur)!.score).toBe(1 + 11 + 2 + 3)
    expect(s.phase).toBe('turnEnd')
  })
})
