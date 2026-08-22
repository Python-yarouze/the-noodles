/** Card categories and deck composition (ラーメン効果表). */

export const ESSENTIAL = ["ごはん", "めん"];
export const PROTEIN = ["えび", "ぶた", "とり", "たまご", "バター"];
export const SEASONING = ["しょうゆ", "みそ", "しお"];
export const TOPPING = ["しょうが", "もやし", "ねぎ", "にんにく", "コーン", "きのこ", "めんま"];

export const ALL_CARD_NAMES = [...ESSENTIAL, ...PROTEIN, ...SEASONING, ...TOPPING];

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

/** Full THE NOODLES deck (★ included). */
export const DECK_COUNTS_NOODLES = {
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
  めんま: 1,
  コーン: 2,
  もやし: 1,
  にんにく: 1,
};

/**
 * Classic stir fly eighteen: remove ★ cards; めん without ★+2 → 3.
 */
export const DECK_COUNTS_CLASSIC = {
  めん: 3,
  とり: 1,
  ぶた: 1,
  えび: 1,
  しょうゆ: 3,
  ねぎ: 2,
  しょうが: 2,
  きのこ: 3,
};

/** @deprecated use DECK_COUNTS_NOODLES */
export const DECK_COUNTS = DECK_COUNTS_NOODLES;

export const SPECIAL_DRAW = {
  とり: 2,
  ぶた: 3,
  えび: 4,
};

export const WIN_SCORE = 50;
export const TASTE_WINDOW_MS = 15000;
export const START_HAND = 3;
export const HAND_LIMIT = 3;

/** Allowed ranges for lobby settings */
export const WIN_SCORE_MIN = 20;
export const WIN_SCORE_MAX = 100;
export const TASTE_SEC_MIN = 0;
export const TASTE_SEC_MAX = 60;

export function clampWinScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return WIN_SCORE;
  return Math.min(WIN_SCORE_MAX, Math.max(WIN_SCORE_MIN, Math.round(v)));
}

export function clampTasteMs(ms) {
  const sec = Number(ms) / 1000;
  if (!Number.isFinite(sec)) return TASTE_WINDOW_MS;
  const rounded = Math.round(sec);
  if (rounded <= 0) return 0;
  return Math.min(TASTE_SEC_MAX, Math.max(1, rounded)) * 1000;
}

export const RULE_LABELS = {
  noodles: "THE NOODLES",
  classic: "本家ルール",
};

let _nextId = 1;

export function createCard(name) {
  return { id: `c${_nextId++}`, name };
}

export function deckCountsFor(ruleSet) {
  return ruleSet === "classic" ? DECK_COUNTS_CLASSIC : DECK_COUNTS_NOODLES;
}

/**
 * @param {"noodles"|"classic"} [ruleSet="noodles"]
 */
export function buildDeck(ruleSet = "noodles") {
  _nextId = 1;
  const counts = deckCountsFor(ruleSet);
  const deck = [];
  for (const [name, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      deck.push(createCard(name));
    }
  }
  return shuffle(deck);
}

export function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** English asset filenames (Japanese card names stay in game UI). */
export const CARD_IMAGE_FILES = {
  めん: "noodle",
  ごはん: "rice",
  とり: "chicken",
  ぶた: "pork",
  えび: "shrimp",
  たまご: "egg",
  バター: "butter",
  しょうゆ: "soy",
  みそ: "miso",
  しお: "salt",
  ねぎ: "green-onion",
  しょうが: "ginger",
  きのこ: "mushroom",
  めんま: "menma",
  コーン: "corn",
  もやし: "sprouts",
  にんにく: "garlic",
};

export const RULES_IMAGE = "assets/cards/rules.png";
export const EFFECT_CHART_IMAGE = "assets/cards/effect-chart.png";

export function cardImagePath(name) {
  const file = CARD_IMAGE_FILES[name] || "noodle";
  return `assets/cards/${file}.png`;
}

export function isEssential(name) {
  return ESSENTIAL.includes(name);
}

export function isSeasoning(name) {
  return SEASONING.includes(name);
}

export function isTopping(name) {
  return TOPPING.includes(name);
}

/**
 * Valid pair for 2-card discard → draw 3:
 * - two cards with the same name
 * - ごはん + めん (ごはん is treated as めん)
 * - たまご + any seasoning
 * - バター + any topping
 */
export function isValidPair(cardA, cardB) {
  if (!cardA || !cardB) return false;
  if (cardA.name === cardB.name) return true;
  const names = [cardA.name, cardB.name];
  if (names.includes("ごはん") && names.includes("めん")) return true;
  if (names.includes("たまご") && names.some((n) => isSeasoning(n) && n !== "たまご")) {
    return true;
  }
  if (names.includes("バター") && names.some((n) => isTopping(n))) {
    return true;
  }
  return false;
}

export function categoryOf(name) {
  if (ESSENTIAL.includes(name)) return "必須食材";
  if (PROTEIN.includes(name)) return "タンパク質";
  if (SEASONING.includes(name)) return "調味料";
  if (TOPPING.includes(name)) return "トッピング";
  return "";
}

export function cardInRuleSet(name, ruleSet) {
  const counts = deckCountsFor(ruleSet);
  return (counts[name] || 0) > 0;
}
