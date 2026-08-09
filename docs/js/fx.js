/**
 * Visual FX overlays — cook splash, taste result, score pop, confetti.
 */

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
    showAppToast(text, cls);
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
    const points = Number(event.points) || 0;
    const isWin = event.type === "cook_win";
    let tier = "t2";
    if (isWin) tier = "win";
    else if (points <= 10) tier = "t1";
    else if (points <= 20) tier = "t2";
    else if (points <= 30) tier = "t3";
    else tier = "t4";

    if (tier === "t1") {
      this._toast(
        `${event.playerName ? `${event.playerName} ` : ""}料理 +${points}点`.trim(),
        "fx-toast-draw"
      );
      this._splash(`+${points}`, "fx-start");
      return;
    }

    const el = document.createElement("div");
    el.className = `fx-cook fx-cook--${tier}`;
    const names = (event.names || []).map((n) => escapeHtml(n)).join("・");
    const chef = event.playerName ? `<p class="fx-cook-chef">${escapeHtml(event.playerName)}</p>` : "";
    const title = isWin ? "勝利料理！" : "料理完成";
    const burstCount = tier === "t3" ? 10 : tier === "t4" || tier === "win" ? 18 : 0;
    const burst =
      burstCount > 0
        ? `<div class="fx-cook-burst">${Array.from({ length: burstCount }, (_, i) => {
            const ang = (Math.PI * 2 * i) / burstCount;
            const dist = 70 + (i % 3) * 28;
            return `<i style="--i:${i};--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px"></i>`;
          }).join("")}</div>`
        : "";
    el.innerHTML = `
      ${burst}
      <div class="fx-cook-inner">
        <p class="fx-cook-title">${title}</p>
        ${chef}
        <p class="fx-cook-names">${names}</p>
        <p class="fx-cook-points">+${points}<small>点</small></p>
      </div>`;
    this.layer.appendChild(el);
    const ttl = tier === "t3" ? 2300 : tier === "t4" || tier === "win" ? 2800 : 2200;
    setTimeout(() => el.remove(), ttl);

    if (tier === "t4") this._confetti(42);
    if (tier === "win") this._confetti(64);
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
