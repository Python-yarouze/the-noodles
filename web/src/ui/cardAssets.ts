import type { CardId } from '../game/types'

export function cardImageUrl(card: CardId): string {
  return `/cards/${encodeURIComponent(card)}.png`
}

export const ALL_CARDS: CardId[] = [
  'めん',
  'ごはん',
  'とり',
  'ぶた',
  'えび',
  'たまご',
  'バター',
  'しょうゆ',
  'みそ',
  'しお',
  'ねぎ',
  'しょうが',
  'きのこ',
  'めんま',
  'コーン',
  'もやし',
  'にんにく',
]
