/**
 * Visual FX overlays — cook splash, taste result, score pop, confetti.
 */

const SEAT_COLORS = ["#c45c26", "#2a7a6a", "#b8860b", "#5c6bc0"];

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
        if (event.turnStart) {
          this._splash(`${name} のばん！`, "fx-start");
          if (n > 0) {
            setTimeout(() => this._toast(`${name} が ${n} 枚引いた`, "fx-toast-draw"), 500);
          } else {
            setTimeout(() => this._toast(`${name} は引けなかった`, "fx-toast-go"), 500);
          }
        } else if (n > 0) {
          this._toast(`${name} が ${n} 枚引いた`, "fx-toast-draw");
        }
        break;
      }
      case "discard_declare":
        this._splash(
          event.kind === "pair"
            ? `${event.actorName || ""} ペアで伏せた！`.trim()
            : `「${event.declaration}」と宣言！`,
          "fx-declare"
        );
        setTimeout(() => this._toast("味見受付中…", "fx-toast-go"), 700);
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
      case "taste_all_passed":
        this._toast("全員パス — 続行", "fx-toast-go");
        break;
      case "taste_timeout":
        this._toast("時間切れ — 味見なしで続行", "fx-toast-go");
        break;
      case "phase_cook":
        this._toast(`${event.playerName || ""} 料理フェーズ`.trim(), "fx-toast-draw");
        break;
      case "skip_cook":
        this._toast(`${event.playerName || "相手"} は料理しなかった`, "fx-toast-go");
        break;
      case "cook":
      case "cook_win":
        this._cook(event);
        if (event.type === "cook_win") this._confetti();
        break;
      case "cook_ack":
        this._toast(
          `確認 ${event.count ?? "?"}/${event.need ?? "?"}（${event.playerName || ""}）`,
          "fx-toast-go"
        );
        break;
      case "cook_reveal_done":
        if (event.next === "end_hand") {
          this._toast("手札を3枚に整えてください", "fx-toast-draw");
        }
        break;
      case "end_hand":
        this._toast(`${event.playerName || ""} が手札を整えた`, "fx-toast-go");
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
    const el = document.createElement("div");
    el.className = `fx-toast ${cls || ""}`;
    el.textContent = text;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  _splash(text, cls) {
    const el = document.createElement("div");
    el.className = `fx-splash ${cls || ""}`;
    el.innerHTML = `<span>${escapeHtml(text)}</span>`;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  _tasteResult(event, success) {
    const seat = SEAT_COLORS[(event.tasterIndex ?? 0) % 4];
    const taster = escapeHtml(event.tasterName || "？");
    const actor = escapeHtml(event.actorName || "相手");
    const el = document.createElement("div");
    el.className = `fx-splash fx-taste-card ${success ? "fx-taste-win" : "fx-taste-lose"}`;
    el.style.setProperty("--seat", seat);

    if (success) {
      const real = (event.real || []).map((n) => escapeHtml(n)).join("・") || "？";
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
          <p class="fx-taste-real">本当の札：${real}</p>
          ${reward}
        </div>`;
    } else {
      const penalty = escapeHtml(event.penaltyNote || "ペナルティ");
      el.innerHTML = `
        <div class="fx-taste-inner">
          <p class="fx-taste-badge ng">味見失敗</p>
          <p class="fx-taste-who"><strong>${taster}</strong> が味見した</p>
          <p class="fx-taste-detail">${actor} の宣言は本当だった</p>
          <p class="fx-taste-penalty">結果：${penalty}</p>
        </div>`;
    }
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  _cook(event) {
    const el = document.createElement("div");
    el.className = "fx-cook";
    const names = (event.names || []).map((n) => escapeHtml(n)).join("・");
    const chef = event.playerName ? `<p class="fx-cook-chef">${escapeHtml(event.playerName)}</p>` : "";
    el.innerHTML = `
      <div class="fx-cook-inner">
        <p class="fx-cook-title">料理完成</p>
        ${chef}
        <p class="fx-cook-names">${names}</p>
        <p class="fx-cook-points">+${event.points ?? 0}<small>点</small></p>
      </div>`;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  _confetti() {
    const wrap = document.createElement("div");
    wrap.className = "fx-confetti";
    for (let i = 0; i < 28; i++) {
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
