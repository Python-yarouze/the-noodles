/** Port of CalcCardPoint from noodles.py */

import { ESSENTIAL, PROTEIN, SEASONING, TOPPING } from "./deck.js";

function has(cards, name) {
  return cards.includes(name);
}

function anyOf(cards, list) {
  return list.some((n) => cards.includes(n));
}

const scorers = {
  めん() {
    return 1;
  },
  ごはん(cards) {
    if (
      cards.length === 4 &&
      anyOf(cards, PROTEIN) &&
      anyOf(cards, SEASONING) &&
      anyOf(cards, TOPPING)
    ) {
      return 8;
    }
    return 1;
  },
  えび(cards) {
    if (has(cards, "しょうが") && has(cards, "しょうゆ")) return 11;
    if (has(cards, "しょうが")) return 9;
    return 6;
  },
  もやし(cards) {
    if (has(cards, "ぶた") || has(cards, "とり")) return 7;
    if (has(cards, "たまご")) return 4;
    return 0;
  },
  めんま(cards) {
    // 4 if menma is the only topping used
    if (!anyOf(cards, TOPPING.filter((t) => t !== "めんま"))) return 4;
    return 2;
  },
  みそ(cards) {
    if (has(cards, "コーン") && has(cards, "バター")) return 9;
    if (has(cards, "コーン")) return 4;
    return 1;
  },
  ぶた(cards) {
    if (has(cards, "きのこ")) return 8;
    return 5;
  },
  バター(cards) {
    if (has(cards, "きのこ") && has(cards, "しょうゆ")) return 5;
    if (has(cards, "きのこ")) return 3;
    return 1;
  },
  ねぎ(cards) {
    if (has(cards, "えび")) return 4;
    return 3;
  },
  にんにく() {
    return -2;
  },
  とり(cards) {
    if (has(cards, "ねぎ") && has(cards, "しょうが")) return 7;
    if (has(cards, "ねぎ")) return 5;
    return 3;
  },
  たまご(cards) {
    if (anyOf(cards, SEASONING)) return 5;
    return 3;
  },
  しょうゆ(cards) {
    if (has(cards, "しょうが")) return 3;
    if (has(cards, "ねぎ")) return 2;
    return 1;
  },
  しょうが(cards) {
    if (has(cards, "ぶた")) return 4;
    return 2;
  },
  しお(cards) {
    if (cards.length === 5 && !anyOf(cards, PROTEIN)) return 12;
    // −2 only when another seasoning is present (not しお alone)
    if (SEASONING.some((n) => n !== "しお" && cards.includes(n))) return -2;
    return 0;
  },
  コーン(cards) {
    if (has(cards, "とり")) return 3;
    return 1;
  },
  きのこ(cards) {
    if (has(cards, "とり")) return 3;
    return 2;
  },
};

/**
 * Per-card points before garlic doubling.
 * @param {string[]} cards
 */
export function scoreLines(cards) {
  return cards.map((name) => {
    const fn = scorers[name];
    return { name, points: fn ? fn(cards) : 0 };
  });
}

/**
 * @param {string[]} cards card names in the cooked set
 * @returns {number}
 */
export function calcCardPoints(cards) {
  let total = scoreLines(cards).reduce((s, l) => s + l.points, 0);
  if (has(cards, "にんにく")) total *= 2;
  return total;
}

/**
 * Breakdown for UI preview (does not require a legal cook set).
 * @param {string[]} names
 */
export function explainScore(names) {
  const garlicDoubled = has(names, "にんにく");
  const lines = scoreLines(names);
  const subtotal = lines.reduce((s, l) => s + l.points, 0);
  const total = garlicDoubled ? subtotal * 2 : subtotal;
  return { ok: true, total, lines, garlicDoubled, subtotal };
}

/**
 * Validate a cook set: 3–5 cards, unique types, exactly one essential
 * (めん or ごはん — not both; ごはん is treated as めん).
 * @param {string[]} names
 * @param {"noodles"|"classic"} [ruleSet="noodles"]
 */
export function validateCookSet(names, ruleSet = "noodles") {
  if (names.length < 3 || names.length > 5) {
    return { ok: false, reason: "料理は3〜5枚で出してください" };
  }
  if (new Set(names).size !== names.length) {
    return { ok: false, reason: "同じ種類のカードは含められません" };
  }
  const essentials = names.filter((n) => ESSENTIAL.includes(n));
  if (essentials.length === 0) {
    const need =
      ruleSet === "classic" ? "めんが必要です" : "めんが必要です（ごはんでもOK・めんと同じ扱い）";
    return { ok: false, reason: need };
  }
  if (essentials.length > 1) {
    return { ok: false, reason: "ごはんとめんは一緒に使えません（どちらか一方）" };
  }
  const explained = explainScore(names);
  return { ok: true, points: explained.total, ...explained };
}
