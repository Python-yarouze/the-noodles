/**
 * Playful table UI — select-then-act, turn banner, 2–4 players, previews.
 */

import { cardImagePath, WIN_SCORE, RULE_LABELS, categoryOf, RULES_IMAGE } from "./deck.js";
import { explainScore, validateCookSet } from "./scoring.js";
import { getCardEffect, effectsByCategory } from "./card-effects.js";
import { FxLayer, showAppToast } from "./fx.js";
import { suggestImprovements, topCombinations, bestCooksFromHand } from "./helper.js";

const SEAT_COLORS = ["#c45c26", "#2a7a6a", "#b8860b", "#5c6bc0"];
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
  }

  render(view, meta = {}) {
    this.lastView = view;
    this._lastMeta = meta;
    const { connectionStatus = "", role = "", roomId = "", canStart = false, actionsLocked = false, canReconnect = false } =
      meta;
    const lock = actionsLocked ? "disabled" : "";

    document.body.classList.toggle("match-playing", view?.status === "playing");
    document.body.classList.toggle("match-finished", view?.status === "finished");

    if (view?.phase && view.phase !== this._lastPhase) {
      this.selected.clear();
      this._lastPhase = view.phase;
    }

    if (!view || view.status === "waiting") {
      const goal = view?.winScore ?? WIN_SCORE;
      const tasteMs = view?.tasteWindowMs ?? 15000;
      const tasteLabel = tasteMs ? `味見 ${Math.round(tasteMs / 1000)}秒` : "味見 制限なし";
      this.root.innerHTML = `
        <div class="panel waiting">
          <p class="status-line">${escapeHtml(connectionStatus || "参加者を待っています…")}</p>
          ${roomId ? `<p class="room-code">${escapeHtml(roomId)}</p>` : ""}
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
          <div class="action-row" style="max-width:16rem;margin:0.75rem auto">
            <button type="button" class="btn ghost" data-act="open-rules">ルール</button>
            <button type="button" class="btn ghost" data-act="open-ref">効果表</button>
          </div>
          ${
            canStart
              ? `<button type="button" class="btn primary big" data-act="startGame" ${lock}>はじめる</button>`
              : `<p class="hint">2〜4人になったらホストが「はじめる」を押してください</p>`
          }
          <div class="result-actions" style="margin-top:1rem">
            <button type="button" class="btn ghost" data-act="lobby">ホームへ</button>
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
      this.root.innerHTML = `
        <div class="panel finished result-panel">
          ${this._disconnectBanner(connectionStatus, { role, canReconnect })}
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
            <button type="button" class="btn ${canRematch ? "ghost" : "primary"}" data-act="lobby">ロビーへ</button>
            <button type="button" class="btn ghost" data-act="open-rules">ルール</button>
            <button type="button" class="btn ghost" data-act="open-ref">効果を見る</button>
          </div>
        </div>
        ${this._overlaysHtml(view)}`;
      this._bindAll();
      if (view?.lastEvent) this.fx.play(view.lastEvent);
      return;
    }

    const me = view.myIndex >= 0 ? view.players[view.myIndex] : null;
    const others = view.players.filter((_, i) => i !== view.myIndex);
    const myTurn = view.turn === view.myIndex;
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

    this.root.innerHTML = `
      <div class="table-shell table-playing">
        ${this._disconnectBanner(connectionStatus, { role, canReconnect })}
        ${this._turnBanner(view, myTurn, role, roomId)}
        <header class="table-header">
          <div class="brand">THE NOODLES</div>
          <div class="meta">
            <span class="mode-badge">${escapeHtml(RULE_LABELS[view.ruleSet] || "")}</span>
            <button type="button" class="btn ghost" data-act="open-helper">お助け</button>
            <button type="button" class="btn ghost" data-act="open-rules">ルール</button>
            <button type="button" class="btn ghost" data-act="open-ref">効果を見る</button>
            ${roomId ? `<span class="room-chip">${escapeHtml(roomId)}</span>` : ""}
          </div>
        </header>

        <section class="scores">${this._scoreboard(view)}
          <div class="goal">目標 ${view.winScore ?? WIN_SCORE}点</div>
        </section>

        <section class="opponent-zone">
          <div class="opponents-row">
            ${others
              .map((opp) => {
                const oi = view.players.indexOf(opp);
                return `
                <div class="opp-block" style="--seat:${SEAT_COLORS[oi % 4]}">
                  <h3>${escapeHtml(opp.name)}${opp.isCpu ? " <small>CPU</small>" : ""} <small>×${opp.handCount}</small></h3>
                  <div class="card-row backs">${cardBacks(opp.handCount || 0)}</div>
                </div>`;
              })
              .join("")}
          </div>
        </section>

        <section class="center-zone">
          <div class="piles">
            <div class="pile pile-deck">山札<br><strong>${view.deckCount}</strong></div>
            <div class="pile">捨て札<br><strong>${view.discardCount}</strong></div>
          </div>
          ${view.phase === "cook_reveal" && view.lastCook ? this._cookRevealHtml(view) : ""}
          ${
            view.pendingPublic
              ? `<div class="pending pop">
                  伏せ札：<strong>${escapeHtml(view.pendingPublic.declaration)}</strong>
                  （${view.pendingPublic.cardCount}枚 → ${view.pendingPublic.drawCount}枚）
                  ${view.tasteDeadline ? `<span class="timer" data-deadline="${view.tasteDeadline}"></span>` : ""}
                </div>`
              : ""
          }
          ${
            tasteOpen
              ? tastePassed
                ? `<p class="hint big-hint">パス済み — 他の人の判断待ち（${passCount}/${passNeed}）</p>`
                : `<div class="taste-actions">
                  <button type="button" class="btn danger big taste-btn" data-act="taste" ${lock}>味見する</button>
                  <button type="button" class="btn ghost" data-act="skipTaste" ${lock}>パス（味見しない）</button>
                  <p class="hint">早いもの勝ち ／ パス ${passCount}/${passNeed}</p>
                </div>`
              : ""
          }
          ${
            view.phase === "taste_window" && myTurn
              ? `<p class="hint big-hint">相手の味見待ち…（パス ${passCount}/${passNeed}）</p>`
              : ""
          }
        </section>

        <section class="hand-zone">
          <div class="hand-zone-head">
            <h3>あなたのてふだ（${me?.hand?.length || 0}）</h3>
            <p class="hand-hint">${handHint(view, myTurn, selectable)}</p>
          </div>
          <div class="card-row hand">
            ${(me?.hand || []).map((c) => this._handCardHtml(c)).join("")}
          </div>
          ${view.phase === "cook" && myTurn ? this._cookPreviewHtml(me, view.ruleSet) : ""}
        </section>

        <section class="actions">
          ${this._actionControls(view, myTurn)}
        </section>

        <section class="log">
          <h3>ログ</h3>
          <ul>${[...(view.log || [])].reverse().slice(0, 12).map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        </section>
      </div>
      ${this._overlaysHtml(view)}
    `;

    this._bindAll();
    this._tickTimer();
    if (view?.lastEvent) this.fx.play(view.lastEvent);
  }

  _cookRevealHtml(view) {
    const dish = view.lastCook;
    const acked = (view.cookAcks || []).includes(view.players[view.myIndex]?.id);
    const ackCount = (view.cookAcks || []).length;
    const need = view.players.length;
    return `
      <div class="cook-reveal">
        <p class="cook-reveal-label">完成した料理</p>
        <h3 class="cook-reveal-chef">${escapeHtml(dish.playerName)} の一品</h3>
        <div class="cook-reveal-cards">
          ${(dish.names || [])
            .map(
              (n) =>
                `<div class="cook-reveal-card"><img src="${cardImagePath(n)}" alt="${escapeHtml(n)}" /><span>${escapeHtml(n)}</span></div>`
            )
            .join("")}
        </div>
        <p class="cook-reveal-points">+${dish.points} 点 <small>（合計 ${dish.score}）</small></p>
        ${dish.won ? `<p class="cook-reveal-win">勝利条件達成！</p>` : ""}
        <p class="hint">全員が確認すると続きます（${ackCount}/${need}）</p>
        ${
          view.cookRevealDeadline
            ? `<p class="hint cook-reveal-auto">自動で進みます（<span class="timer" data-deadline="${view.cookRevealDeadline}"></span>）</p>`
            : ""
        }
        ${
          acked
            ? `<p class="hint">確認済み — 他の人を待っています</p>`
            : `<button type="button" class="btn primary big" data-act="ackCookReveal" ${
                this._lastMeta?.actionsLocked ? "disabled" : ""
              }>確認して次へ</button>`
        }
      </div>`;
  }

  _disconnectBanner(connectionStatus, opts = {}) {
    if (!connectionStatus) return "";
    const { role = "", canReconnect = false } = opts;
    const showReconnect = role === "guest" && canReconnect;
    return `
      <div class="disconnect-banner" role="alert">
        <div class="disconnect-banner-text">
          <p>${escapeHtml(connectionStatus)}</p>
          <p class="disconnect-banner-note">ホストが閉じた部屋は再開できません</p>
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
    const roomChip = roomId ? `<span class="room-chip room-chip--inline">${escapeHtml(roomId)}</span>` : "";
    return `
      <div class="turn-banner" style="--seat:${color}">
        <div class="turn-banner-main">
          <strong>${escapeHtml(cur?.name || "?")}</strong>
          <span class="turn-phase">${phase}</span>
          <span class="turn-you">${you}</span>
          ${roomChip}
        </div>
        <div class="turn-tools">
          <button type="button" class="btn ghost btn-tool" data-act="open-helper">お助け</button>
          <button type="button" class="btn ghost btn-tool" data-act="open-rules">ルール</button>
          <button type="button" class="btn ghost btn-tool" data-act="open-ref">効果表</button>
        </div>
        ${waitingCpu}
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
    return `<div class="scoreboard result-scoreboard">${view.players
      .map((p, i) => {
        const won = i === view.winnerIndex;
        return `
          <div class="result-seat ${won ? "winner" : ""} ${p.isCpu ? "is-cpu" : ""}" style="--seat:${SEAT_COLORS[i % 4]}">
            <div class="result-seat-head">
              <span class="result-seat-name">${escapeHtml(p.name)}</span>
              ${p.isCpu ? `<span class="player-tag cpu">CPU</span>` : `<span class="player-tag human">プレイヤー</span>`}
              ${won ? `<span class="player-tag win">勝者</span>` : ""}
            </div>
            <strong class="result-seat-score">${p.score}<small>点</small></strong>
          </div>`;
      })
      .join("")}</div>`;
  }

  _overlaysHtml(view) {
    return `
      ${this.showHelper ? this._helperPanelHtml(view) : ""}
      ${this.showRules ? this._rulesPanelHtml() : ""}
      ${this.showReference ? this._referencePanelHtml(view?.ruleSet || "noodles") : ""}
      ${this.detailName ? this._detailModalHtml(this.detailName, view?.ruleSet || "noodles") : ""}
    `;
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

    return `
      <div class="modal-backdrop" data-act="close-helper">
        <div class="modal helper-modal" onclick="event.stopPropagation()">
          <header class="ref-header">
            <h2>お助け — 組み合わせガイド</h2>
            <button type="button" class="modal-close" data-act="close-helper">×</button>
          </header>
          <div class="helper-body">
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
            </section>
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
            </section>
            <section>
              <h3>強い組み合わせ TOP（${ruleSet === "classic" ? "本家" : "フル"}）</h3>
              <ul class="helper-list">${tops
                .map(
                  (c) =>
                    `<li><strong>${c.points}点</strong> <div class="mini-card-row">${renderCardImages(c.cards)}</div></li>`
                )
                .join("")}</ul>
            </section>
          </div>
        </div>
      </div>`;
  }

  _detailModalHtml(name, ruleSet = "noodles") {
    const fx = getCardEffect(name, ruleSet);
    return `
      <div class="modal-backdrop" data-act="close-detail">
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

  _referencePanelHtml(ruleSet) {
    const groups = effectsByCategory(ruleSet);
    return `
      <div class="modal-backdrop" data-act="close-ref">
        <div class="modal ref-modal" onclick="event.stopPropagation()">
          <header class="ref-header">
            <h2>カードの効果</h2>
            <button type="button" class="modal-close" data-act="close-ref">×</button>
          </header>
          <div class="ref-list">${groups
            .map(
              (g) => `
            <section class="ref-group">
              <h3>${escapeHtml(g.label)}</h3>
              ${g.cards
                .map(
                  (c) => `
                <button type="button" class="ref-row ${c.inSet ? "" : "dim"}" data-info="${escapeHtml(c.name)}">
                  <img src="${cardImagePath(c.name)}" alt="" />
                  <div>
                    <strong>${escapeHtml(c.name)}</strong>
                    <span class="ref-stats">${escapeHtml(c.base)} ／ ${escapeHtml(c.countLabel)}</span>
                    <p>${escapeHtml(c.effect)}</p>
                    ${c.discard ? `<p class="ref-discard">${escapeHtml(c.discard)}</p>` : ""}
                  </div>
                </button>`
                )
                .join("")}
            </section>`
            )
            .join("")}</div>
        </div>
      </div>`;
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
    if (view.phase === "cook_reveal") {
      return `<p class="hint">上の完成料理を確認してください</p>`;
    }
    if (!myTurn) {
      return `<p class="hint big-hint">相手の手番です</p>`;
    }
    if (view.phase === "taste_window") {
      return `<p class="hint">味見の結果待ち…</p>`;
    }

    if (view.phase === "discard_draw") {
      const n = this.selected.size;
      const blocked1 = view.usedDiscard1;
      const blocked2 = view.usedDiscard2;
      const dis1 = blocked1 || this._lastMeta?.actionsLocked ? "disabled" : "";
      return `
        <div class="action-block stack">
          ${
            n === 0
              ? `
            <button type="button" class="btn primary big" data-act="skip-discard" ${lock}>このまま料理へ →</button>
            <button type="button" class="btn ghost" data-act="skip-all-cook" ${lock}>料理しない</button>`
              : ""
          }
          ${
            n === 1
              ? `
            <p class="decl-label">宣言して1枚伏せる</p>
            <div class="decl-btns">
              <button type="button" class="btn danger" data-act="confirm-single" data-decl="とり" ${dis1}>とり（2枚引き）</button>
              <button type="button" class="btn danger" data-act="confirm-single" data-decl="ぶた" ${dis1}>ぶた（3枚引き）</button>
              <button type="button" class="btn danger" data-act="confirm-single" data-decl="えび" ${dis1}>えび（4枚引き）</button>
            </div>
            ${blocked1 ? `<p class="hint">1枚捨ては使用済みです</p>` : ""}`
              : ""
          }
          ${
            n === 2
              ? `
            <button type="button" class="btn danger big" data-act="confirm-pair" ${
              blocked2 || this._lastMeta?.actionsLocked ? "disabled" : ""
            }>
              ペアとして伏せる（3枚引き）
            </button>
            ${blocked2 ? `<p class="hint">2枚捨ては使用済みです</p>` : ""}`
              : ""
          }
          ${n > 0 ? `<button type="button" class="btn ghost" data-act="clear-sel">選択をクリア</button>` : ""}
        </div>
        <p class="hint">${n === 0 ? "カードを選ぶか、料理へ進む／料理しないを選んでください" : "カードを1〜2枚選んでからボタンを押してください"}</p>`;
    }

    if (view.phase === "cook") {
      const me = view.players[view.myIndex];
      const byId = Object.fromEntries((me?.hand || []).map((c) => [c.id, c]));
      const names = [...this.selected].map((id) => byId[id]?.name).filter(Boolean);
      const canCook = names.length >= 3 && validateCookSet(names, view.ruleSet).ok;
      return `
        <div class="action-block stack">
          <button type="button" class="btn primary big" data-act="confirm-cook" ${
            canCook && !this._lastMeta?.actionsLocked ? "" : "disabled"
          }>
            料理する
          </button>
          <button type="button" class="btn ghost" data-act="skip-cook" ${lock}>料理しない</button>
        </div>`;
    }

    if (view.phase === "end_hand") {
      const me = view.players[view.myIndex];
      const need = (me?.hand?.length || 0) - 3;
      const ready = this.selected.size === need;
      return `
        <div class="action-block stack">
          <p>手札を3枚にしてください（あと <strong>${need}</strong> 枚捨てる）</p>
          <button type="button" class="btn primary big" data-act="confirm-end" ${
            ready && !this._lastMeta?.actionsLocked ? "" : "disabled"
          }>
            捨ててターン終了
          </button>
        </div>`;
    }
    return "";
  }

  _bindAll() {
    this.root.querySelectorAll("[data-card]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this._onCardClick(el);
      });
    });
    this.root.querySelectorAll("[data-info]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this.detailName = el.getAttribute("data-info");
        this.render(this.lastView, this._lastMeta);
      });
    });
    this.root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._handleAct(btn.getAttribute("data-act"), btn);
      });
    });
  }

  _onCardClick(el) {
    const view = this.lastView;
    if (!view || view.status !== "playing") return;
    const myTurn = view.turn === view.myIndex;
    const id = el.getAttribute("data-card");
    const name = el.getAttribute("data-name");

    if (!myTurn || view.phase === "taste_window" || view.phase === "cook_reveal") {
      this.detailName = name;
      this.render(view, this._lastMeta);
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
    this.detailName = name;
    this.render(view, this._lastMeta);
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
      case "close-detail":
        this.detailName = null;
        this.render(view, this._lastMeta);
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
        el.textContent = `のこり ${left} びょう`;
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
