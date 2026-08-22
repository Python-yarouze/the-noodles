/**
 * Visual FX overlays — cook splash, taste result, score pop, confetti.
 */

import { cardImagePath } from "./deck.js";

const SEAT_COLORS = ["#c45c26", "#2a7a6a", "#b8860b", "#5c6bc0"];

/** Toast usable from lobby or table (body-mounted). */
export function showAppToast(text, cls = "fx-toast-go") {
  let layer = document.querySelector(".fx-layer.app-toast-host");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "fx-layer app-toast-host";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  const el = document.createElement("div");
  el.className = `fx-toast ${cls || ""}`;
  el.textContent = String(text ?? "");
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

export class FxLayer {
  constructor(root) {
    this.root = root;
    this._lastAt = 0;
    this.layer = document.createElement("div");
    this.layer.className = "fx-layer";
    this.layer.setAttribute("aria-hidden", "true");
  }

  ensureMounted() {
    // Keep FX outside #table so render()'s innerHTML does not wipe animations.
    if (!this.layer.isConnected) {
      document.body.appendChild(this.layer);
    }
  }

  /**
   * @param {any} event lastEvent from view
   */
  play(event) {
    if (!event || !event.at || event.at === this._lastAt) return;
    this._lastAt = event.at;
    this.ensureMounted();

    switch (event.type) {
      case "draw": {
        const name = event.playerName || "プレイヤー";
        const n = event.count ?? 0;
        // Turn/draw notices live in the field status panel — keep FX light.
        if (event.turnStart) break;
        if (n > 0) this._toast(`${name} が ${n} 枚引いた`, "fx-toast-draw");
        break;
      }
      case "discard_declare":
        // Declaration details are shown on the field mat center.
        break;
      case "taste_success":
        this._tasteResult(event, true);
        break;
      case "taste_fail":
        this._tasteResult(event, false);
        break;
      case "taste_skip":
        this._toast(
          `${event.tasterName || "相手"} はパス（${event.passCount ?? "?"}/${event.need ?? "?"}）`,
          "fx-toast-go"
        );
        break;
      case "phase_cook":
      case "skip_cook":
      case "end_hand":
      case "taste_all_passed":
      case "taste_timeout":
      case "cook_ack":
      case "discard_resume":
        // Shown in the field status panel instead of toast spam.
        break;
      case "cook":
      case "cook_win":
        this._cook(event);
        break;
      case "cook_reveal_done":
        break;
      case "game_start":
        this._splash("スタート！", "fx-start");
        break;
      case "game_over":
        this._splash(`${event.winnerName || "？"} の勝利！`, "fx-start");
        this._confetti();
        break;
      case "join":
        this._toast(`${event.name || "誰か"} が参加`, "fx-toast-go");
        break;
      default:
        break;
    }
  }

  _toast(text, cls) {
    showAppToast(text, cls);
  }

  _splash(text, cls) {
    const el = document.createElement("div");
    el.className = `fx-splash ${cls || ""}`;
    el.innerHTML = `<span>${escapeHtml(text)}</span>`;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  _tasteRealCardsHtml(names) {
    const cards = (names || [])
      .map(
        (n) =>
          `<img src="${cardImagePath(n)}" alt="${escapeHtml(n)}" class="fx-taste-card-img" title="${escapeHtml(n)}" />`
      )
      .join("");
    if (!cards) return "";
    return `<p class="fx-taste-real">本当の札：</p><div class="fx-taste-real-cards">${cards}</div>`;
  }

  _tasteResult(event, success) {
    const seat = SEAT_COLORS[(event.tasterIndex ?? 0) % 4];
    const taster = escapeHtml(event.tasterName || "？");
    const actor = escapeHtml(event.actorName || "相手");
    const el = document.createElement("div");
    el.className = `fx-splash fx-taste-card ${success ? "fx-taste-win" : "fx-taste-lose"}`;
    el.style.setProperty("--seat", seat);
    const realCards = this._tasteRealCardsHtml(event.real);

    if (success) {
      let reward = "";
      if (event.rewardKind === "instant") {
        reward = `<p class="fx-taste-reward">${event.rewardDraw ?? 0}枚ドロー！</p>`;
      } else if (event.rewardKind === "next_turn") {
        reward = `<p class="fx-taste-reward">次ターン +1 ドロー</p>`;
      }
      el.innerHTML = `
        <div class="fx-taste-inner">
          <p class="fx-taste-badge ok">味見成功</p>
          <p class="fx-taste-who"><strong>${taster}</strong> が味見した</p>
          <p class="fx-taste-detail">${actor} の宣言は嘘だった</p>
          ${realCards}
          ${reward}
        </div>`;
    } else {
      const penalty = escapeHtml(event.penaltyNote || "ペナルティ");
      el.innerHTML = `
        <div class="fx-taste-inner">
          <p class="fx-taste-badge ng">味見失敗</p>
          <p class="fx-taste-who"><strong>${taster}</strong> が味見した</p>
          <p class="fx-taste-detail">${actor} の宣言は本当だった</p>
          ${realCards}
          <p class="fx-taste-penalty">結果：${penalty}</p>
        </div>`;
    }
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  _cook(event) {
    const points = Number(event.points) || 0;
    const isWin = event.type === "cook_win";
    // Field mat already shows the dish — keep FX light so it doesn't flash over the reveal UI.
    const name = event.playerName ? `${event.playerName} ` : "";
    if (isWin) {
      this._toast(`${name}勝利料理！ +${points}点`.trim(), "fx-toast-draw");
      this._confetti(64);
      return;
    }
    this._toast(`${name}料理 +${points}点`.trim(), "fx-toast-draw");
    if (points >= 30) this._confetti(28);
  }

  _confetti(count = 28) {
    const wrap = document.createElement("div");
    wrap.className = "fx-confetti";
    const n = Math.max(8, count | 0);
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      p.style.setProperty("--i", String(i));
      p.style.setProperty("--x", `${Math.random() * 100}%`);
      p.style.setProperty("--d", `${0.8 + Math.random() * 1.2}s`);
      wrap.appendChild(p);
    }
    this.layer.appendChild(wrap);
    setTimeout(() => wrap.remove(), 2800);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
