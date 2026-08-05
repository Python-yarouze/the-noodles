/** Human-readable effect blurbs — cooking + face-down discard rules. */

import {
  ESSENTIAL,
  PROTEIN,
  SEASONING,
  TOPPING,
  categoryOf,
  cardInRuleSet,
  deckCountsFor,
} from "./deck.js";

/**
 * Wording conventions:
 * - effect: cooking only（点数・条件）
 * - discard: face-down discard-draw only（1枚宣言 / 2枚ペア）
 * - ごはん = めんと同じ扱い（必須・同時不可）
 * - Protein 1-card: 「伏せて引く（1枚）：「名前」と宣言 → N枚引く（ブラフ可）。」
 * - Pair jokers: 「伏せて引く（2枚）：…と組むと正当なペア（3枚引き）。味見されても嘘ではない。」
 */
export const CARD_EFFECTS = {
  めん: {
    base: "1点",
    effect: "必須食材。",
    discard: null,
  },
  ごはん: {
    base: "1点",
    effect:
      "必須食材。ちょうど4枚で「ごはん＋タンパク質＋調味料＋トッピング」なら8点。",
    discard:
      "伏せて引く（2枚）：めんと組むと正当なペア（3枚引き）。味見されても嘘ではない。",
  },
  とり: {
    base: "3点",
    effect: "基本3点。ねぎで5点、ねぎ＋しょうがで7点。",
    discard: "伏せて引く（1枚）：「とり」と宣言 → 2枚引く（ブラフ可）。",
  },
  ぶた: {
    base: "5点",
    effect: "基本5点。きのこで8点。",
    discard: "伏せて引く（1枚）：「ぶた」と宣言 → 3枚引く（ブラフ可）。",
  },
  えび: {
    base: "6点",
    effect: "基本6点。しょうがで9点、しょうが＋しょうゆで11点。",
    discard: "伏せて引く（1枚）：「えび」と宣言 → 4枚引く（ブラフ可）。",
  },
  たまご: {
    base: "3点",
    effect: "基本3点。調味料と一緒なら5点。",
    discard:
      "伏せて引く（2枚）：調味料1枚と組むと正当なペア（3枚引き）。味見されても嘘ではない。",
  },
  バター: {
    base: "1点",
    effect: "基本1点。きのこで3点、きのこ＋しょうゆで5点。",
    discard:
      "伏せて引く（2枚）：トッピング1枚と組むと正当なペア（3枚引き）。味見されても嘘ではない。",
  },
  しょうゆ: {
    base: "1点",
    effect: "基本1点。ねぎで2点、しょうがで3点。",
    discard: null,
  },
  みそ: {
    base: "1点",
    effect: "基本1点。コーンで4点、コーン＋バターで9点。",
    discard: null,
  },
  しお: {
    base: "0点",
    effect:
      "基本0点。他の調味料（しょうゆ・みそ）があると−2点。タンパク質なしの5枚料理なら12点。",
    discard: null,
  },
  ねぎ: {
    base: "3点",
    effect: "基本3点。えびで4点。",
    discard: null,
  },
  しょうが: {
    base: "2点",
    effect: "基本2点。ぶたで4点。",
    discard: null,
  },
  きのこ: {
    base: "2点",
    effect: "基本2点。とりで3点。",
    discard: null,
  },
  めんま: {
    base: "2点",
    effect: "基本2点。トッピングがめんまだけのとき4点。",
    discard: null,
  },
  コーン: {
    base: "1点",
    effect: "基本1点。とりで3点。",
    discard: null,
  },
  もやし: {
    base: "0点",
    effect: "基本0点。たまごで4点、ぶたまたはとりで7点。",
    discard: null,
  },
  にんにく: {
    base: "−2点",
    effect: "基本−2点。料理の合計点を2倍にする（この−2も先に加算してから倍）。",
    discard: null,
  },
};

const CATEGORY_ORDER = [
  ["必須食材", ESSENTIAL],
  ["タンパク質", PROTEIN],
  ["調味料", SEASONING],
  ["トッピング", TOPPING],
];

export function getCardEffect(name, ruleSet = "noodles") {
  const data = CARD_EFFECTS[name];
  if (!data) return null;
  const counts = deckCountsFor(ruleSet);
  const count = counts[name] || 0;
  return {
    name,
    category: categoryOf(name),
    count,
    countLabel: count > 0 ? `${count}枚` : "0枚（本ルール外）",
    ...data,
  };
}

/** Grouped list; marks cards not in current rule set. */
export function effectsByCategory(ruleSet = "noodles") {
  return CATEGORY_ORDER.map(([label, names]) => ({
    label,
    cards: names
      .map((n) => {
        const fx = getCardEffect(n, ruleSet);
        if (!fx) return null;
        return { ...fx, inSet: cardInRuleSet(n, ruleSet) };
      })
      .filter(Boolean),
  }));
}
