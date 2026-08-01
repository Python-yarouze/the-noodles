import { describe, expect, it } from 'vitest'
import { arePairCompatible, calcCardPoints, isValidCookSet } from './scoring'

describe('calcCardPoints', () => {
  it('matches noodles.py sample hands', () => {
    expect(calcCardPoints(['めん', 'えび', 'しょうが', 'しょうゆ'])).toBe(1 + 11 + 2 + 3)
    expect(calcCardPoints(['ごはん', 'ぶた', 'みそ', 'ねぎ'])).toBe(8 + 5 + 1 + 3)
    expect(calcCardPoints(['めん', 'にんにく', 'ぶた'])).toBe((1 + -2 + 5) * 2)
    expect(calcCardPoints(['ごはん', 'たまご', 'しょうゆ', 'ねぎ'])).toBe(8 + 5 + 2 + 3)
    expect(calcCardPoints(['めん', 'バター', 'コーン', 'みそ', 'きのこ'])).toBe(
      1 + 3 + 1 + 9 + 2,
    )
  })
})

describe('isValidCookSet', () => {
  it('requires 3-5 unique cards with essential', () => {
    expect(isValidCookSet(['めん', 'ぶた', 'ねぎ'])).toBe(true)
    expect(isValidCookSet(['ぶた', 'ねぎ', 'しょうゆ'])).toBe(false)
    expect(isValidCookSet(['めん', 'ぶた'])).toBe(false)
    expect(isValidCookSet(['めん', 'ぶた', 'ぶた'])).toBe(false)
  })
})

describe('arePairCompatible', () => {
  it('supports egg+seasoning and butter+topping', () => {
    expect(arePairCompatible('とり', 'とり')).toBe(true)
    expect(arePairCompatible('たまご', 'しょうゆ')).toBe(true)
    expect(arePairCompatible('バター', 'きのこ')).toBe(true)
    expect(arePairCompatible('とり', 'ぶた')).toBe(false)
  })
})
