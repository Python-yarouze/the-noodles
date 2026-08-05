/**
 * Simple CPU heuristics for solo vs CPU mode.
 */

import { SPECIAL_DRAW, HAND_LIMIT, isValidPair } from "./deck.js";
import { bestCooksFromHand } from "./helper.js";

/**
 * Decide one CPU action from full game state.
 * @returns {{ type: string, payload?: object } | null}
 */
export function decideCpuAction(state) {
  if (!state || state.status !== "playing") return null;

  const cpuIndex = state.players.findIndex((p) => p.isCpu);
  if (cpuIndex < 0) return null;
  const cpu = state.players[cpuIndex];

  if (state.phase === "cook_reveal") {
    if (!(state.cookAcks || []).includes(cpu.id)) {
      return { type: "ackCookReveal", payload: {} };
    }
    return null;
  }

  if (state.phase === "taste_window" && state.pendingAction) {
    if (state.pendingAction.actorIndex === cpuIndex) return null;
    return decideTaste(cpu);
  }

  if (state.turn !== cpuIndex) return null;

  if (state.phase === "discard_draw") {
    return decideDiscardDraw(state, cpu);
  }
  if (state.phase === "cook") {
    return decideCook(state, cpu);
  }
  if (state.phase === "end_hand") {
    return decideEndHand(cpu);
  }
  return null;
}

function decideTaste(cpu) {
  const canTaste = !(cpu.hand.length === 0 && cpu.score <= 4);
  if (!canTaste) return { type: "skipTaste", payload: {} };

  let chance = 0.35;
  if (cpu.hand.length <= 1) chance = 0.12;
  else if (cpu.hand.length >= 5) chance = 0.45;
  if (cpu.score >= 40) chance *= 0.6;

  if (Math.random() < chance) return { type: "taste", payload: {} };
  return { type: "skipTaste", payload: {} };
}

function decideDiscardDraw(state, cpu) {
  const cooks = bestCooksFromHand(
    cpu.hand.map((c) => c.name),
    state.ruleSet
  );
  const best = cooks[0];
  if (best && best.points >= 10) {
    return { type: "skipDiscard", payload: {} };
  }
  if (best && best.points >= 6 && cpu.hand.length <= 4) {
    return { type: "skipDiscard", payload: {} };
  }

  if (!state.usedDiscard1) {
    const proteins = Object.keys(SPECIAL_DRAW);
    const truth = cpu.hand.find((c) => proteins.includes(c.name));
    if (truth && Math.random() < 0.7) {
      return {
        type: "declareSingle",
        payload: { cardId: truth.id, declaration: truth.name },
      };
    }
    if (cpu.hand.length > 0 && Math.random() < 0.35) {
      const card = cpu.hand[Math.floor(Math.random() * cpu.hand.length)];
      const decls = proteins;
      const declaration = decls[Math.floor(Math.random() * decls.length)];
      return {
        type: "declareSingle",
        payload: { cardId: card.id, declaration },
      };
    }
  }

  if (!state.usedDiscard2 && cpu.hand.length >= 2) {
    for (let i = 0; i < cpu.hand.length; i++) {
      for (let j = i + 1; j < cpu.hand.length; j++) {
        if (isValidPair(cpu.hand[i], cpu.hand[j])) {
          return {
            type: "declarePair",
            payload: { cardIdA: cpu.hand[i].id, cardIdB: cpu.hand[j].id },
          };
        }
      }
    }
  }

  return { type: "skipDiscard", payload: {} };
}

function decideCook(state, cpu) {
  const cooks = bestCooksFromHand(
    cpu.hand.map((c) => c.name),
    state.ruleSet
  );
  if (!cooks.length) return { type: "skipCook", payload: {} };

  const best = cooks[0];
  const shouldCook =
    best.points >= 8 || cpu.hand.length >= 5 || (best.points >= 5 && Math.random() < 0.55);
  if (!shouldCook) return { type: "skipCook", payload: {} };

  const handCopy = [...cpu.hand];
  const cardIds = [];
  for (const name of best.cards) {
    const idx = handCopy.findIndex((c) => c.name === name);
    if (idx < 0) return { type: "skipCook", payload: {} };
    cardIds.push(handCopy[idx].id);
    handCopy.splice(idx, 1);
  }
  return { type: "cook", payload: { cardIds } };
}

function decideEndHand(cpu) {
  const need = cpu.hand.length - HAND_LIMIT;
  if (need <= 0) {
    return { type: "endTurnDiscard", payload: { cardIds: [] } };
  }
  const sorted = [...cpu.hand].sort((a, b) => {
    const rank = (n) => (n === "めん" || n === "ごはん" ? 100 : 0);
    return rank(a.name) - rank(b.name);
  });
  const cardIds = sorted.slice(0, need).map((c) => c.id);
  return { type: "endTurnDiscard", payload: { cardIds } };
}
