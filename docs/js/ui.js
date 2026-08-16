/**
 * Playful table UI — select-then-act, turn banner, 2–4 players, previews.
 */

import { cardImagePath, WIN_SCORE, RULE_LABELS, categoryOf, RULES_IMAGE } from "./deck.js";
import { explainScore, validateCookSet } from "./scoring.js";
import { getCardEffect, effectsByCategory } from "./card-effects.js";
import { FxLayer, showAppToast } from "./fx.js";
import { suggestImprovements, topCombinations, bestCooksFromHand } from "./helper.js";

const SEAT_COLORS = ["#c44b2f", "#2a7a6a", "#c9a227", "#5c6bc0"];
const RULES_IMG = RULES_IMAGE;

const LOCKED_UI_ACTS = new Set([
  "startGame",
  "rematch",
  "taste",
  "skipTaste",
  "ackCookReveal",
  "confirm-single",
  "confirm-pair",
  "confirm-cook",
  "confirm-end",
  "skip-discard",
  "skip-all-cook",
  "skip-cook",
]);

const PHASE_JP = {
  draw: "ドロー",
  discard_draw: "捨てて引く",
  cook: "料理",
  cook_reveal: "料理の確認",
  end_hand: "手札調整",
  taste_window: "味見待ち",
  finished: "終了",
};

export class GameUI {
  constructor(root, handlers) {
    this.root = root;
    this.onAction = handlers.onAction;
    this.selected = new Set();
    this.lastView = null;
    this._lastMeta = {};
    this.detailName = null;
    this.showReference = false;
    this.showRules = false;
    this.fx = new FxLayer(root);
    this._lastPhase = null;
    this.showHelper = false;
    this.showLog = false;
    this.helperTab = "cooks";
    this.refTab = null;
    this._handScrollLeft = 0;
  }

  render(view, meta = {}) {
    this.lastView = view;
    this._lastMeta = meta;
    const {
      connectionStatus = "",
      role = "",
      roomId = "",
      canStart = false,
      actionsLocked = false,
      canReconnect = false,
      disconnectKind = "",
    } = meta;
    const lock = actionsLocked ? "disabled" : "";

    document.body.classList.toggle("match-playing", view?.status === "playing");
    document.body.classList.toggle("match-finished", view?.status === "finished");
    document.body.classList.toggle("match-waiting", !view || view.status === "waiting");

    if (view?.phase && view.phase !== this._lastPhase) {
      this.selected.clear();
      this._handScrollLeft = 0;
      this._lastPhase = view.phase;
    } else {
      const prevHand = this.root.querySelector(".card-row.hand");
      if (prevHand) this._handScrollLeft = prevHand.scrollLeft;
    }

    if (!view || view.status === "waiting") {
      const goal = view?.winScore ?? WIN_SCORE;
      const tasteMs = view?.tasteWindowMs ?? 15000;
      const tasteLabel = tasteMs ? `味見 ${Math.round(tasteMs / 1000)}秒` : "味見 制限なし";
      const target = view?.targetSeats ?? meta.targetSeats ?? 4;
      const have = (view?.players || []).length;
      document.body.style.removeProperty("--turn-seat");
      const showDisconnect = disconnectKind === "guest-drop" || disconnectKind === "host-ended";
      this.root.innerHTML = `
        <div class="panel waiting wait-panel">
          ${
            showDisconnect
              ? this._disconnectBanner(connectionStatus, { role, canReconnect, disconnectKind })
              : `<p class="status-line">${escapeHtml(connectionStatus || "参加者を待っています…")}</p>`
          }
          ${roomId ? this._roomCodeBlock(roomId, { canShare: typeof navigator !== "undefined" && typeof navigator.share === "function" }) : ""}
          ${
            role === "host"
              ? `<p class="host-room-note">このタブを閉じると部屋は終わります</p>
          <p class="host-room-note">コードをSNSに貼るときは、貼ったらすぐこの画面に戻ってください（裏に回しているあいだ、相手は入れません）</p>`
              : ""
          }
          <div class="wait-players">
            ${(view?.players || [])
              .map(
                (p, i) =>
                  `<span class="wait-chip" style="--seat:${SEAT_COLORS[i % 4]}">${escapeHtml(p.name)}</span>`
              )
              .join("")}
          </div>
          <p class="mode-badge">${escapeHtml(RULE_LABELS[view?.ruleSet] || "")}</p>
          <p class="hint">目標 ${goal}点 ／ ${tasteLabel}</p>
          <p class="hint">人数 ${have}/${target}（不足分は開始時にCPU）</p>
          <div class="wait-actions">
            ${
              canStart
                ? `<button type="button" class="btn primary big wait-start" data-act="startGame" ${lock}>はじめる</button>`
                : `<p class="hint wait-start-hint">ホストが「はじめる」を押すと開始します</p>`
            }
            <div class="wait-guides">
              <button type="button" class="btn ghost" data-act="open-rules">ルール</button>
              <button type="button" class="btn ghost" data-act="open-ref">効果表</button>
            </div>
            <button type="button" class="btn ghost wait-home" data-act="lobby">ホームへ</button>
          </div>
        </div>
        ${this._overlaysHtml(view)}`;
      this._bindAll();
      if (view?.lastEvent) this.fx.play(view.lastEvent);
      return;
    }

    if (view.status === "finished") {
      const winner = view.players[view.winnerIndex];
      const goal = view.winScore ?? WIN_SCORE;
      const canRematch = role === "host" || role === "solo";
      document.body.style.removeProperty("--turn-seat");
      this.root.innerHTML = `
        <div class="panel finished result-panel">
          ${this._disconnectBanner(connectionStatus, { role, canReconnect, disconnectKind })}
          <h2>${escapeHtml(winner?.name || "？")} の勝利</h2>
          <p class="result-sub">${goal}点先取</p>
          ${this._resultScoreboard(view)}
          ${this._cookHistoryHtml(view)}
          <div class="result-actions">
            ${
              canRematch
                ? `<button type="button" class="btn primary" data-act="rematch" ${lock}>もう一度プレイ</button>`
                : `<p class="hint">ホストが再戦できます</p>`
            }
            <button type="button" class="btn ${canRematch ? "ghost" : "primary"}" data-act="lobby">ホームへ</button>
          </div>
        </div>
        ${this._overlaysHtml(view)}`;
      this._bindAll();
      if (view?.lastEvent) this.fx.play(view.lastEvent);
      return;
    }

    const me = view.myIndex >= 0 ? view.players[view.myIndex] : null;
    const myTurn = view.turn === view.myIndex;
    const turnColor = SEAT_COLORS[view.turn % 4];
    document.body.style.removeProperty("--turn-seat");
    const tasteOpen =
      view.phase === "taste_window" &&
      view.pendingPublic &&
      view.pendingPublic.actorIndex !== view.myIndex;
    const myId = view.players[view.myIndex]?.id;
    const tastePassed =
      tasteOpen && (view.pendingPublic.tastePasses || []).includes(myId);
    const passCount = view.pendingPublic?.tastePasses?.length || 0;
    const passNeed = view.pendingPublic?.tastePassNeed || Math.max(0, view.players.length - 1);

    // Auto-select mode for cook/end: selection always on in those phases
    const selectable =
      myTurn &&
      (view.phase === "discard_draw" || view.phase === "cook" || view.phase === "end_hand");

    // Patch cook reveal in place so CPU ack refreshes don't remount / flicker.
    if (this._patchCookReveal(view, { lock })) {
      if (view?.lastEvent) this.fx.play(view.lastEvent);
      return;
    }

    this.root.innerHTML = `
      <div class="table-shell table-playing play-stage" style="--turn-seat:${turnColor}">
        ${this._disconnectBanner(connectionStatus, { role, canReconnect, disconnectKind })}
        ${this._reconnectWaitBanner(view, meta)}
        ${this._turnBanner(view, myTurn, role, roomId)}

        <section class="seat-row" aria-label="プレイヤー">
          ${view.players
            .map((p, i) => this._seatChipHtml(p, i, view.turn === i, i === view.myIndex))
            .join("")}
          <div class="goal-chip">目標 <strong>${view.winScore ?? WIN_SCORE}</strong></div>
        </section>

        <section class="field-mat center-zone" aria-label="場">
          <aside class="field-rail field-rail--tools" aria-label="ツール">
            ${this._toolButtonsHtml()}
          </aside>

          <div class="field-mat-meta ${
            view.phase === "cook_reveal" && view.lastCook
              ? "is-reveal"
              : view.pendingPublic || tasteOpen || (view.phase === "taste_window" && myTurn)
                ? "is-busy"
                : view.phase === "cook" && myTurn
                  ? "is-cook"
                  : "is-status"
          }">
            ${this._fieldMetaHtml(view, {
              tasteOpen,
              tastePassed,
              passCount,
              passNeed,
              lock,
              myTurn,
              selectable,
              me,
            })}
          </div>

          <aside class="field-rail field-rail--piles" aria-label="山札と捨て札">
            <div class="piles piles--rail">
              <div class="pile pile-deck">
                <div class="pile-stack" aria-hidden="true">
                  <span class="pile-layer" style="--i:0"></span>
                  <span class="pile-layer" style="--i:1"></span>
                  <span class="pile-layer" style="--i:2"></span>
                </div>
                <div class="pile-label">山札<strong>${view.deckCount}</strong></div>
              </div>
              <div class="pile pile-discard">
                <div class="pile-stack pile-stack--face" aria-hidden="true">
                  <span class="pile-layer is-face" style="--i:0"></span>
                  <span class="pile-layer is-face" style="--i:1"></span>
                </div>
                <div class="pile-label">捨て札<strong>${view.discardCount}</strong></div>
              </div>
            </div>
          </aside>
        </section>

        <div class="hand-dock">
          <section class="hand-stage hand-zone">
            <div class="hand-zone-head">
              <div class="hand-stage-title">
                <h3>てふだ</h3>
                <span class="hand-count">${me?.hand?.length || 0}</span>
                ${
                  me
                    ? `<span class="hand-my-score" style="--seat:${SEAT_COLORS[view.myIndex % 4]}">${me.score}<small>点</small></span>`
                    : ""
                }
              </div>
              <p class="hand-hint">${handHint(view, myTurn, selectable)}</p>
            </div>
            <div class="card-row hand">
              ${(me?.hand || []).map((c) => this._handCardHtml(c)).join("")}
            </div>
          </section>

          <section class="actions play-dock">
            ${this._actionControls(view, myTurn)}
          </section>
        </div>
      </div>
      ${this._overlaysHtml(view)}
    `;

    this._bindAll();
    this._restoreHandScroll();
    this._tickTimer();
    if (view?.lastEvent) this.fx.play(view.lastEvent);
  }

  _toolButtonsHtml() {
    return `
      <button type="button" class="btn ghost btn-tool" data-act="open-helper">お助け</button>
      <button type="button" class="btn ghost btn-tool" data-act="open-rules">ルール</button>
      <button type="button" class="btn ghost btn-tool" data-act="open-ref">効果表</button>
      <button type="button" class="btn ghost btn-tool" data-act="open-log">ログ</button>`;
  }

  /** Update reveal ack UI without remounting the fan (avoids flash on CPU acks). */
  _patchCookReveal(view, opts = {}) {
    if (view?.status !== "playing" || view.phase !== "cook_reveal" || !view.lastCook) return false;
    const waits = this._lastMeta?.disconnectWaits || view?.disconnectWaits || [];
    if (waits.length || this._lastMeta?.disconnectKind) return false;
    const el = this.root.querySelector(".cook-reveal");
    if (!el) return false;

    const ackCount = (view.cookAcks || []).length;
    const need = view.players.length;
    const ackHint = el.querySelector(".cook-reveal-ack");
    if (ackHint) ackHint.textContent = `全員が確認すると続きます（${ackCount}/${need}）`;

    const myId = view.players[view.myIndex]?.id;
    const acked = (view.cookAcks || []).includes(myId);
    const action = el.querySelector(".cook-reveal-action");
    if (action && action.dataset.acked !== String(!!acked)) {
      action.dataset.acked = String(!!acked);
      const lock = opts.lock || "";
      action.innerHTML = acked
        ? `<p class="hint cook-reveal-acked">確認済み — 他の人を待っています</p>`
        : `<button type="button" class="btn primary big" data-act="ackCookReveal" ${lock}>確認して次へ</button>`;
      action.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this._handleAct(btn.getAttribute("data-act"), btn);
        });
      });
    }

    this.root.querySelectorAll(".seat-chip").forEach((chip, i) => {
      const p = view.players[i];
      if (!p) return;
      const score = chip.querySelector(".seat-chip-score strong");
      const hand = chip.querySelector(".seat-chip-hand");
      if (score) score.textContent = String(p.score);
      if (hand) hand.textContent = `×${p.handCount ?? p.hand?.length ?? 0}`;
      chip.classList.toggle("is-turn", view.turn === i);
      chip.classList.toggle("is-me", i === view.myIndex);
    });

    const handCount = this.root.querySelector(".hand-count");
    const me = view.players[view.myIndex];
    if (handCount && me) handCount.textContent = String(me.hand?.length || 0);
    const myScore = this.root.querySelector(".hand-my-score");
    if (myScore && me) {
      myScore.innerHTML = `${me.score}<small>点</small>`;
    }

    return true;
  }

  _fieldMetaHtml(view, opts) {
    const { tasteOpen, tastePassed, passCount, passNeed, lock, myTurn, selectable, me } = opts;
    if (view.phase === "cook_reveal" && view.lastCook) {
      return this._cookRevealHtml(view);
    }
    if (view.pendingPublic) {
      return `
        <div class="pending pop">
          <span class="pending-decl">
            伏せ札：<strong>${escapeHtml(view.pendingPublic.declaration)}</strong>
            （${view.pendingPublic.cardCount}枚 → ${view.pendingPublic.drawCount}枚）
          </span>
          ${view.tasteDeadline ? `<span class="timer" data-deadline="${view.tasteDeadline}"></span>` : ""}
        </div>
        ${
          tasteOpen
            ? tastePassed
              ? `<p class="hint big-hint">パス済み — 他の人の判断待ち（${passCount}/${passNeed}）</p>`
              : `<div class="taste-actions">
                  <button type="button" class="btn danger big taste-btn" data-act="taste" ${lock}>味見する</button>
                  <button type="button" class="btn ghost" data-act="skipTaste" ${lock}>パス（味見しない）</button>
                  <p class="hint">早いもの勝ち ／ パス ${passCount}/${passNeed}</p>
                </div>`
            : view.phase === "taste_window" && myTurn
              ? `<p class="hint big-hint">相手の味見待ち…（パス ${passCount}/${passNeed}）</p>`
              : ""
        }`;
    }
    if (view.phase === "cook" && myTurn) {
      return `
        <div class="field-status">
          <p class="field-status-phase">料理</p>
          <p class="field-status-msg">${handHint(view, myTurn, selectable)}</p>
        </div>
        ${this._cookPreviewHtml(me, view.ruleSet)}`;
    }
    return this._fieldStatusHtml(view, myTurn, selectable);
  }

  _fieldStatusHtml(view, myTurn, selectable) {
    const phase = PHASE_JP[view.phase] || view.phase;
    const cur = view.players[view.turn];
    const ev = view.lastEvent;
    let eventLine = "";
    if (ev?.type === "draw" && ev.turnStart) {
      eventLine = `${escapeHtml(ev.playerName || cur?.name || "")} のばん`;
      if (ev.count > 0) eventLine += ` — ${ev.count}枚ドロー`;
    } else if (ev?.type === "discard_declare") {
      eventLine =
        ev.kind === "pair"
          ? `${escapeHtml(ev.actorName || "")} がペアで伏せた`
          : `${escapeHtml(ev.actorName || "")}「${escapeHtml(ev.declaration || "")}」と宣言`;
    } else if (ev?.type === "phase_cook") {
      eventLine = `${escapeHtml(ev.playerName || "")} の料理フェーズ`;
    } else if (ev?.type === "discard_resume") {
      eventLine = "捨てて引くを続行";
    } else if (ev?.type === "skip_cook") {
      eventLine = `${escapeHtml(ev.playerName || "相手")} は料理しなかった`;
    } else if (ev?.type === "taste_all_passed" || ev?.type === "taste_timeout") {
      eventLine = ev.type === "taste_timeout" ? "時間切れ — 味見なしで続行" : "全員パス — 続行";
    } else if (ev?.type === "end_hand") {
      eventLine = `${escapeHtml(ev.playerName || "")} が手札を整えた`;
    }

    const msg = myTurn
      ? handHint(view, myTurn, selectable) || "手札を選んで操作しよう"
      : `${escapeHtml(cur?.name || "相手")} の手番です`;

    const limits = [];
    if (view.phase === "discard_draw" && myTurn) {
      if (view.usedDiscard1) limits.push("1枚捨て使用済み");
      if (view.usedDiscard2) limits.push("2枚捨て使用済み");
    }

    return `
      <div class="field-status">
        <p class="field-status-phase">${escapeHtml(phase)}</p>
        ${eventLine ? `<p class="field-status-event">${eventLine}</p>` : ""}
        <p class="field-status-msg">${msg}</p>
        ${
          limits.length
            ? `<p class="field-status-limits">${limits.map(escapeHtml).join(" ／ ")}</p>`
            : ""
        }
      </div>`;
  }

  _seatChipHtml(player, index, isTurn, isMe) {
    const handCount = player.handCount ?? player.hand?.length ?? 0;
    return `
      <div class="seat-chip ${isTurn ? "is-turn" : ""} ${isMe ? "is-me" : ""}" style="--seat:${SEAT_COLORS[index % 4]}">
        <span class="seat-chip-name">
          ${escapeHtml(player.name)}
          ${player.isCpu ? `<small>CPU</small>` : ""}
          ${player.awaitingReconnect ? `<small>切断</small>` : ""}
          ${isMe ? `<small>あなた</small>` : ""}
        </span>
        <span class="seat-chip-score"><strong>${player.score}</strong></span>
        <span class="seat-chip-hand">×${handCount}</span>
      </div>`;
  }

  _cookRevealHtml(view) {
    const dish = view.lastCook;
    const acked = (view.cookAcks || []).includes(view.players[view.myIndex]?.id);
    const ackCount = (view.cookAcks || []).length;
    const need = view.players.length;
    return `
      <div class="cook-reveal ${dish.won ? "is-win" : ""}">
        <p class="cook-reveal-label">完成した料理</p>
        <h3 class="cook-reveal-chef">${escapeHtml(dish.playerName)} の一品</h3>
        <div class="cook-reveal-cards">
          ${(dish.names || [])
            .map(
              (n, i, arr) =>
                `<button type="button" class="cook-reveal-card" style="--i:${i};--n:${arr.length}" aria-label="${escapeHtml(n)}"><img src="${cardImagePath(n)}" alt="${escapeHtml(n)}" /></button>`
            )
            .join("")}
        </div>
        <p class="cook-reveal-points">+${dish.points} 点 <small>（合計 ${dish.score}）</small></p>
        ${dish.won ? `<p class="cook-reveal-win">勝利条件達成！</p>` : ""}
        <p class="hint cook-reveal-ack">全員が確認すると続きます（${ackCount}/${need}）</p>
        ${
          view.cookRevealDeadline
            ? `<p class="hint cook-reveal-auto">自動で進みます（<span class="timer" data-deadline="${view.cookRevealDeadline}"></span>）</p>`
            : ""
        }
        <div class="cook-reveal-action">
        ${
          acked
            ? `<p class="hint cook-reveal-acked">確認済み — 他の人を待っています</p>`
            : `<button type="button" class="btn primary big" data-act="ackCookReveal" ${
                this._lastMeta?.actionsLocked ? "disabled" : ""
              }>確認して次へ</button>`
        }
        </div>
      </div>`;
  }

  _roomCodeBlock(roomId, { canShare = false } = {}) {
    return `
      <div class="room-code-row">
        <p class="room-code">${escapeHtml(roomId)}</p>
        <div class="room-code-actions">
          <button type="button" class="btn ghost room-copy-btn" data-act="copy-room">コピー</button>
          ${canShare ? `<button type="button" class="btn ghost room-copy-btn" data-act="share-room">共有</button>` : ""}
        </div>
      </div>`;
  }

  _reconnectWaitBanner(view, meta = {}) {
    const waits = meta.disconnectWaits || view?.disconnectWaits || [];
    if (!waits.length) return "";
    const isHost = meta.role === "host";
    return waits
      .map((w) => {
        const name = escapeHtml(w.name || "ゲスト");
        const pid = escapeHtml(w.playerId || "");
        if (w.mode === "hold") {
          return `
            <div class="reconnect-wait-banner" role="status">
              <div class="reconnect-wait-text">
                <p><strong>${name}</strong> の再入室を待っています</p>
                <p class="reconnect-wait-note">この席の番では進みません</p>
              </div>
              ${
                isHost
                  ? `<div class="reconnect-wait-actions">
                <button type="button" class="btn primary" data-act="cpu-takeover" data-player="${pid}">CPUに任せる</button>
              </div>`
                  : ""
              }
            </div>`;
        }
        const deadline = Number(w.deadline) || 0;
        return `
          <div class="reconnect-wait-banner" role="status">
            <div class="reconnect-wait-text">
              <p><strong>${name}</strong> が切断 — 再接続待ち <span class="timer" data-deadline="${deadline}"></span></p>
            </div>
            ${
              isHost
                ? `<div class="reconnect-wait-actions">
              <button type="button" class="btn ghost" data-act="hold-reconnect" data-player="${pid}">再入室を待つ</button>
              <button type="button" class="btn" data-act="cpu-takeover" data-player="${pid}">CPUに任せる</button>
            </div>`
                : ""
            }
          </div>`;
      })
      .join("");
  }

  _disconnectBanner(connectionStatus, opts = {}) {
    const { role = "", canReconnect = false, disconnectKind = "" } = opts;
    if (role !== "guest") return "";
    if (disconnectKind !== "guest-drop" && disconnectKind !== "host-ended") return "";

    const hostEnded = disconnectKind === "host-ended";
    const text = hostEnded
      ? connectionStatus || "ホストが部屋を終了しました。この部屋には戻れません"
      : connectionStatus || "接続が切れました。同じ部屋なら再接続できます";
    const showReconnect = !hostEnded && canReconnect;

    return `
      <div class="disconnect-banner" role="alert">
        <div class="disconnect-banner-text">
          <p>${escapeHtml(text)}</p>
          ${
            hostEnded
              ? `<p class="disconnect-banner-note">ホストが閉じた部屋は再開できません</p>`
              : ""
          }
        </div>
        <div class="disconnect-banner-actions">
          ${
            showReconnect
              ? `<button type="button" class="btn primary" data-act="reconnect">再接続</button>`
              : ""
          }
          <button type="button" class="btn ghost" data-act="lobby">ホームへ</button>
        </div>
      </div>`;
  }

  _turnBanner(view, myTurn, role, roomId = "") {
    const cur = view.players[view.turn];
    const color = SEAT_COLORS[view.turn % 4];
    const phase = PHASE_JP[view.phase] || view.phase;
    const you = myTurn ? "（あなた）" : "";
    const waitingCpu =
      role === "solo" && !myTurn && view.phase !== "taste_window" && view.phase !== "cook_reveal"
        ? `<span class="hot-tag">CPU…</span>`
        : "";
    const mode = RULE_LABELS[view.ruleSet]
      ? `<span class="mode-badge mode-badge--inline">${escapeHtml(RULE_LABELS[view.ruleSet])}</span>`
      : "";
    const roomChip = roomId ? `<span class="room-chip room-chip--inline">${escapeHtml(roomId)}</span>` : "";
    return `
      <div class="turn-banner" style="--seat:${color}">
        <div class="turn-banner-main">
          <strong>${escapeHtml(cur?.name || "?")}</strong>
          <span class="turn-phase">${phase}</span>
          <span class="turn-you">${you}</span>
          ${mode}
          ${roomChip}
          ${waitingCpu}
        </div>
        <div class="turn-tools turn-tools--mobile">
          ${this._toolButtonsHtml()}
        </div>
      </div>`;
  }

  _handCardHtml(c) {
    const selected = this.selected.has(c.id) ? "selected" : "";
    return `
      <div class="card-wrap ${selected}">
        <button type="button" class="card ${selected}" data-card="${c.id}" data-name="${escapeHtml(c.name)}">
          <img src="${cardImagePath(c.name)}" alt="${escapeHtml(c.name)}" />
          <span class="card-name">${escapeHtml(c.name)}</span>
        </button>
        <button type="button" class="card-info" data-info="${escapeHtml(c.name)}" title="こうか">?</button>
      </div>`;
  }

  _cookPreviewHtml(me, ruleSet) {
    const hand = me?.hand || [];
    const byId = Object.fromEntries(hand.map((c) => [c.id, c]));
    const names = [...this.selected].map((id) => byId[id]?.name).filter(Boolean);
    if (!names.length) {
      return `<div class="cook-preview idle"><p>3〜5枚選ぶと、ここに点数が表示されます</p></div>`;
    }
    const explained = explainScore(names);
    const validation =
      names.length < 3
        ? { ok: false, reason: `あと ${3 - names.length} まい` }
        : validateCookSet(names, ruleSet);
    const lines = explained.lines
      .map((l) => {
        const cls =
          l.points > l.base ? "cook-line-boost" : l.points < l.base ? "cook-line-cut" : "";
        return `<li class="${cls}"><span>${escapeHtml(l.name)}</span><strong>${l.points}</strong></li>`;
      })
      .join("");
    return `
      <div class="cook-preview ${validation.ok ? "valid" : "invalid"}">
        <div class="cook-preview-total">
          <span class="label">料理プレビュー</span>
          <span class="total">${explained.total}<small>点</small></span>
        </div>
        <ul class="cook-preview-lines">${lines}</ul>
        ${
          explained.garlicDoubled
            ? `<p class="cook-preview-note">にんにくで ${explained.subtotal} → ×2</p>`
            : ""
        }
        <p class="cook-preview-status ${validation.ok ? "ok" : "warn"}">
          ${validation.ok ? "この組み合わせで料理できます" : escapeHtml(validation.reason)}
        </p>
      </div>`;
  }

  _cookHistoryHtml(view) {
    const history = view.cookHistory || [];
    if (!history.length) {
      return `<p class="hint">この試合では料理がありませんでした</p>`;
    }
    return `
      <section class="cook-history">
        <h3>料理の履歴</h3>
        <ol class="cook-history-list">
          ${history
            .map((h) => {
              const pi = view.players.findIndex((p) => p.id === h.playerId);
              const seat = SEAT_COLORS[(pi >= 0 ? pi : 0) % 4];
              const pl = pi >= 0 ? view.players[pi] : null;
              const cpuTag = pl?.isCpu ? `<span class="player-tag cpu">CPU</span>` : "";
              return `
            <li class="cook-history-item ${h.won ? "winning" : ""}" style="--seat:${seat}">
              <div class="cook-history-meta">
                <span class="cook-history-index">#${h.index}</span>
                <strong class="cook-history-name">${escapeHtml(h.playerName)}</strong>
                ${cpuTag}
                <span class="cook-history-score">+${h.points}点 → ${h.score}点</span>
                ${h.won ? `<span class="cook-history-win">勝利</span>` : ""}
              </div>
              <div class="mini-card-row">
                ${(h.names || [])
                  .map(
                    (n) =>
                      `<img src="${cardImagePath(n)}" alt="${escapeHtml(n)}" class="mini-card" title="${escapeHtml(n)}" />`
                  )
                  .join("")}
              </div>
            </li>`;
            })
            .join("")}
        </ol>
      </section>`;
  }

  _resultScoreboard(view) {
    const ranked = view.players
      .map((p, i) => ({ p, i }))
      .sort((a, b) => b.p.score - a.p.score || a.i - b.i);
    return `<div class="scoreboard result-scoreboard">${ranked
      .map(({ p, i }, rank) => {
        const won = i === view.winnerIndex;
        return `
          <div class="result-seat ${won ? "winner" : ""} ${p.isCpu ? "is-cpu" : ""}" style="--seat:${SEAT_COLORS[i % 4]}">
            <div class="result-seat-line">
              <span class="result-rank">${rank + 1}位</span>
              <span class="result-seat-name">${escapeHtml(p.name)}</span>
              ${p.isCpu ? `<span class="player-tag cpu">CPU</span>` : ""}
              ${won ? `<span class="player-tag win">勝者</span>` : ""}
              <strong class="result-seat-score">${p.score}<small>点</small></strong>
            </div>
          </div>`;
      })
      .join("")}</div>`;
  }

  _overlaysHtml(view) {
    return `
      ${this.showHelper ? this._helperPanelHtml(view) : ""}
      ${this.showRules ? this._rulesPanelHtml() : ""}
      ${this.showReference ? this._referencePanelHtml(view?.ruleSet || "noodles") : ""}
      ${this.showLog ? this._logPanelHtml(view) : ""}
      ${this.detailName ? this._detailModalHtml(this.detailName, view?.ruleSet || "noodles") : ""}
    `;
  }

  _logPanelHtml(view) {
    const lines = [...(view?.log || [])].reverse().slice(0, 40);
    return `
      <div class="modal-backdrop" data-act="close-log">
        <div class="modal log-modal" onclick="event.stopPropagation()">
          <header class="ref-header">
            <h2>ログ</h2>
            <button type="button" class="modal-close" data-act="close-log">×</button>
          </header>
          ${
            lines.length
              ? `<ul class="log-modal-list">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
              : `<p class="hint log-modal-empty">まだログはありません</p>`
          }
        </div>
      </div>`;
  }

  _rulesPanelHtml() {
    return `
      <div class="modal-backdrop" data-act="close-rules">
        <div class="modal rules-modal" onclick="event.stopPropagation()">
          <header class="ref-header">
            <h2>ゲームルール</h2>
            <button type="button" class="modal-close" data-act="close-rules">×</button>
          </header>
          <div class="rules-sheet">
            <img src="${RULES_IMG}" alt="ルール" />
          </div>
        </div>
      </div>`;
  }

  _helperPanelHtml(view) {
    const tab = ["cooks", "tips", "tops"].includes(this.helperTab) ? this.helperTab : "cooks";
    return `
      <div class="modal-backdrop" data-act="close-helper">
        <div class="modal helper-modal" onclick="event.stopPropagation()">
          <header class="ref-header">
            <h2>お助け — 組み合わせガイド</h2>
            <button type="button" class="modal-close" data-act="close-helper">×</button>
          </header>
          <div class="panel-tabs helper-tabs" role="tablist">
            <button type="button" class="panel-tab ${tab === "cooks" ? "active" : ""}" role="tab" aria-selected="${tab === "cooks"}" data-act="helper-tab" data-tab="cooks">手札の料理</button>
            <button type="button" class="panel-tab ${tab === "tips" ? "active" : ""}" role="tab" aria-selected="${tab === "tips"}" data-act="helper-tab" data-tab="tips">強化のヒント</button>
            <button type="button" class="panel-tab ${tab === "tops" ? "active" : ""}" role="tab" aria-selected="${tab === "tops"}" data-act="helper-tab" data-tab="tops">強い組み合わせ</button>
          </div>
          <div class="helper-body">${this._helperTabBodyHtml(view, tab)}</div>
        </div>
      </div>`;
  }

  _helperTabBodyHtml(view, tab) {
    const ruleSet = view?.ruleSet || "noodles";
    const me = view?.players?.[view.myIndex];
    const handNames = (me?.hand || []).map((c) => c.name);
    const selectedNames = [...this.selected]
      .map((id) => me?.hand?.find((c) => c.id === id)?.name)
      .filter(Boolean);
    const base = selectedNames.length >= 2 ? selectedNames : handNames;
    const cooks = bestCooksFromHand(handNames, ruleSet);
    const tips = suggestImprovements(base.slice(0, 5), ruleSet, 8);
    const tops = topCombinations(ruleSet, 8);
    const renderCardImages = (names) =>
      names.map((n) => `<img src="${cardImagePath(n)}" alt="${escapeHtml(n)}" class="mini-card" />`).join("");

    if (tab === "tips") {
      return `
        <section>
          <h3>いまの手札／選択を強くするには</h3>
          <p class="hint">基準 ${tips.currentPoints}点</p>
          ${
            tips.suggestions.length
              ? `<ul class="helper-list">${tips.suggestions
                  .map(
                    (s) =>
                      `<li><span class="tag">${escapeHtml(s.type)}</span> ${escapeHtml(s.action)} → <strong>${s.points}点</strong> <em>(+${s.diff})</em><br><div class="mini-card-row">${renderCardImages(s.resultHand)}</div></li>`
                  )
                  .join("")}</ul>`
              : `<p class="hint">これ以上の改善案は見つかりませんでした</p>`
          }
        </section>`;
    }
    if (tab === "tops") {
      return `
        <section>
          <h3>強い組み合わせ TOP（${ruleSet === "classic" ? "本家" : "フル"}）</h3>
          <ul class="helper-list">${tops
            .map(
              (c) =>
                `<li><strong>${c.points}点</strong> <div class="mini-card-row">${renderCardImages(c.cards)}</div></li>`
            )
            .join("")}</ul>
        </section>`;
    }
    return `
      <section>
        <h3>手札から作れる料理（高い順）</h3>
        ${
          cooks.length
            ? `<ul class="helper-list">${cooks
                .map(
                  (c) =>
                    `<li><strong>${c.points}点</strong> <div class="mini-card-row">${renderCardImages(c.cards)}</div></li>`
                )
                .join("")}</ul>`
            : `<p class="hint">必須食材を含む3枚以上が必要です</p>`
        }
      </section>`;
  }

  _detailModalHtml(name, ruleSet = "noodles") {
    const fx = getCardEffect(name, ruleSet);
    return `
      <div class="modal-backdrop detail-backdrop" data-act="close-detail">
        <div class="modal detail-modal" onclick="event.stopPropagation()">
          <button type="button" class="modal-close" data-act="close-detail">×</button>
          <div class="detail-layout">
            <img class="detail-art" src="${cardImagePath(name)}" alt="${escapeHtml(name)}" />
            <div class="detail-body">
              <p class="detail-cat">${escapeHtml(fx?.category || categoryOf(name))}</p>
              <h2 class="detail-title">${escapeHtml(name)}</h2>
              <p class="detail-meta">
                <span class="detail-base"><span>点数</span> ${escapeHtml(fx?.base || "—")}</span>
                <span class="detail-count"><span>枚数</span> ${escapeHtml(fx?.countLabel || "—")}</span>
              </p>
              <p class="detail-effect"><span>料理</span> ${escapeHtml(fx?.effect || "")}</p>
              ${fx?.discard ? `<p class="detail-discard">${escapeHtml(fx.discard)}</p>` : ""}
            </div>
          </div>
        </div>
      </div>`;
  }

  _showDetail(name) {
    if (!name) return;
    this.detailName = name;
    const ruleSet = this.lastView?.ruleSet || "noodles";
    const html = this._detailModalHtml(name, ruleSet);
    const existing = this.root.querySelector(".detail-backdrop");
    if (existing) {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      const nextModal = tmp.querySelector(".detail-modal");
      const prevModal = existing.querySelector(".detail-modal");
      if (prevModal && nextModal) {
        nextModal.classList.add("detail-modal--swap");
        prevModal.replaceWith(nextModal);
        this._bindOverlayNode(existing);
      }
      return;
    }
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const node = tmp.firstElementChild;
    if (!node) return;
    this.root.appendChild(node);
    this._bindOverlayNode(node);
  }

  _hideDetail() {
    this.detailName = null;
    this.root.querySelectorAll(".detail-backdrop").forEach((el) => el.remove());
  }

  _bindOverlayNode(node) {
    if (!node) return;
    const bindAct = (el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this._handleAct(el.getAttribute("data-act"), el);
      });
    };
    if (node.matches?.("[data-act]")) bindAct(node);
    node.querySelectorAll("[data-act]").forEach(bindAct);
  }

  _animateHeightSwap(el, html) {
    if (!el) return;
    const from = el.getBoundingClientRect().height;
    el.style.transition = "none";
    el.style.overflow = "hidden";
    el.style.height = `${from}px`;
    el.innerHTML = html;

    // height 固定中は scrollHeight が縮まないことがあるので、一旦 auto で自然高さを測る
    el.style.height = "auto";
    const to = el.getBoundingClientRect().height;
    el.style.height = `${from}px`;
    void el.offsetHeight;

    el.style.transition = "height 0.28s var(--ease)";
    requestAnimationFrame(() => {
      el.style.height = `${to}px`;
    });

    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      el.style.height = "";
      el.style.overflow = "";
      el.style.transition = "";
      el.removeEventListener("transitionend", onEnd);
    };
    const onEnd = (e) => {
      if (e.target === el && e.propertyName === "height") clear();
    };
    el.addEventListener("transitionend", onEnd);
    setTimeout(clear, 360);
  }

  _bindInfoButtons(scope) {
    (scope || this.root).querySelectorAll("[data-info]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showDetail(el.getAttribute("data-info"));
      });
    });
  }

  _patchHelperTab() {
    const modal = this.root.querySelector(".helper-modal");
    if (!modal || !this.lastView) return;
    const tab = this.helperTab;
    modal.querySelectorAll(".panel-tab").forEach((el) => {
      const on = el.getAttribute("data-tab") === tab;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
    const body = modal.querySelector(".helper-body");
    if (body) this._animateHeightSwap(body, this._helperTabBodyHtml(this.lastView, tab));
  }

  _referencePanelHtml(ruleSet) {
    const groups = effectsByCategory(ruleSet);
    const labels = groups.map((g) => g.label);
    if (!this.refTab || !labels.includes(this.refTab)) {
      this.refTab = labels[0] || null;
    }
    return `
      <div class="modal-backdrop" data-act="close-ref">
        <div class="modal ref-modal" onclick="event.stopPropagation()">
          <header class="ref-header">
            <h2>カードの効果</h2>
            <button type="button" class="modal-close" data-act="close-ref">×</button>
          </header>
          <div class="panel-tabs ref-tabs" role="tablist">
            ${labels
              .map(
                (label) => `
              <button type="button" class="panel-tab ${label === this.refTab ? "active" : ""}" role="tab" aria-selected="${label === this.refTab}" data-act="ref-tab" data-tab="${escapeHtml(label)}">${escapeHtml(label)}</button>`
              )
              .join("")}
          </div>
          <div class="ref-list">${this._refTabBodyHtml(ruleSet, this.refTab)}</div>
        </div>
      </div>`;
  }

  _refTabBodyHtml(ruleSet, tabLabel) {
    const groups = effectsByCategory(ruleSet);
    const active = groups.find((g) => g.label === tabLabel) || groups[0];
    if (!active) return "";
    return `<section class="ref-group">
      <h3 class="ref-group-title">${escapeHtml(active.label)}</h3>
      ${active.cards
        .map(
          (c) => `
        <button type="button" class="ref-row ${c.inSet ? "" : "dim"}" data-info="${escapeHtml(c.name)}">
          <img src="${cardImagePath(c.name)}" alt="" />
          <div class="ref-row-body">
            <div class="ref-row-head">
              <strong>${escapeHtml(c.name)}</strong>
              <span class="ref-stats">${escapeHtml(c.base)} ／ ${escapeHtml(c.countLabel)}</span>
            </div>
            <p class="ref-effect">${escapeHtml(c.effect)}</p>
            ${c.discard ? `<p class="ref-discard">${escapeHtml(c.discard)}</p>` : ""}
          </div>
        </button>`
        )
        .join("")}
    </section>`;
  }

  _patchRefTab() {
    const modal = this.root.querySelector(".ref-modal");
    if (!modal || !this.lastView) return;
    const ruleSet = this.lastView.ruleSet || "noodles";
    const tab = this.refTab;
    modal.querySelectorAll(".panel-tab").forEach((el) => {
      const on = el.getAttribute("data-tab") === tab;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
    const list = modal.querySelector(".ref-list");
    if (list) {
      this._animateHeightSwap(list, this._refTabBodyHtml(ruleSet, tab));
      this._bindInfoButtons(list);
    }
  }

  _scoreboard(view) {
    return `<div class="scoreboard">${view.players
      .map(
        (p, i) =>
          `<div class="score-pill ${i === view.turn ? "active" : ""}" style="--seat:${SEAT_COLORS[i % 4]}">
            <span>${escapeHtml(p.name)}</span>
            <strong class="score-num">${p.score}</strong>
          </div>`
      )
      .join("")}</div>`;
  }

  _actionControls(view, myTurn) {
    const lock = this._lastMeta?.actionsLocked ? "disabled" : "";
    const wrap = (inner) => `<div class="action-block action-dock">${inner}</div>`;

    if (view.phase === "cook_reveal") {
      return wrap(`<p class="hint action-dock-status">上の完成料理を確認してください</p>`);
    }
    if (!myTurn) {
      return wrap(`<p class="hint action-dock-status">相手の手番です</p>`);
    }
    if (view.phase === "taste_window") {
      return wrap(`<p class="hint action-dock-status">味見の結果待ち…</p>`);
    }

    if (view.phase === "discard_draw") {
      const n = this.selected.size;
      const blocked1 = view.usedDiscard1;
      const blocked2 = view.usedDiscard2;
      const dis1 = blocked1 || this._lastMeta?.actionsLocked ? "disabled" : "";
      if (n === 0) {
        return wrap(`
            <div class="action-row">
              <button type="button" class="btn primary" data-act="skip-discard" ${lock}>このまま料理へ</button>
              <button type="button" class="btn ghost" data-act="skip-all-cook" ${lock}>料理しない</button>
            </div>`);
      }
      if (n === 1) {
        return wrap(`
            <div class="decl-btns">
              <button type="button" class="btn danger" data-act="confirm-single" data-decl="とり" ${dis1}>とり×2</button>
              <button type="button" class="btn danger" data-act="confirm-single" data-decl="ぶた" ${dis1}>ぶた×3</button>
              <button type="button" class="btn danger" data-act="confirm-single" data-decl="えび" ${dis1}>えび×4</button>
              <button type="button" class="btn ghost btn-clear-sel" data-act="clear-sel" title="選択をクリア">×</button>
            </div>`);
      }
      return wrap(`
          <div class="action-row">
            <button type="button" class="btn danger" data-act="confirm-pair" ${
              blocked2 || this._lastMeta?.actionsLocked ? "disabled" : ""
            }>ペア伏せ（×3）</button>
            <button type="button" class="btn ghost btn-clear-sel" data-act="clear-sel" title="選択をクリア">×</button>
          </div>`);
    }

    if (view.phase === "cook") {
      const me = view.players[view.myIndex];
      const byId = Object.fromEntries((me?.hand || []).map((c) => [c.id, c]));
      const names = [...this.selected].map((id) => byId[id]?.name).filter(Boolean);
      const canCook = names.length >= 3 && validateCookSet(names, view.ruleSet).ok;
      return wrap(`
          <div class="action-row">
            <button type="button" class="btn primary" data-act="confirm-cook" ${
              canCook && !this._lastMeta?.actionsLocked ? "" : "disabled"
            }>料理する</button>
            <button type="button" class="btn ghost" data-act="skip-cook" ${lock}>料理しない</button>
          </div>`);
    }

    if (view.phase === "end_hand") {
      const me = view.players[view.myIndex];
      const need = (me?.hand?.length || 0) - 3;
      const ready = this.selected.size === need;
      return wrap(`
          <div class="action-row">
            <button type="button" class="btn primary" data-act="confirm-end" ${
              ready && !this._lastMeta?.actionsLocked ? "" : "disabled"
            }>捨てて終了（あと${need}）</button>
          </div>`);
    }
    return wrap(`<p class="hint action-dock-status">操作を待っています</p>`);
  }

  _bindAll() {
    this.root.querySelectorAll("[data-card]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this._onCardClick(el);
      });
    });
    this._bindInfoButtons(this.root);
    this.root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._handleAct(btn.getAttribute("data-act"), btn);
      });
    });
    const hand = this.root.querySelector(".card-row.hand");
    if (hand) {
      hand.addEventListener(
        "scroll",
        () => {
          this._handScrollLeft = hand.scrollLeft;
        },
        { passive: true }
      );
    }
    this._bindCookRevealFan();
  }

  _bindCookRevealFan() {
    const root = this.root.querySelector(".cook-reveal-cards");
    if (!root) return;
    const cards = [...root.querySelectorAll(".cook-reveal-card")];
    let lockUntil = 0;

    const setFocus = (index) => {
      root.classList.add("is-focusing");
      root.style.setProperty("--focus", String(index));
      cards.forEach((c, i) => c.classList.toggle("is-focus", i === index));
      // Block retargeting while cards slide under the finger.
      root.classList.add("is-settling");
      lockUntil = Date.now() + 320;
      clearTimeout(root._fanSettleTimer);
      root._fanSettleTimer = setTimeout(() => {
        root.classList.remove("is-settling");
      }, 320);
    };

    const clearFocus = () => {
      root.classList.remove("is-focusing", "is-settling");
      root.style.removeProperty("--focus");
      cards.forEach((c) => c.classList.remove("is-focus"));
      clearTimeout(root._fanSettleTimer);
    };

    cards.forEach((card, i) => {
      card.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        setFocus(i);
      });

      // Touch/pen: decide on pointerdown using this card's index (not pointerup hit-test).
      card.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse") return;
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() < lockUntil) return;
        const cur = root.style.getPropertyValue("--focus").trim();
        if (root.classList.contains("is-focusing") && cur === String(i)) clearFocus();
        else setFocus(i);
      });

      card.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    root.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") clearFocus();
    });

    const reveal = root.closest(".cook-reveal");
    if (reveal) {
      reveal.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse") return;
        if (Date.now() < lockUntil) return;
        if (!e.target.closest(".cook-reveal-card")) clearFocus();
      });
    }
  }

  _restoreHandScroll() {
    const hand = this.root.querySelector(".card-row.hand");
    if (!hand) return;
    hand.scrollLeft = this._handScrollLeft || 0;
  }

  _onCardClick(el) {
    const view = this.lastView;
    if (!view || view.status !== "playing") return;
    const myTurn = view.turn === view.myIndex;
    const id = el.getAttribute("data-card");
    const name = el.getAttribute("data-name");

    if (!myTurn || view.phase === "taste_window" || view.phase === "cook_reveal") {
      this._showDetail(name);
      return;
    }

    if (view.phase === "discard_draw") {
      this._toggleSelect(id, 2);
      return;
    }
    if (view.phase === "cook") {
      this._toggleSelect(id, 5);
      return;
    }
    if (view.phase === "end_hand") {
      const me = view.players[view.myIndex];
      const need = (me?.hand?.length || 0) - 3;
      this._toggleSelect(id, need);
      return;
    }
    this._showDetail(name);
  }

  _toggleSelect(id, max) {
    if (this.selected.has(id)) this.selected.delete(id);
    else {
      if (this.selected.size >= max) return;
      this.selected.add(id);
    }
    this.render(this.lastView, this._lastMeta);
  }

  _handleAct(act, btn = null) {
    if (LOCKED_UI_ACTS.has(act) && this._lastMeta?.actionsLocked) return;

    const sel = [...this.selected];
    const view = this.lastView;

    switch (act) {
      case "lobby":
        this.onAction("lobby", {});
        break;
      case "copy-room":
        copyRoomCode(this._lastMeta?.roomId || this.lastView?.roomId);
        break;
      case "share-room":
        shareRoomCode(this._lastMeta?.roomId || this.lastView?.roomId);
        break;
      case "hold-reconnect":
        this.onAction("holdReconnect", { playerId: btn?.getAttribute("data-player") });
        break;
      case "cpu-takeover":
        this.onAction("cpuTakeover", { playerId: btn?.getAttribute("data-player") });
        break;
      case "reconnect":
        this.onAction("reconnect", {});
        break;
      case "rematch":
        this.onAction("rematch", {});
        break;
      case "startGame":
        this.onAction("startGame", {});
        break;
      case "taste":
        this.onAction("taste", {});
        break;
      case "skipTaste":
        this.onAction("skipTaste", {});
        break;
      case "ackCookReveal":
        this.onAction("ackCookReveal", {});
        break;
      case "open-helper":
        this.showHelper = true;
        this.render(view, this._lastMeta);
        break;
      case "close-helper":
        this.showHelper = false;
        this.render(view, this._lastMeta);
        break;
      case "open-log":
        this.showLog = true;
        this.render(view, this._lastMeta);
        break;
      case "close-log":
        this.showLog = false;
        this.render(view, this._lastMeta);
        break;
      case "helper-tab": {
        const tab = btn?.getAttribute("data-tab");
        if (tab === "cooks" || tab === "tips" || tab === "tops") {
          this.helperTab = tab;
          this._patchHelperTab();
        }
        break;
      }
      case "open-rules":
        this.showRules = true;
        this.render(view, this._lastMeta);
        break;
      case "close-rules":
        this.showRules = false;
        this.render(view, this._lastMeta);
        break;
      case "open-ref":
        this.showReference = true;
        this.render(view, this._lastMeta);
        break;
      case "close-ref":
        this.showReference = false;
        this.render(view, this._lastMeta);
        break;
      case "ref-tab": {
        const label = btn?.getAttribute("data-tab");
        if (label) {
          this.refTab = label;
          this._patchRefTab();
        }
        break;
      }
      case "close-detail":
        this._hideDetail();
        break;
      case "clear-sel":
        this.selected.clear();
        this.render(view, this._lastMeta);
        break;
      case "confirm-single": {
        if (sel.length !== 1) return showAppToast("カードを1枚選んでください");
        const declaration = btn?.getAttribute("data-decl") || "とり";
        this.onAction("declareSingle", {
          cardId: sel[0],
          declaration,
        });
        this.selected.clear();
        break;
      }
      case "confirm-pair":
        if (sel.length !== 2) return showAppToast("カードを2枚選んでください");
        this.onAction("declarePair", { cardIdA: sel[0], cardIdB: sel[1] });
        this.selected.clear();
        break;
      case "confirm-cook": {
        const me = view.players[view.myIndex];
        const byId = Object.fromEntries((me?.hand || []).map((c) => [c.id, c]));
        const names = sel.map((id) => byId[id]?.name).filter(Boolean);
        const v = validateCookSet(names, view.ruleSet);
        if (!v.ok) return showAppToast(v.reason);
        this.onAction("cook", { cardIds: sel });
        this.selected.clear();
        break;
      }
      case "confirm-end":
        this.onAction("endTurnDiscard", { cardIds: sel });
        this.selected.clear();
        break;
      case "skip-discard":
        this.selected.clear();
        this.onAction("skipDiscard", {});
        break;
      case "skip-all-cook":
        this.selected.clear();
        this.onAction("skipAllCook", {});
        break;
      case "skip-cook":
        this.selected.clear();
        this.onAction("skipCook", {});
        break;
      default:
        break;
    }
  }

  setMeta(meta) {
    this._lastMeta = meta;
  }

  _tickTimer() {
    const els = this.root.querySelectorAll(".timer[data-deadline]");
    els.forEach((el) => {
      const deadline = Number(el.getAttribute("data-deadline"));
      const tick = () => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        el.textContent = `あと ${left} 秒`;
        if (left > 0 && this.root.contains(el)) setTimeout(tick, 200);
      };
      tick();
    });
  }
}

function cardBacks(n) {
  return Array.from({ length: Math.min(n, 10) }, () => `<div class="card back"></div>`).join("");
}

function handHint(view, myTurn, selectable) {
  if (!myTurn) return "カードの ? で効果を確認できます";
  if (view.phase === "discard_draw") return "1〜2枚選んでから下のボタンへ";
  if (view.phase === "cook") return "3〜5枚選んで「料理する」";
  if (view.phase === "end_hand") return "手札が3枚になるまで捨てるカードを選ぶ";
  if (view.phase === "cook_reveal") return "完成料理を確認してください";
  return selectable ? "カードをタップして選択" : "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function copyRoomCode(roomId) {
  const text = String(roomId || "").trim();
  if (!text) {
    showAppToast("部屋コードがありません");
    return;
  }
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch {
      ok = false;
    }
  }
  showAppToast(ok ? "コピーしたよ。貼ったらこの画面に戻ってね" : "コピーできませんでした");
}

async function shareRoomCode(roomId) {
  const text = String(roomId || "").trim();
  if (!text) {
    showAppToast("部屋コードがありません");
    return;
  }
  try {
    await navigator.share({ text: `THE NOODLES の部屋コード: ${text}` });
    showAppToast("共有したらこの画面に戻ってね");
  } catch (err) {
    if (err?.name === "AbortError") return;
    copyRoomCode(text);
  }
}
