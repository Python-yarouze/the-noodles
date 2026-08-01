import { buildDeck, shuffle } from './deck'
import { arePairCompatible, calcCardPoints, isValidCookSet } from './scoring'
import {
  AJIMI_WINDOW_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SINGLE_DRAW,
  WIN_SCORE,
  type CardId,
  type ClientAction,
  type GameState,
  type PlayerState,
  type SingleDeclare,
} from './types'

function pushLog(state: GameState, text: string): GameState {
  const id = state.logSeq + 1
  return {
    ...state,
    logSeq: id,
    log: [...state.log, { id, text }].slice(-80),
  }
}

function playerById(state: GameState, id: string): PlayerState | undefined {
  return state.players.find((p) => p.id === id)
}

function currentPlayer(state: GameState): PlayerState {
  const id = state.turnOrder[state.currentTurnIndex]
  const p = playerById(state, id)
  if (!p) throw new Error('current player missing')
  return p
}

function updatePlayer(
  state: GameState,
  id: string,
  fn: (p: PlayerState) => PlayerState,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === id ? fn(p) : p)),
  }
}

function ensureDrawPile(state: GameState): GameState {
  if (state.deck.length > 0) return state
  if (state.discardPile.length === 0) return state
  return {
    ...state,
    deck: shuffle(state.discardPile),
    discardPile: [],
  }
}

function drawCards(state: GameState, playerId: string, n: number): GameState {
  let s = state
  const drawn: CardId[] = []
  for (let i = 0; i < n; i++) {
    s = ensureDrawPile(s)
    if (s.deck.length === 0) break
    const card = s.deck[0]
    s = { ...s, deck: s.deck.slice(1) }
    drawn.push(card)
  }
  if (drawn.length === 0) return s
  s = updatePlayer(s, playerId, (p) => ({ ...p, hand: [...p.hand, ...drawn] }))
  return s
}

function removeHandIndices(
  hand: CardId[],
  indices: number[],
): { kept: CardId[]; removed: CardId[] } {
  const set = new Set(indices)
  const kept: CardId[] = []
  const removed: CardId[] = []
  hand.forEach((c, i) => {
    if (set.has(i)) removed.push(c)
    else kept.push(c)
  })
  return { kept, removed }
}

function checkWin(state: GameState): GameState {
  const winner = state.players.find((p) => p.score >= WIN_SCORE)
  if (!winner) return state
  return pushLog({ ...state, phase: 'finished', winnerId: winner.id }, `${winner.name} の勝ち！（${winner.score}点）`)
}

function advanceTurn(state: GameState): GameState {
  const next = (state.currentTurnIndex + 1) % state.turnOrder.length
  return {
    ...state,
    currentTurnIndex: next,
    phase: 'turnDraw',
    usedSingleDiscard: false,
    usedPairDiscard: false,
    pendingDiscard: null,
  }
}

export function createLobby(hostId: string, hostName: string, roomCode: string): GameState {
  return {
    phase: 'lobby',
    players: [
      {
        id: hostId,
        name: hostName,
        hand: [],
        score: 0,
        ready: true,
        nextTurnBonusDraw: 0,
        connected: true,
      },
    ],
    turnOrder: [],
    currentTurnIndex: 0,
    deck: [],
    discardPile: [],
    usedSingleDiscard: false,
    usedPairDiscard: false,
    pendingDiscard: null,
    winnerId: null,
    log: [],
    logSeq: 0,
    hostId,
    roomCode,
  }
}

export function addPlayer(state: GameState, id: string, name: string): GameState {
  if (state.phase !== 'lobby') return state
  if (state.players.some((p) => p.id === id)) {
    return updatePlayer(state, id, (p) => ({ ...p, connected: true, name }))
  }
  if (state.players.length >= MAX_PLAYERS) return state
  let s: GameState = {
    ...state,
    players: [
      ...state.players,
      {
        id,
        name,
        hand: [],
        score: 0,
        ready: false,
        nextTurnBonusDraw: 0,
        connected: true,
      },
    ],
  }
  s = pushLog(s, `${name} が参加しました`)
  return s
}

export function setPlayerConnected(
  state: GameState,
  id: string,
  connected: boolean,
): GameState {
  if (!playerById(state, id)) return state
  return updatePlayer(state, id, (p) => ({ ...p, connected }))
}

function startGame(state: GameState, actorId: string): GameState {
  if (state.phase !== 'lobby') return state
  if (actorId !== state.hostId) return state
  if (state.players.length < MIN_PLAYERS) return state
  if (!state.players.every((p) => p.ready || p.id === state.hostId)) {
    // host always ready; require others ready
  }
  const othersReady = state.players
    .filter((p) => p.id !== state.hostId)
    .every((p) => p.ready)
  if (!othersReady) return state

  const order = shuffle(state.players.map((p) => p.id))
  let s: GameState = {
    ...state,
    phase: 'turnDraw',
    turnOrder: order,
    currentTurnIndex: 0,
    deck: shuffle(buildDeck()),
    discardPile: [],
    usedSingleDiscard: false,
    usedPairDiscard: false,
    pendingDiscard: null,
    winnerId: null,
    players: state.players.map((p) => ({
      ...p,
      hand: [],
      score: 0,
      nextTurnBonusDraw: 0,
    })),
  }
  s = pushLog(s, 'ゲーム開始！ 手番順を決めました')
  for (const pid of order) {
    s = drawCards(s, pid, 3)
  }
  const first = playerById(s, order[0])
  s = pushLog(s, `${first?.name ?? ''} の手番です`)
  return s
}

function doDraw(state: GameState, actorId: string): GameState {
  if (state.phase !== 'turnDraw') return state
  const cur = currentPlayer(state)
  if (cur.id !== actorId) return state
  const bonus = cur.nextTurnBonusDraw
  let s = updatePlayer(state, actorId, (p) => ({ ...p, nextTurnBonusDraw: 0 }))
  s = drawCards(s, actorId, 1 + bonus)
  s = pushLog(
    s,
    bonus > 0
      ? `${cur.name} がカードを${1 + bonus}枚引いた（味見ボーナス含む）`
      : `${cur.name} がカードを1枚引いた`,
  )
  return { ...s, phase: 'turnDiscard' }
}

function isTruthfulSingle(declare: SingleDeclare, cards: CardId[]): boolean {
  return cards.length === 1 && cards[0] === declare
}

function isTruthfulPair(cards: CardId[]): boolean {
  return cards.length === 2 && arePairCompatible(cards[0], cards[1])
}

function beginAjimiWindow(
  state: GameState,
  playerId: string,
  kind: 'single' | 'pair',
  declare: SingleDeclare | 'pair',
  cards: CardId[],
  drawAmount: number,
): GameState {
  const responders: Record<string, 'pending' | 'skip' | 'ajimi'> = {}
  for (const p of state.players) {
    if (p.id !== playerId) responders[p.id] = 'pending'
  }
  const others = Object.keys(responders)
  if (others.length === 0) {
    // solo shouldn't happen; grant draw immediately
    let s = drawCards(state, playerId, drawAmount)
    s = {
      ...s,
      discardPile: [...s.discardPile, ...cards],
      phase: 'turnDiscard',
      pendingDiscard: null,
    }
    return s
  }
  return {
    ...state,
    phase: 'ajimiWindow',
    pendingDiscard: {
      playerId,
      kind,
      declare,
      cards,
      drawAmount,
      responders,
      deadline: Date.now() + AJIMI_WINDOW_MS,
    },
  }
}

function doDiscardDeclare(
  state: GameState,
  actorId: string,
  action: Extract<ClientAction, { type: 'discardDeclare' }>,
): GameState {
  if (state.phase !== 'turnDiscard') return state
  const cur = currentPlayer(state)
  if (cur.id !== actorId) return state

  if (action.kind === 'single') {
    if (state.usedSingleDiscard) return state
    if (action.cardIndices.length !== 1) return state
    const { kept, removed } = removeHandIndices(cur.hand, action.cardIndices)
    if (removed.length !== 1) return state
    const drawAmount = SINGLE_DRAW[action.declare]
    let s = updatePlayer(state, actorId, (p) => ({ ...p, hand: kept }))
    s = { ...s, usedSingleDiscard: true }
    s = pushLog(s, `${cur.name} が「${action.declare}」と宣言して1枚捨てた`)
    return beginAjimiWindow(s, actorId, 'single', action.declare, removed, drawAmount)
  }

  // pair
  if (state.usedPairDiscard) return state
  if (action.cardIndices.length !== 2) return state
  const { kept, removed } = removeHandIndices(cur.hand, action.cardIndices)
  if (removed.length !== 2) return state
  // Must claim pair — allow attempt even if lying (ajimi catches)
  let s = updatePlayer(state, actorId, (p) => ({ ...p, hand: kept }))
  s = { ...s, usedPairDiscard: true }
  s = pushLog(s, `${cur.name} がペアとして2枚捨てた`)
  return beginAjimiWindow(s, actorId, 'pair', 'pair', removed, 3)
}

function resolveAjimiSuccess(state: GameState, tasterId: string): GameState {
  const pending = state.pendingDiscard
  if (!pending) return state
  const discarder = playerById(state, pending.playerId)
  const taster = playerById(state, tasterId)
  let s: GameState = {
    ...state,
    discardPile: [...state.discardPile, ...pending.cards],
    pendingDiscard: null,
    phase: 'turnDiscard',
  }
  s = updatePlayer(s, tasterId, (p) => ({
    ...p,
    nextTurnBonusDraw: p.nextTurnBonusDraw + 1,
  }))
  s = pushLog(
    s,
    `味見成功！ ${taster?.name ?? ''} が嘘を見抜いた（${discarder?.name ?? ''} はドローできない）。捨て札: ${pending.cards.join('・')}`,
  )
  return s
}

function resolveAjimiFail(state: GameState, tasterId: string): GameState {
  const pending = state.pendingDiscard
  if (!pending) return state
  const taster = playerById(state, tasterId)
  let s: GameState = { ...state }

  if (taster && taster.hand.length > 0) {
    s = {
      ...s,
      discardPile: [...s.discardPile, ...taster.hand],
    }
    s = updatePlayer(s, tasterId, (p) => ({ ...p, hand: [] }))
    s = pushLog(s, `味見失敗… ${taster.name} は手札をすべて捨てた`)
  } else if (taster) {
    s = updatePlayer(s, tasterId, (p) => ({ ...p, score: p.score - 5 }))
    s = pushLog(s, `味見失敗… ${taster.name} は −5点`)
  }

  // Truthful discard proceeds: discarder draws
  s = {
    ...s,
    discardPile: [...s.discardPile, ...pending.cards],
    pendingDiscard: null,
    phase: 'turnDiscard',
  }
  s = drawCards(s, pending.playerId, pending.drawAmount)
  const discarder = playerById(s, pending.playerId)
  s = pushLog(
    s,
    `${discarder?.name ?? ''} が${pending.drawAmount}枚引いた（宣言どおり: ${pending.cards.join('・')}）`,
  )
  return s
}

function resolveNoAjimi(state: GameState): GameState {
  const pending = state.pendingDiscard
  if (!pending) return state
  let s: GameState = {
    ...state,
    discardPile: [...state.discardPile, ...pending.cards],
    pendingDiscard: null,
    phase: 'turnDiscard',
  }
  s = drawCards(s, pending.playerId, pending.drawAmount)
  const discarder = playerById(s, pending.playerId)
  s = pushLog(s, `${discarder?.name ?? ''} が${pending.drawAmount}枚引いた`)
  return s
}

function isLie(pending: NonNullable<GameState['pendingDiscard']>): boolean {
  if (pending.kind === 'single') {
    return !isTruthfulSingle(pending.declare as SingleDeclare, pending.cards)
  }
  return !isTruthfulPair(pending.cards)
}

function canAjimi(state: GameState, playerId: string): boolean {
  const p = playerById(state, playerId)
  if (!p) return false
  if (p.hand.length === 0 && p.score <= 4) return false
  return true
}

function doAjimi(state: GameState, actorId: string): GameState {
  if (state.phase !== 'ajimiWindow' || !state.pendingDiscard) return state
  if (actorId === state.pendingDiscard.playerId) return state
  if (state.pendingDiscard.responders[actorId] !== 'pending') return state
  if (!canAjimi(state, actorId)) return state

  if (isLie(state.pendingDiscard)) {
    return resolveAjimiSuccess(state, actorId)
  }
  return resolveAjimiFail(state, actorId)
}

function doSkipAjimi(state: GameState, actorId: string): GameState {
  if (state.phase !== 'ajimiWindow' || !state.pendingDiscard) return state
  if (actorId === state.pendingDiscard.playerId) return state
  if (state.pendingDiscard.responders[actorId] !== 'pending') return state

  const responders = {
    ...state.pendingDiscard.responders,
    [actorId]: 'skip' as const,
  }
  let s: GameState = {
    ...state,
    pendingDiscard: { ...state.pendingDiscard, responders },
  }
  if (Object.values(responders).every((r) => r === 'skip')) {
    s = resolveNoAjimi(s)
  }
  return s
}

/** Called by host timer when ajimi window expires. */
export function tickAjimiTimeout(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'ajimiWindow' || !state.pendingDiscard) return state
  if (now < state.pendingDiscard.deadline) return state
  return resolveNoAjimi(state)
}

function doSkipDiscard(state: GameState, actorId: string): GameState {
  if (state.phase !== 'turnDiscard') return state
  if (currentPlayer(state).id !== actorId) return state
  return { ...state, phase: 'turnCook', pendingDiscard: null }
}

function doCook(
  state: GameState,
  actorId: string,
  cardIndices: number[],
): GameState {
  if (state.phase !== 'turnCook') return state
  const cur = currentPlayer(state)
  if (cur.id !== actorId) return state
  const { kept, removed } = removeHandIndices(cur.hand, cardIndices)
  if (!isValidCookSet(removed)) return state
  const points = calcCardPoints(removed)
  let s = updatePlayer(state, actorId, (p) => ({
    ...p,
    hand: kept,
    score: p.score + points,
  }))
  s = { ...s, discardPile: [...s.discardPile, ...removed] }
  s = pushLog(
    s,
    `${cur.name} が調理！ ${removed.join('・')} → ${points}点（合計 ${playerById(s, actorId)?.score}点）`,
  )
  s = drawCards(s, actorId, 1)
  s = checkWin(s)
  if (s.phase === 'finished') return s
  return { ...s, phase: 'turnEnd' }
}

function doPassCook(state: GameState, actorId: string): GameState {
  if (state.phase !== 'turnCook') return state
  if (currentPlayer(state).id !== actorId) return state
  return { ...state, phase: 'turnEnd' }
}

function doEndTurnDiscard(
  state: GameState,
  actorId: string,
  cardIndices: number[],
): GameState {
  if (state.phase !== 'turnEnd') return state
  const cur = currentPlayer(state)
  if (cur.id !== actorId) return state

  const need = cur.hand.length - 3
  if (need < 0) {
    // Shouldn't happen often; draw up? Rules assume >=3. Draw to 3.
    let s = drawCards(state, actorId, -need)
    s = pushLog(s, `${cur.name} の手番終了`)
    s = advanceTurn(s)
    const next = currentPlayer(s)
    return pushLog(s, `${next.name} の手番です`)
  }
  if (need === 0) {
    if (cardIndices.length !== 0) return state
    let s = pushLog(state, `${cur.name} の手番終了`)
    s = advanceTurn(s)
    const next = currentPlayer(s)
    return pushLog(s, `${next.name} の手番です`)
  }
  if (cardIndices.length !== need) return state
  const { kept, removed } = removeHandIndices(cur.hand, cardIndices)
  if (kept.length !== 3) return state
  let s = updatePlayer(state, actorId, (p) => ({ ...p, hand: kept }))
  s = { ...s, discardPile: [...s.discardPile, ...removed] }
  s = pushLog(s, `${cur.name} が${removed.length}枚捨てて手番終了`)
  s = advanceTurn(s)
  const next = currentPlayer(s)
  return pushLog(s, `${next.name} の手番です`)
}

export function applyAction(
  state: GameState,
  actorId: string,
  action: ClientAction,
): GameState {
  switch (action.type) {
    case 'ready':
      if (state.phase !== 'lobby') return state
      return updatePlayer(state, actorId, (p) => ({ ...p, ready: true }))
    case 'startGame':
      return startGame(state, actorId)
    case 'draw':
      return doDraw(state, actorId)
    case 'discardDeclare':
      return doDiscardDeclare(state, actorId, action)
    case 'skipDiscard':
      return doSkipDiscard(state, actorId)
    case 'ajimi':
      return doAjimi(state, actorId)
    case 'skipAjimi':
      return doSkipAjimi(state, actorId)
    case 'cook':
      return doCook(state, actorId, action.cardIndices)
    case 'passCook':
      return doPassCook(state, actorId)
    case 'endTurnDiscard':
      return doEndTurnDiscard(state, actorId, action.cardIndices)
    default:
      return state
  }
}

export function renamePlayer(state: GameState, id: string, name: string): GameState {
  if (!playerById(state, id)) return state
  return updatePlayer(state, id, (p) => ({ ...p, name }))
}
