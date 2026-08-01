import type { CardId } from './types'

/** Full THE NOODLES deck (★ cards included), from ラーメン効果表. */
export const DECK_COUNTS: Record<CardId, number> = {
  めん: 5,
  ごはん: 1,
  とり: 1,
  ぶた: 1,
  えび: 1,
  たまご: 1,
  バター: 1,
  しょうゆ: 3,
  みそ: 1,
  しお: 1,
  ねぎ: 2,
  しょうが: 2,
  きのこ: 3,
  めんま: 2,
  コーン: 1,
  もやし: 1,
  にんにく: 1,
}

export function buildDeck(): CardId[] {
  const deck: CardId[] = []
  for (const [card, count] of Object.entries(DECK_COUNTS) as [CardId, number][]) {
    for (let i = 0; i < count; i++) deck.push(card)
  }
  return deck
}

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function totalDeckSize(): number {
  return Object.values(DECK_COUNTS).reduce((a, b) => a + b, 0)
}
