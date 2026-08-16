/**
 * Host-authoritative game engine for THE NOODLES (2–4 players).
 */

import {
  buildDeck,
  HAND_LIMIT,
  START_HAND,
  SPECIAL_DRAW,
  TASTE_WINDOW_MS,
  WIN_SCORE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RULE_LABELS,
  clampWinScore,
  clampTasteMs,
  isValidPair,
  shuffle,
} from "./deck.js";
import { validateCookSet } from "./scoring.js";

function emptyPlayer(id, name, opts = {}) {
  return {
    id,
    name,
    hand: [],
    score: 0,
    nextTurnBonusDraw: 0,
    isCpu: !!opts.isCpu,
    awaitingReconnect: false,
  };
}

export function createEmptyState() {
  return {
    status: "waiting",
    ruleSet: "noodles",
    winScore: WIN_SCORE,
    tasteWindowMs: TASTE_WINDOW_MS,
    targetSeats: MAX_PLAYERS,
    deck: [],
    discardPile: [],
    players: [],
    turn: 0,
    phase: "draw",
    usedDiscard1: false,
    usedDiscard2: false,
    /** How many discard declares completed this turn (max 2: single + pair). */
    discardDeclareCount: 0,
    cookedThisTurn: false,
    drawFailed: false,
    pendingAction: null,
    winnerIndex: null,
    log: [],
    tasteDeadline: null,
    cookRevealDeadline: null,
    lastEvent: null,
    lastCook: null,
    cookHistory: [],
    cookAcks: [],
    pendingWin: false,
  };
}

/** Seconds to auto-advance cook reveal if not everyone acks. */
export const COOK_REVEAL_TIMEOUT_MS = 15000;

export class NoodlesGame {
  constructor() {
    this.state = createEmptyState();
    this._tasteTimer = null;
    this._cookRevealTimer = null;
    this._actionTimersPaused = false;
    this._pausedTasteRemain = null;
    this._pausedCookRemain = null;
    this.onChange = null;
  }

  _emit(event) {
    if (event) this.state.lastEvent = { ...event, at: Date.now() };
    if (this.onChange) this.onChange(this.state);
  }

  _log(msg) {
    this.state.log = [...this.state.log.slice(-40), msg];
  }

  _clearCookRevealTimer() {
    if (this._cookRevealTimer) {
      clearTimeout(this._cookRevealTimer);
      this._cookRevealTimer = null;
    }
    this.state.cookRevealDeadline = null;
  }

  _armCookRevealTimer() {
    this._clearCookRevealTimer();
    this.state.cookRevealDeadline = Date.now() + COOK_REVEAL_TIMEOUT_MS;
    this._cookRevealTimer = setTimeout(() => {
      this._cookRevealTimer = null;
      if (this.state.phase !== "cook_reveal") return;
      this._log("料理確認の時間切れ — 自動で次へ");
      this._finishCookReveal();
    }, COOK_REVEAL_TIMEOUT_MS + 30);
  }

  setRuleSet(ruleSet) {
    if (this.state.status !== "waiting") return { ok: false, reason: "開始後は変えられません" };
    if (ruleSet !== "noodles" && ruleSet !== "classic") {
      return { ok: false, reason: "不明なルールです" };
    }
    this.state.ruleSet = ruleSet;
    this._emit();
    return { ok: true };
  }

  setSettings({ winScore, tasteWindowMs } = {}) {
    if (this.state.status !== "waiting") return { ok: false, reason: "開始後は変えられません" };
    if (winScore != null) this.state.winScore = clampWinScore(winScore);
    if (tasteWindowMs != null) this.state.tasteWindowMs = clampTasteMs(tasteWindowMs);
    this._emit();
    return { ok: true };
  }

  setTargetSeats(n) {
    if (this.state.status !== "waiting") return { ok: false, reason: "開始後は変えられません" };
    const seats = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(n) || MAX_PLAYERS));
    this.state.targetSeats = seats;
    this._emit();
    return { ok: true };
  }

  _seatCap() {
    return this.state.targetSeats || MAX_PLAYERS;
  }

  addPlayer(id, name, opts = {}) {
    if (this.state.status !== "waiting") return { ok: false, reason: "すでに開始済みです" };
    const cap = this._seatCap();
    if (this.state.players.length >= cap) {
      return { ok: false, reason: `部屋が満員です（${cap}人）` };
    }
    if (this.state.players.some((p) => p.id === id)) return { ok: true };
    this.state.players.push(emptyPlayer(id, name || `Player ${this.state.players.length + 1}`, opts));
    this._log(`${name} が参加しました`);
    this._emit({ type: "join", name });
    return { ok: true };
  }

  /** Waiting room only: drop a human who disconnected. */
  removePlayer(id) {
    if (this.state.status !== "waiting") {
      return { ok: false, reason: "開始後は席を外せません" };
    }
    const idx = this.state.players.findIndex((p) => p.id === id);
    if (idx < 0) return { ok: false, reason: "見つかりません" };
    const p = this.state.players[idx];
    if (p.isCpu) return { ok: false, reason: "CPUは外せません" };
    this.state.players = this.state.players.filter((x) => x.id !== id);
    this._log(`${p.name} が退室しました`);
    this._emit({ type: "leave", name: p.name, playerId: id });
    return { ok: true, name: p.name };
  }

  /** Mid-game: let CPU play this human seat, or give the seat back. Keeps id/hand/score. */
  setCpu(playerId, isCpu) {
    const p = this.state.players.find((x) => x.id === playerId);
    if (!p) return { ok: false, reason: "見つかりません" };
    if (this.state.status === "waiting") {
      return { ok: false, reason: "開始前はCPUに切り替えません" };
    }
    const next = !!isCpu;
    if (p.isCpu === next) {
      p.awaitingReconnect = false;
      this._emit();
      return { ok: true };
    }
    p.isCpu = next;
    p.awaitingReconnect = false;
    this._log(next ? `${p.name} の席をCPUが代理します` : `${p.name} が席に戻りました`);
    this._emit();
    return { ok: true };
  }

  setAwaitingReconnect(playerId, awaiting) {
    const p = this.state.players.find((x) => x.id === playerId);
    if (!p) return { ok: false, reason: "見つかりません" };
    p.awaitingReconnect = !!awaiting;
    this._emit();
    return { ok: true };
  }

  pauseActionTimers() {
    if (this._actionTimersPaused) return;
    this._actionTimersPaused = true;
    this._pausedTasteRemain =
      this.state.tasteDeadline != null ? Math.max(0, this.state.tasteDeadline - Date.now()) : null;
    this._pausedCookRemain =
      this.state.cookRevealDeadline != null
        ? Math.max(0, this.state.cookRevealDeadline - Date.now())
        : null;
    this._clearTasteTimer();
    this._clearCookRevealTimer();
    this.state.tasteDeadline = null;
    this.state.cookRevealDeadline = null;
    this._emit();
  }

  resumeActionTimers() {
    if (!this._actionTimersPaused) return;
    this._actionTimersPaused = false;
    if (
      this.state.phase === "taste_window" &&
      this.state.tasteWindowMs &&
      this._pausedTasteRemain != null
    ) {
      this.state.tasteDeadline = Date.now() + this._pausedTasteRemain;
      this._startTasteTimer();
    }
    if (this.state.phase === "cook_reveal" && this._pausedCookRemain != null) {
      const remain = this._pausedCookRemain;
      this.state.cookRevealDeadline = Date.now() + remain;
      this._cookRevealTimer = setTimeout(() => {
        this._cookRevealTimer = null;
        if (this.state.phase !== "cook_reveal") return;
        this._log("料理確認の時間切れ — 自動で次へ");
        this._finishCookReveal();
      }, remain + 30);
    }
    this._pausedTasteRemain = null;
    this._pausedCookRemain = null;
    this._emit();
  }

  /** Fill empty target seats with CPUs before dealing. */
  fillCpuSeats() {
    if (this.state.status !== "waiting") return { ok: false };
    const cap = this._seatCap();
    let cpuIndex = 0;
    while (this.state.players.length < cap) {
      while (this.state.players.some((p) => p.id === `cpu-${cpuIndex}`)) cpuIndex += 1;
      const id = `cpu-${cpuIndex}`;
      const label = cpuIndex === 0 ? "CPU" : `CPU${cpuIndex + 1}`;
      const r = this.addPlayer(id, label, { isCpu: true });
      if (!r.ok) break;
      cpuIndex += 1;
    }
    return { ok: true };
  }

  startGame() {
    this.fillCpuSeats();
    const n = this.state.players.length;
    if (n < MIN_PLAYERS) {
      return { ok: false, reason: `${MIN_PLAYERS}人以上必要です` };
    }
    const cap = this._seatCap();
    if (n > cap) {
      return { ok: false, reason: `最大${cap}人までです` };
    }
    this._clearTasteTimer();
    this._clearCookRevealTimer();
    this._actionTimersPaused = false;
    this._pausedTasteRemain = null;
    this._pausedCookRemain = null;
    this.state.players = shuffle(this.state.players);
    this.state.deck = buildDeck(this.state.ruleSet);
    this.state.discardPile = [];
    this.state.winnerIndex = null;
    this.state.cookHistory = [];
    this.state.status = "playing";
    this.state.turn = 0;
    for (const p of this.state.players) {
      p.hand = [];
      p.score = 0;
      p.nextTurnBonusDraw = 0;
      p.awaitingReconnect = false;
    }
    for (let i = 0; i < START_HAND; i++) {
      for (const p of this.state.players) {
        this._drawTo(p, 1);
      }
    }
    const order = this.state.players.map((p) => p.name).join(" → ");
    this._log(`手番順: ${order}`);
    const label = RULE_LABELS[this.state.ruleSet] || this.state.ruleSet;
    const goal = this.state.winScore;
    const tasteLabel = this.state.tasteWindowMs
      ? `味見${Math.round(this.state.tasteWindowMs / 1000)}秒`
      : "味見制限なし";
    this._beginTurn();
    this._log(`ゲーム開始！（${label}）先に${goal}点で勝利／${tasteLabel}`);
    this._emit({ type: "game_start", ruleSet: this.state.ruleSet });
    return { ok: true };
  }

  _beginTurn() {
    this.state.usedDiscard1 = false;
    this.state.usedDiscard2 = false;
    this.state.discardDeclareCount = 0;
    this.state.cookedThisTurn = false;
    this.state.drawFailed = false;
    this.state.pendingAction = null;
    this.state.tasteDeadline = null;
    this.state.lastCook = null;
    this.state.cookAcks = [];
    this.state.pendingWin = false;
    this._clearCookRevealTimer();
    this.state.phase = "draw";
    this._autoDraw();
  }

  _current() {
    return this.state.players[this.state.turn];
  }

  _reshuffleIfNeeded() {
    if (this.state.deck.length > 0) return;
    if (this.state.discardPile.length === 0) return;
    this.state.deck = shuffle(this.state.discardPile);
    this.state.discardPile = [];
    this._log("捨て札を山札に戻してシャッフル");
  }

  _drawTo(player, n) {
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      this._reshuffleIfNeeded();
      if (this.state.deck.length === 0) break;
      player.hand.push(this.state.deck.pop());
      drawn++;
    }
    return drawn;
  }

  _autoDraw() {
    const p = this._current();
    let n = 1 + (p.nextTurnBonusDraw || 0);
    p.nextTurnBonusDraw = 0;
    const got = this._drawTo(p, n);
    if (got < 1) {
      this.state.drawFailed = true;
      this._log(`${p.name} は山札から引けませんでした`);
    } else {
      this._log(`${p.name} が ${got} 枚引きました`);
    }
    this.state.phase = "discard_draw";
    this._emit({
      type: "draw",
      playerId: p.id,
      playerName: p.name,
      playerIndex: this.state.turn,
      count: got,
      turnStart: true,
    });
  }

  _tasteOpponents() {
    const actor = this.state.pendingAction?.actorIndex;
    if (actor == null) return [];
    return this.state.players.filter((_, i) => i !== actor);
  }

  _tastePassIds() {
    return this.state.pendingAction?.tastePasses || [];
  }

  _clearTasteTimer() {
    if (this._tasteTimer) {
      clearTimeout(this._tasteTimer);
      this._tasteTimer = null;
    }
  }

  declareSingleDiscard(playerId, cardId, declaration) {
    if (!this._isMyTurn(playerId)) return { ok: false, reason: "あなたの手番ではありません" };
    if (this.state.phase !== "discard_draw") return { ok: false, reason: "今は捨てて引けません" };
    if (this.state.usedDiscard1) return { ok: false, reason: "1枚捨てはすでに使いました" };
    if (!SPECIAL_DRAW[declaration]) return { ok: false, reason: "とり／ぶた／えびを宣言してください" };

    const p = this._current();
    const card = p.hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, reason: "そのカードは手札にありません" };

    const isTruthful = card.name === declaration;
    const drawCount = SPECIAL_DRAW[declaration];

    p.hand = p.hand.filter((c) => c.id !== cardId);
    this.state.pendingAction = {
      kind: "single",
      declaration,
      cards: [card],
      drawCount,
      isTruthful,
      actorIndex: this.state.turn,
      tastePasses: [],
    };
    this.state.usedDiscard1 = true;
    this.state.discardDeclareCount = (this.state.discardDeclareCount || 0) + 1;
    this.state.phase = "taste_window";
    this._armTasteWindow();
    this._log(`${p.name} が「${declaration}」を宣言して1枚伏せました`);
    this._emit({
      type: "discard_declare",
      kind: "single",
      declaration,
      actorIndex: this.state.turn,
      actorName: p.name,
      drawCount,
    });
    return { ok: true };
  }

  declarePairDiscard(playerId, cardIdA, cardIdB) {
    if (!this._isMyTurn(playerId)) return { ok: false, reason: "あなたの手番ではありません" };
    if (this.state.phase !== "discard_draw") return { ok: false, reason: "今は捨てて引けません" };
    if (this.state.usedDiscard2) return { ok: false, reason: "2枚捨てはすでに使いました" };
    if (cardIdA === cardIdB) return { ok: false, reason: "別々のカードを選んでください" };

    const p = this._current();
    const a = p.hand.find((c) => c.id === cardIdA);
    const b = p.hand.find((c) => c.id === cardIdB);
    if (!a || !b) return { ok: false, reason: "そのカードは手札にありません" };

    const isTruthful = isValidPair(a, b);
    p.hand = p.hand.filter((c) => c.id !== cardIdA && c.id !== cardIdB);
    this.state.pendingAction = {
      kind: "pair",
      declaration: "ペア",
      cards: [a, b],
      drawCount: 3,
      isTruthful,
      actorIndex: this.state.turn,
      tastePasses: [],
    };
    this.state.usedDiscard2 = true;
    this.state.discardDeclareCount = (this.state.discardDeclareCount || 0) + 1;
    this.state.phase = "taste_window";
    this._armTasteWindow();
    this._log(`${p.name} がペア（2枚）を宣言して伏せました`);
    this._emit({
      type: "discard_declare",
      kind: "pair",
      actorIndex: this.state.turn,
      actorName: p.name,
      drawCount: 3,
    });
    return { ok: true };
  }

  /** 0 ms = unlimited (no deadline / no auto-resolve). */
  _armTasteWindow() {
    this._clearTasteTimer();
    if (!this.state.tasteWindowMs) {
      this.state.tasteDeadline = null;
      return;
    }
    this.state.tasteDeadline = Date.now() + this.state.tasteWindowMs;
    this._startTasteTimer();
  }

  _startTasteTimer() {
    this._clearTasteTimer();
    if (!this.state.tasteDeadline) return;
    const ms = Math.max(0, this.state.tasteDeadline - Date.now());
    this._tasteTimer = setTimeout(() => {
      this._resolvePending();
      this._emit({ type: "taste_timeout" });
    }, ms + 30);
  }

  taste(playerId) {
    if (this.state.phase !== "taste_window" || !this.state.pendingAction) {
      return { ok: false, reason: "今は味見できません" };
    }
    const tasterIndex = this.state.players.findIndex((p) => p.id === playerId);
    if (tasterIndex < 0) return { ok: false, reason: "参加者ではありません" };
    if (tasterIndex === this.state.pendingAction.actorIndex) {
      return { ok: false, reason: "自分の宣言には味見できません" };
    }
    if (this._tastePassIds().includes(playerId)) {
      return { ok: false, reason: "パス済みのため味見できません" };
    }

    const taster = this.state.players[tasterIndex];
    if (taster.hand.length === 0 && taster.score <= 4) {
      return { ok: false, reason: "手札0かつ4点以下では味見できません" };
    }

    this._clearTasteTimer();
    const pending = this.state.pendingAction;
    const actor = this.state.players[pending.actorIndex];

    if (pending.isTruthful) {
      const hadCards = taster.hand.length > 0;
      let penaltyNote = "";
      if (!hadCards) {
        taster.score -= 5;
        penaltyNote = "−5点";
        this._log(`${taster.name} の味見失敗！ 手札なしのため −5点`);
      } else {
        this.state.discardPile.push(...taster.hand);
        taster.hand = [];
        penaltyNote = "手札没収";
        this._log(`${taster.name} の味見失敗！ 手札をすべて捨てました`);
      }
      this._completePendingDraw(actor, pending);
      const won = this._checkWin();
      if (!won) {
        this._emit({
          type: "taste_fail",
          tasterId: playerId,
          tasterName: taster.name,
          tasterIndex,
          actorName: actor.name,
          actorIndex: pending.actorIndex,
          penaltyNote,
        });
      }
    } else {
      this.state.discardPile.push(...pending.cards);
      const drawCount = pending.drawCount;
      let rewardDraw = 0;
      let rewardKind = "bonus";
      if (this.state.ruleSet === "noodles") {
        rewardDraw = this._drawTo(taster, drawCount);
        rewardKind = "instant";
        this._log(
          `${taster.name} の味見成功！（本当は ${pending.cards.map((c) => c.name).join("・")}）→ ${rewardDraw}枚獲得`
        );
      } else {
        taster.nextTurnBonusDraw += 1;
        rewardDraw = 1;
        rewardKind = "next_turn";
        this._log(
          `${taster.name} の味見成功！（本当は ${pending.cards.map((c) => c.name).join("・")}）→ 次ターン+1ドロー`
        );
      }
      this.state.pendingAction = null;
      this.state.tasteDeadline = null;
      this._enterCookOrDiscardDraw(actor);
      this._emit({
        type: "taste_success",
        tasterId: playerId,
        tasterName: taster.name,
        tasterIndex,
        actorName: actor.name,
        actorIndex: pending.actorIndex,
        real: pending.cards.map((c) => c.name),
        rewardDraw,
        rewardKind,
        ruleSet: this.state.ruleSet,
      });
    }
    return { ok: true };
  }

  /** Pass on tasting (per player). Resolves only when all non-actors have passed. */
  skipTaste(playerId) {
    if (this.state.phase !== "taste_window" || !this.state.pendingAction) {
      return { ok: false, reason: "今はスキップできません" };
    }
    const idx = this.state.players.findIndex((p) => p.id === playerId);
    if (idx < 0) return { ok: false, reason: "参加者ではありません" };
    if (idx === this.state.pendingAction.actorIndex) {
      return { ok: false, reason: "伏せた本人はスキップできません（相手の判断を待っています）" };
    }
    const passes = this._tastePassIds();
    if (passes.includes(playerId)) {
      return { ok: false, reason: "すでにパスしています" };
    }
    this.state.pendingAction.tastePasses = [...passes, playerId];
    const skipper = this.state.players[idx];
    const need = this._tasteOpponents().length;
    const passCount = this.state.pendingAction.tastePasses.length;
    this._log(`${skipper.name} は味見をパス（${passCount}/${need}）`);

    if (passCount >= need) {
      this._resolvePending();
      this._emit({
        type: "taste_all_passed",
        playerId,
        tasterName: skipper?.name,
        tasterIndex: idx,
        passCount,
        need,
      });
    } else {
      this._emit({
        type: "taste_skip",
        playerId,
        tasterName: skipper?.name,
        tasterIndex: idx,
        passCount,
        need,
      });
    }
    return { ok: true };
  }

  _resolvePending() {
    if (this.state.phase !== "taste_window" || !this.state.pendingAction) return;
    this._clearTasteTimer();
    const pending = this.state.pendingAction;
    const actor = this.state.players[pending.actorIndex];
    this._completePendingDraw(actor, pending);
  }

  _completePendingDraw(actor, pending) {
    this.state.discardPile.push(...pending.cards);
    const got = this._drawTo(actor, pending.drawCount);
    this._log(`${actor.name} が ${got} 枚引きました（宣言: ${pending.declaration}）`);
    this.state.pendingAction = null;
    this.state.tasteDeadline = null;
    this._enterCookOrDiscardDraw(actor);
  }

  /** After a discard resolves (or is busted), continue discard phase or auto-advance to cook. */
  _enterCookOrDiscardDraw(actor) {
    const exhausted =
      (this.state.discardDeclareCount || 0) >= 2 ||
      (this.state.usedDiscard1 && this.state.usedDiscard2);
    if (exhausted) {
      this.state.phase = "cook";
      this._log(`${actor.name} は捨てて引くを2回行ったので料理へ`);
      this._emit({ type: "phase_cook", playerName: actor.name, playerIndex: this.state.turn });
    } else {
      this.state.phase = "discard_draw";
      this._emit({
        type: "discard_resume",
        playerName: actor?.name,
        playerIndex: this.state.turn,
        usedDiscard1: this.state.usedDiscard1,
        usedDiscard2: this.state.usedDiscard2,
        discardDeclareCount: this.state.discardDeclareCount || 0,
      });
    }
  }

  skipDiscardPhase(playerId) {
    if (!this._isMyTurn(playerId)) return { ok: false, reason: "あなたの手番ではありません" };
    if (this.state.phase !== "discard_draw") return { ok: false, reason: "フェーズが違います" };
    const p = this._current();
    this.state.phase = "cook";
    this._log(`${p.name} は捨てて引くを終えました`);
    this._emit({ type: "phase_cook", playerName: p.name, playerIndex: this.state.turn });
    return { ok: true };
  }

  cook(playerId, cardIds) {
    if (!this._isMyTurn(playerId)) return { ok: false, reason: "あなたの手番ではありません" };
    if (this.state.phase !== "cook") {
      return { ok: false, reason: "今は料理できません" };
    }
    if (this.state.cookedThisTurn) return { ok: false, reason: "このターンはすでに料理しました" };

    const p = this._current();
    const cards = cardIds.map((id) => p.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) return { ok: false, reason: "手札にないカードがあります" };

    const names = cards.map((c) => c.name);
    const v = validateCookSet(names, this.state.ruleSet);
    if (!v.ok) return v;

    const idSet = new Set(cardIds);
    p.hand = p.hand.filter((c) => !idSet.has(c.id));
    this.state.discardPile.push(...cards);
    p.score += v.points;
    this.state.cookedThisTurn = true;
    this._log(`${p.name} が料理！ +${v.points}点（合計 ${p.score}）← ${names.join("・")}`);

    if (!this.state.drawFailed) {
      const got = this._drawTo(p, 1);
      if (got) this._log(`${p.name} が料理後に1枚引きました`);
    }

    const won = p.score >= this.state.winScore;
    const entry = {
      index: this.state.cookHistory.length + 1,
      playerId: p.id,
      playerName: p.name,
      names,
      points: v.points,
      score: p.score,
      won,
    };
    this.state.cookHistory = [...this.state.cookHistory, entry];
    this.state.lastCook = entry;
    this.state.cookAcks = [];
    this.state.pendingWin = won;
    this.state.phase = "cook_reveal";
    this._armCookRevealTimer();

    this._emit({
      type: won ? "cook_win" : "cook",
      playerId: p.id,
      playerName: p.name,
      names,
      points: v.points,
      score: p.score,
    });
    return { ok: true, points: v.points };
  }

  /** All players must acknowledge the cooked dish before turn continues. */
  ackCookReveal(playerId) {
    if (this.state.phase !== "cook_reveal") {
      return { ok: false, reason: "いまは料理確認中ではありません" };
    }
    if (!this.state.players.some((p) => p.id === playerId)) {
      return { ok: false, reason: "参加者ではありません" };
    }
    if (!this.state.cookAcks.includes(playerId)) {
      this.state.cookAcks = [...this.state.cookAcks, playerId];
    }
    const who = this.state.players.find((p) => p.id === playerId);
    this._emit({
      type: "cook_ack",
      playerId,
      playerName: who?.name,
      count: this.state.cookAcks.length,
      need: this.state.players.length,
    });

    if (this.state.cookAcks.length >= this.state.players.length) {
      this._finishCookReveal();
    }
    return { ok: true };
  }

  _finishCookReveal() {
    this._clearCookRevealTimer();
    const won = this.state.pendingWin;
    this.state.cookAcks = [];
    this.state.pendingWin = false;
    const dish = this.state.lastCook;

    if (won) {
      const idx = this.state.players.findIndex((p) => p.id === dish?.playerId);
      this.state.status = "finished";
      this.state.winnerIndex = idx >= 0 ? idx : this.state.turn;
      this.state.phase = "finished";
      this._clearTasteTimer();
      const winner = this.state.players[this.state.winnerIndex];
      this._log(`${winner?.name || "?"} の勝利！`);
      this._emit({
        type: "game_over",
        winnerIndex: this.state.winnerIndex,
        winnerName: winner?.name,
      });
      return;
    }

    this.state.lastCook = null;
    this.state.phase = "end_hand";
    const p = this._current();
    if (p.hand.length <= HAND_LIMIT) {
      this._emit({ type: "cook_reveal_done", next: "turn_end" });
      this._endTurn();
    } else {
      this._emit({ type: "cook_reveal_done", next: "end_hand", playerName: p.name });
    }
  }

  skipCook(playerId) {
    if (!this._isMyTurn(playerId)) return { ok: false, reason: "あなたの手番ではありません" };
    if (this.state.phase !== "cook") return { ok: false, reason: "今は料理フェーズではありません" };
    const p = this._current();
    this.state.phase = "end_hand";
    this._log(`${p.name} は料理しませんでした`);
    this._emit({ type: "skip_cook", playerName: p.name, playerIndex: this.state.turn });
    this._maybeAutoEndHand();
    return { ok: true };
  }

  _maybeAutoEndHand() {
    const p = this._current();
    if (p.hand.length <= HAND_LIMIT) {
      this._endTurn();
    }
  }

  endTurnDiscard(playerId, cardIds) {
    if (!this._isMyTurn(playerId)) return { ok: false, reason: "あなたの手番ではありません" };
    if (this.state.phase !== "end_hand") return { ok: false, reason: "手札調整のタイミングではありません" };

    const p = this._current();
    const need = p.hand.length - HAND_LIMIT;
    if (need <= 0) {
      this._endTurn();
      return { ok: true };
    }
    if (!cardIds || cardIds.length !== need) {
      return { ok: false, reason: `${need} 枚捨てて手札を3枚にしてください` };
    }

    const cards = cardIds.map((id) => p.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) return { ok: false, reason: "手札にないカードがあります" };
    const idSet = new Set(cardIds);
    p.hand = p.hand.filter((c) => !idSet.has(c.id));
    this.state.discardPile.push(...cards);
    this._log(`${p.name} が手札を3枚に整えました`);
    this._emit({ type: "end_hand", playerName: p.name, discarded: need });
    this._endTurn();
    return { ok: true };
  }

  _endTurn() {
    if (this.state.status === "finished") return;
    const n = this.state.players.length;
    this.state.turn = (this.state.turn + 1) % n;
    this._beginTurn();
  }

  _checkWin() {
    for (let i = 0; i < this.state.players.length; i++) {
      if (this.state.players[i].score >= this.state.winScore) {
        this.state.status = "finished";
        this.state.winnerIndex = i;
        this.state.phase = "finished";
        this._clearTasteTimer();
        this._log(`${this.state.players[i].name} の勝利！`);
        this._emit({
          type: "game_over",
          winnerIndex: i,
          winnerName: this.state.players[i].name,
        });
        return true;
      }
    }
    return false;
  }

  _isMyTurn(playerId) {
    const p = this._current();
    return p && p.id === playerId && this.state.status === "playing";
  }

  getState() {
    return this.state;
  }

  viewFor(playerId) {
    const s = this.state;
    const myIndex = s.players.findIndex((p) => p.id === playerId);
    return {
      status: s.status,
      ruleSet: s.ruleSet,
      winScore: s.winScore,
      tasteWindowMs: s.tasteWindowMs,
      targetSeats: s.targetSeats || MAX_PLAYERS,
      turn: s.turn,
      phase: s.phase,
      usedDiscard1: s.usedDiscard1,
      usedDiscard2: s.usedDiscard2,
      discardDeclareCount: s.discardDeclareCount || 0,
      cookedThisTurn: s.cookedThisTurn,
      tasteDeadline: s.tasteDeadline,
      cookRevealDeadline: s.cookRevealDeadline,
      winnerIndex: s.winnerIndex,
      deckCount: s.deck.length,
      discardCount: s.discardPile.length,
      log: s.log,
      myIndex,
      lastEvent: s.lastEvent,
      lastCook: s.lastCook,
      cookHistory: s.cookHistory || [],
      cookAcks: s.cookAcks || [],
      pendingPublic: s.pendingAction
        ? {
            kind: s.pendingAction.kind,
            declaration: s.pendingAction.declaration,
            cardCount: s.pendingAction.cards.length,
            actorIndex: s.pendingAction.actorIndex,
            drawCount: s.pendingAction.drawCount,
            tastePasses: s.pendingAction.tastePasses || [],
            tastePassNeed: s.players.length - 1,
          }
        : null,
      players: s.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        handCount: p.hand.length,
        hand: i === myIndex ? p.hand : null,
        nextTurnBonusDraw: p.nextTurnBonusDraw,
        isCpu: !!p.isCpu,
        awaitingReconnect: !!p.awaitingReconnect,
      })),
    };
  }
}
