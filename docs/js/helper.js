/**
 * Hand improvement suggestions + strong combos (port of noodles.py).
 */

import {
  ESSENTIAL,
  PROTEIN,
  SEASONING,
  TOPPING,
  deckCountsFor,
} from "./deck.js";
import { calcCardPoints } from "./scoring.js";

function availableNames(ruleSet) {
  const counts = deckCountsFor(ruleSet);
  return Object.keys(counts).filter((n) => counts[n] > 0);
}

function combinations(arr, k) {
  const out = [];
  const n = arr.length;
  function rec(start, path) {
    if (path.length === k) {
      out.push([...path]);
      return;
    }
    for (let i = start; i < n; i++) {
      path.push(arr[i]);
      rec(i + 1, path);
      path.pop();
    }
  }
  rec(0, []);
  return out;
}

/**
 * Best cook sets for the rule set (TOP N).
 * @param {"noodles"|"classic"} ruleSet
 * @param {number} [limit=12]
 */
export function topCombinations(ruleSet = "noodles", limit = 12) {
  const pool = availableNames(ruleSet);
  const essentials = pool.filter((n) => ESSENTIAL.includes(n));
  const others = pool.filter((n) => !ESSENTIAL.includes(n));
  const results = [];

  for (let n = 3; n <= 5; n++) {
    for (const ess of essentials) {
      for (const combo of combinations(others, n - 1)) {
        const cards = [ess, ...combo];
        results.push({ cards, points: calcCardPoints(cards) });
      }
    }
  }
  results.sort((a, b) => b.points - a.points);
  return results.slice(0, limit);
}

/**
 * Suggest swaps / adds to improve a cook set or hand.
 * Mirrors noodles.py suggest_improvements.
 * @param {string[]} currentCards unique names (cook selection or hand subset)
 * @param {"noodles"|"classic"} ruleSet
 * @param {number} [limit=10]
 */
export function suggestImprovements(currentCards, ruleSet = "noodles", limit = 10) {
  const allCards = availableNames(ruleSet);
  if (!currentCards.length) {
    return { currentPoints: 0, suggestions: [] };
  }

  const currentPoints = calcCardPoints(currentCards);
  const suggestions = [];

  for (let i = 0; i < currentCards.length; i++) {
    const oldCard = currentCards[i];
    const candidates =
      ESSENTIAL.includes(oldCard)
        ? ESSENTIAL.filter((n) => allCards.includes(n) && !currentCards.includes(n))
        : allCards.filter((n) => !currentCards.includes(n));

    for (const newCard of candidates) {
      const newHand = [...currentCards.slice(0, i), newCard, ...currentCards.slice(i + 1)];
      if (newHand.filter((n) => ESSENTIAL.includes(n)).length > 1) continue;
      const newPoints = calcCardPoints(newHand);
      if (newPoints > currentPoints) {
        suggestions.push({
          type: "交換",
          action: `「${oldCard}」→「${newCard}」`,
          resultHand: newHand,
          points: newPoints,
          diff: newPoints - currentPoints,
        });
      }
    }
  }

  if (currentCards.length < 5) {
    for (const newCard of allCards) {
      if (currentCards.includes(newCard)) continue;
      const newHand = [...currentCards, newCard];
      if (newHand.filter((n) => ESSENTIAL.includes(n)).length > 1) continue;
      const newPoints = calcCardPoints(newHand);
      if (newPoints > currentPoints) {
        suggestions.push({
          type: "追加",
          action: `「${newCard}」を追加`,
          resultHand: newHand,
          points: newPoints,
          diff: newPoints - currentPoints,
        });
      }
    }
  }

  suggestions.sort((a, b) => b.diff - a.diff);
  return {
    currentPoints,
    suggestions: suggestions.slice(0, limit),
  };
}

/**
 * Best cook subsets from current hand names (3–5 unique).
 * @param {string[]} handNames
 * @param {"noodles"|"classic"} ruleSet
 */
export function bestCooksFromHand(handNames, ruleSet = "noodles") {
  const unique = [...new Set(handNames)];
  const results = [];
  for (let n = 3; n <= Math.min(5, unique.length); n++) {
    for (const combo of combinations(unique, n)) {
      const essentials = combo.filter((c) => ESSENTIAL.includes(c));
      if (essentials.length !== 1) continue;
      if (new Set(combo).size !== combo.length) continue;
      results.push({ cards: combo, points: calcCardPoints(combo) });
    }
  }
  results.sort((a, b) => b.points - a.points);
  return results.slice(0, 8);
}

// silence unused import warnings in some bundlers
void PROTEIN;
void SEASONING;
void TOPPING;
