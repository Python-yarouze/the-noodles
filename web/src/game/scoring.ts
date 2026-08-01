import { ESSENTIAL, PROTEIN, SEASONING, TOPPING, type CardId } from './types'

/** Port of noodles.py CalcCardPoint. */
export function calcCardPoints(cards: CardId[]): number {
  let total = 0
  for (const card of cards) {
    total += scoreOne(card, cards)
  }
  if (cards.includes('にんにく')) {
    total *= 2
  }
  return total
}

function scoreOne(card: CardId, cards: CardId[]): number {
  switch (card) {
    case 'めん':
      return 1
    case 'ごはん':
      if (
        cards.length === 4 &&
        cards.some((c) => (PROTEIN as readonly string[]).includes(c)) &&
        cards.some((c) => (SEASONING as readonly string[]).includes(c)) &&
        cards.some((c) => (TOPPING as readonly string[]).includes(c))
      ) {
        return 8
      }
      return 1
    case 'えび':
      if (cards.includes('しょうが') && cards.includes('しょうゆ')) return 11
      if (cards.includes('しょうが')) return 9
      return 6
    case 'ぶた':
      return cards.includes('きのこ') ? 8 : 5
    case 'とり':
      if (cards.includes('ねぎ') && cards.includes('しょうが')) return 7
      if (cards.includes('ねぎ')) return 5
      return 3
    case 'たまご':
      return cards.some((c) => (SEASONING as readonly string[]).includes(c)) ? 5 : 3
    case 'バター':
      if (cards.includes('きのこ') && cards.includes('しょうゆ')) return 5
      if (cards.includes('きのこ')) return 3
      return 1
    case 'しょうゆ':
      if (cards.includes('しょうが')) return 3
      if (cards.includes('ねぎ')) return 2
      return 1
    case 'みそ':
      if (cards.includes('コーン') && cards.includes('バター')) return 9
      if (cards.includes('コーン')) return 4
      return 1
    case 'しお':
      if (
        cards.length === 5 &&
        !cards.some((c) => (PROTEIN as readonly string[]).includes(c))
      ) {
        return 12
      }
      // Match noodles.py: any seasoning (including しお itself) → -2
      if (cards.some((c) => (SEASONING as readonly string[]).includes(c))) {
        return -2
      }
      return 0
    case 'ねぎ':
      return cards.includes('えび') ? 4 : 3
    case 'しょうが':
      return cards.includes('ぶた') ? 4 : 2
    case 'きのこ':
      return cards.includes('とり') ? 3 : 2
    case 'めんま': {
      const otherToppings = TOPPING.filter((t) => t !== 'めんま')
      if (!cards.some((c) => (otherToppings as readonly string[]).includes(c))) {
        return 4
      }
      return 2
    }
    case 'コーン':
      return cards.includes('とり') ? 3 : 1
    case 'もやし':
      if (cards.includes('ぶた') || cards.includes('とり')) return 7
      if (cards.includes('たまご')) return 4
      return 0
    case 'にんにく':
      return -2
    default:
      return 0
  }
}

export function isValidCookSet(cards: CardId[]): boolean {
  if (cards.length < 3 || cards.length > 5) return false
  if (new Set(cards).size !== cards.length) return false
  return cards.some((c) => (ESSENTIAL as readonly string[]).includes(c))
}

/**
 * Pair equality for discard: same card, or たまご+seasoning, or バター+topping.
 */
export function arePairCompatible(a: CardId, b: CardId): boolean {
  if (a === b) return true
  const aIsEgg = a === 'たまご'
  const bIsEgg = b === 'たまご'
  const aIsButter = a === 'バター'
  const bIsButter = b === 'バター'
  const aSeason = (SEASONING as readonly string[]).includes(a)
  const bSeason = (SEASONING as readonly string[]).includes(b)
  const aTop = (TOPPING as readonly string[]).includes(a)
  const bTop = (TOPPING as readonly string[]).includes(b)
  if ((aIsEgg && bSeason) || (bIsEgg && aSeason)) return true
  if ((aIsButter && bTop) || (bIsButter && aTop)) return true
  return false
}
