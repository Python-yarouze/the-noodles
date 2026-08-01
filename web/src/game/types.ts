export const ESSENTIAL = ['ごはん', 'めん'] as const
export const PROTEIN = ['えび', 'ぶた', 'とり', 'たまご', 'バター'] as const
export const SEASONING = ['しょうゆ', 'みそ', 'しお'] as const
export const TOPPING = [
  'しょうが',
  'もやし',
  'ねぎ',
  'にんにく',
  'コーン',
  'きのこ',
  'めんま',
] as const

export type CardId =
  | (typeof ESSENTIAL)[number]
  | (typeof PROTEIN)[number]
  | (typeof SEASONING)[number]
  | (typeof TOPPING)[number]

export type Phase =
  | 'lobby'
  | 'turnDraw'
  | 'turnDiscard'
  | 'ajimiWindow'
  | 'turnCook'
  | 'turnEnd'
  | 'finished'

export type DiscardKind = 'single' | 'pair'

export type SingleDeclare = 'とり' | 'ぶた' | 'えび'

export interface PendingDiscard {
  playerId: string
  kind: DiscardKind
  declare: SingleDeclare | 'pair'
  cards: CardId[]
  drawAmount: number
  responders: Record<string, 'pending' | 'skip' | 'ajimi'>
  deadline: number
}

export interface PlayerState {
  id: string
  name: string
  hand: CardId[]
  score: number
  ready: boolean
  /** Extra draws at the start of next turn (from successful 味見). */
  nextTurnBonusDraw: number
  connected: boolean
}

export interface LogEntry {
  id: number
  text: string
}

export interface GameState {
  phase: Phase
  players: PlayerState[]
  turnOrder: string[]
  currentTurnIndex: number
  deck: CardId[]
  discardPile: CardId[]
  usedSingleDiscard: boolean
  usedPairDiscard: boolean
  pendingDiscard: PendingDiscard | null
  winnerId: string | null
  log: LogEntry[]
  logSeq: number
  hostId: string
  roomCode: string
}

export type ClientAction =
  | { type: 'ready' }
  | { type: 'startGame' }
  | { type: 'draw' }
  | {
      type: 'discardDeclare'
      kind: 'single'
      declare: SingleDeclare
      cardIndices: number[]
    }
  | { type: 'discardDeclare'; kind: 'pair'; cardIndices: number[] }
  | { type: 'skipDiscard' }
  | { type: 'ajimi' }
  | { type: 'skipAjimi' }
  | { type: 'cook'; cardIndices: number[] }
  | { type: 'passCook' }
  | { type: 'endTurnDiscard'; cardIndices: number[] }

export interface PublicPlayerView {
  id: string
  name: string
  handCount: number
  score: number
  ready: boolean
  connected: boolean
  isTurn: boolean
}

export interface ClientView {
  youId: string
  isHost: boolean
  phase: Phase
  hand: CardId[]
  players: PublicPlayerView[]
  deckCount: number
  discardCount: number
  usedSingleDiscard: boolean
  usedPairDiscard: boolean
  pendingDiscard: null | {
    playerId: string
    playerName: string
    kind: DiscardKind
    declare: SingleDeclare | 'pair'
    cardCount: number
    drawAmount: number
    deadline: number
    yourResponse: 'pending' | 'skip' | 'ajimi' | null
  }
  winnerId: string | null
  winnerName: string | null
  log: LogEntry[]
  roomCode: string
  canAct: boolean
}

export const WIN_SCORE = 50
export const AJIMI_WINDOW_MS = 8000
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 4

export const SINGLE_DRAW: Record<SingleDeclare, number> = {
  とり: 2,
  ぶた: 3,
  えび: 4,
}
