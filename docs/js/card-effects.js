/** Human-readable effect blurbs from ラーメン効果表 + discard rules. */

import {
  ESSENTIAL,
  PROTEIN,
  SEASONING,
  TOPPING,
  categoryOf,
  cardInRuleSet,
} from "./deck.js";

export const CARD_EFFECTS = {
  めん: {
    base: "1点",
    effect:
      "必須食材。料理にはめん（またはごはん）のどちらか一方が必要。ごはんと同時には使えません。",
    discard: "ごはんと2枚伏せると正当なペア（3枚引き）。味見されても嘘ではない。",
  },
  ごはん: {
    base: "1点（条件で8点）",
    effect:
      "めんと同じ扱いの必須食材（めんとは同時不可）。ちょうど4枚で「ごはん＋タンパク質＋調味料＋トッピング」なら8点。",
    discard: "めんと2枚伏せると正当なペア（3枚引き）。味見されても嘘ではない。",
  },
  とり: {
    base: "3点",
    effect: "ねぎで5点、ねぎ＋しょうがで7点。",
    discard: "1枚捨てで宣言すると2枚引く（ブラフ可）。",
  },
  ぶた: {
    base: "5点",
    effect: "きのこで8点。",
    discard: "1枚捨てで宣言すると3枚引く（ブラフ可）。",
  },
  えび: {
    base: "6点",
    effect: "しょうがで9点、しょうが＋しょうゆで11点。",
    discard: "1枚捨てで宣言すると4枚引く（ブラフ可）。",
  },
  たまご: {
    base: "3点",
    effect: "調味料と一緒なら5点。",
    discard: "ジョーカー：調味料1枚と伏せると正当なペア（3枚引き）。味見されても嘘ではない。",
  },
  バター: {
    base: "1点",
    effect: "きのこで3点、きのこ＋しょうゆで5点。",
    discard: "ジョーカー：トッピング1枚と伏せると正当なペア（3枚引き）。味見されても嘘ではない。",
  },
  しょうゆ: {
    base: "1点",
    effect: "ねぎで2点、しょうがで3点。",
    discard: null,
  },
  みそ: {
    base: "1点",
    effect: "コーンで4点、コーン＋バターで9点。",
    discard: null,
  },
  しお: {
    base: "0点",
    effect:
      "他の調味料（しょうゆ・みそ）があると−2点。しおだけのときは減点なし。タンパク質なしの5枚料理なら12点。",
    discard: null,
  },
  ねぎ: {
    base: "3点",
    effect: "えびで4点。",
    discard: null,
  },
  しょうが: {
    base: "2点",
    effect: "ぶたで4点。",
    discard: null,
  },
  きのこ: {
    base: "2点",
    effect: "とりで3点。",
    discard: null,
  },
  めんま: {
    base: "2点",
    effect: "トッピングがめんまだけのとき4点。",
    discard: null,
  },
  コーン: {
    base: "1点",
    effect: "とりで3点。",
    discard: null,
  },
  もやし: {
    base: "0点",
    effect: "たまごで4点、ぶたまたはとりで7点。",
    discard: null,
  },
  にんにく: {
    base: "−2点",
    effect: "料理の合計点を2倍にする（この−2も先に加算してから倍）。",
    discard: null,
  },
};

const CATEGORY_ORDER = [
  ["必須食材", ESSENTIAL],
  ["タンパク質", PROTEIN],
  ["調味料", SEASONING],
  ["トッピング", TOPPING],
];

export function getCardEffect(name) {
  const data = CARD_EFFECTS[name];
  if (!data) return null;
  return {
    name,
    category: categoryOf(name),
    ...data,
  };
}

/** Grouped list; marks cards not in current rule set. */
export function effectsByCategory(ruleSet = "noodles") {
  return CATEGORY_ORDER.map(([label, names]) => ({
    label,
    cards: names
      .map((n) => {
        const fx = getCardEffect(n);
        if (!fx) return null;
        return { ...fx, inSet: cardInRuleSet(n, ruleSet) };
      })
      .filter(Boolean),
  }));
}
