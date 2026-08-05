/**
 * App entry: lobby + host/guest / solo CPU / local hot-seat (debug).
 */

import { NoodlesGame } from "./game.js";
import { PeerRoom } from "./peer-room.js";
import { GameUI } from "./ui.js";
import { decideCpuAction } from "./ai.js";
import { MAX_PLAYERS, clampWinScore, clampTasteMs } from "./deck.js";

const lobbyEl = document.getElementById("lobby");
const tableEl = document.getElementById("table");
const statusEl = document.getElementById("global-status");
const lobbyRulesModal = document.getElementById("lobby-rules-modal");

let game = null;
let room = null;
let ui = null;
let role = null;
let myId = null;
let roomId = null;
let connectionStatus = "";
let localActiveSeat = 0;
/** @type {Map<string, string>} peerId -> playerId for host routing */
let peerToPlayer = new Map();
let cpuTimer = null;
let cpuBusy = false;

function showLobby() {
  destroySession();
  lobbyEl.hidden = false;
  tableEl.hidden = true;
  tableEl.innerHTML = "";
}

function showTable() {
  lobbyEl.hidden = true;
  tableEl.hidden = false;
  ui = new GameUI(tableEl, { onAction: handleUiAction });
  refresh();
}

function destroySession() {
  clearCpuTimer();
  if (room) {
    room.destroy();
    room = null;
  }
  game = null;
  ui = null;
  role = null;
  myId = null;
  roomId = null;
  peerToPlayer = new Map();
  cpuBusy = false;
}

function clearCpuTimer() {
  if (cpuTimer) {
    clearTimeout(cpuTimer);
    cpuTimer = null;
  }
}

function setStatus(msg) {
  connectionStatus = msg;
  if (statusEl) statusEl.textContent = msg;
  refresh();
}

function selectedRuleSet() {
  const el = document.querySelector('input[name="rule-set"]:checked');
  return el?.value === "classic" ? "classic" : "noodles";
}

function localPlayerCount() {
  const n = Number(document.getElementById("local-count")?.value || 2);
  return Math.min(MAX_PLAYERS, Math.max(2, n));
}

function lobbySettings() {
  const winScore = clampWinScore(document.getElementById("win-score")?.value || 50);
  const tasteSec = Number(document.getElementById("taste-sec")?.value ?? 15);
  return {
    winScore,
    tasteWindowMs: clampTasteMs(tasteSec * 1000),
  };
}

function applyLobbySettings(g) {
  g.setRuleSet(selectedRuleSet());
  g.setSettings(lobbySettings());
}

function refresh() {
  if (!ui) return;
  const meta = {
    connectionStatus,
    role,
    roomId,
    isHost: role === "host",
    canStart:
      role === "host" &&
      game &&
      game.state.status === "waiting" &&
      game.state.players.length >= 2,
  };
  ui.setMeta(meta);

  if (role === "solo" && game) {
    const view = game.viewFor("local-0");
    ui.render(view, meta);
    scheduleCpu();
    return;
  }

  if (role === "local" && game) {
    syncLocalSeat();
    const view = game.viewFor(game.state.players[localActiveSeat].id);
    ui.render(view, meta);
    return;
  }

  if (role === "host" && game) {
    const view = game.viewFor(myId);
    ui.render(view, meta);
    broadcastViews();
    return;
  }

  if (role === "guest") {
    if (window.__lastGuestView) {
      ui.render(window.__lastGuestView, meta);
    } else {
      ui.render({ status: "waiting", players: [], log: [], ruleSet: "noodles" }, meta);
    }
  }
}

function scheduleCpu() {
  if (role !== "solo" || !game || cpuBusy) return;
  const action = decideCpuAction(game.state);
  if (!action) return;
  clearCpuTimer();
  const delay = 450 + Math.floor(Math.random() * 350);
  cpuTimer = setTimeout(() => runCpuStep(), delay);
}

function runCpuStep() {
  cpuTimer = null;
  if (role !== "solo" || !game || cpuBusy) return;
  const action = decideCpuAction(game.state);
  if (!action) return;

  const cpu = game.state.players.find((p) => p.isCpu);
  if (!cpu) return;

  cpuBusy = true;
  try {
    handleHostAction(cpu.id, action.type, action.payload || {}, { skipRefresh: true });
  } finally {
    cpuBusy = false;
  }
  refresh();
}

function syncLocalSeat() {
  if (!game || game.state.status !== "playing") return;
  if (game.state.phase === "taste_window" && game.state.pendingAction) {
    const actor = game.state.pendingAction.actorIndex;
    if (localActiveSeat === actor) {
      localActiveSeat = (actor + 1) % game.state.players.length;
    }
  } else if (game.state.phase === "cook_reveal") {
    const acks = game.state.cookAcks || [];
    const waiting = game.state.players.findIndex((p) => !acks.includes(p.id));
    if (waiting >= 0) localActiveSeat = waiting;
  } else {
    localActiveSeat = game.state.turn;
  }
}

function broadcastViews() {
  if (role !== "host" || !room || !game) return;
  room.sendEach((peerId) => {
    const pid = peerToPlayer.get(peerId);
    if (!pid || pid === myId) return null;
    return { type: "state", view: game.viewFor(pid) };
  });
}

function handleHostAction(playerId, type, payload, { skipRefresh = false } = {}) {
  if (!game) return;
  let result = { ok: false, reason: "unknown" };
  switch (type) {
    case "startGame":
      result = game.startGame();
      break;
    case "setRuleSet":
      result = game.setRuleSet(payload.ruleSet);
      break;
    case "setSettings":
      result = game.setSettings(payload);
      break;
    case "declareSingle":
      result = game.declareSingleDiscard(playerId, payload.cardId, payload.declaration);
      break;
    case "declarePair":
      result = game.declarePairDiscard(playerId, payload.cardIdA, payload.cardIdB);
      break;
    case "taste":
      result = game.taste(playerId);
      break;
    case "skipTaste":
      result = game.skipTaste(playerId);
      break;
    case "skipDiscard":
      result = game.skipDiscardPhase(playerId);
      break;
    case "cook":
      result = game.cook(playerId, payload.cardIds);
      break;
    case "ackCookReveal":
      result = game.ackCookReveal(playerId);
      break;
    case "skipCook":
      result = game.skipCook(playerId);
      break;
    case "endTurnDiscard":
      result = game.endTurnDiscard(playerId, payload.cardIds);
      break;
    default:
      break;
  }
  if (!result.ok && result.reason) {
    const isHuman =
      playerId === myId ||
      role === "local" ||
      (role === "solo" && playerId === "local-0");
    if (isHuman) alert(result.reason);
    else if (role === "host") {
      for (const [peerId, pid] of peerToPlayer) {
        if (pid === playerId) room?.sendToPeer(peerId, { type: "error", reason: result.reason });
      }
    }
  }
  if (!skipRefresh) refresh();
  return result;
}

function handleUiAction(type, payload) {
  if (type === "lobby") {
    showLobby();
    return;
  }

  if (role === "guest") {
    room?.send({ type: "action", action: type, payload, playerId: myId });
    return;
  }

  if (role === "solo") {
    handleHostAction("local-0", type, payload);
    return;
  }

  if (role === "local") {
    const pid = game.state.players[localActiveSeat].id;
    handleHostAction(pid, type, payload);
    return;
  }

  if (role === "host") {
    handleHostAction(myId, type, payload);
  }
}

function onPeerMessage(msg, meta = {}) {
  if (role === "host") {
    if (msg.type === "join") {
      const r = game.addPlayer(msg.playerId, msg.name);
      if (!r.ok) {
        if (meta.peerId) room.sendToPeer(meta.peerId, { type: "error", reason: r.reason });
        else room.send({ type: "error", reason: r.reason });
        return;
      }
      if (meta.peerId) peerToPlayer.set(meta.peerId, msg.playerId);
      if (meta.peerId) {
        room.sendToPeer(meta.peerId, {
          type: "joined",
          playerId: msg.playerId,
          ruleSet: game.state.ruleSet,
          winScore: game.state.winScore,
          tasteWindowMs: game.state.tasteWindowMs,
        });
      }
      refresh();
      return;
    }
    if (msg.type === "action") {
      const pid = msg.playerId || peerToPlayer.get(meta.peerId);
      handleHostAction(pid, msg.action, msg.payload || {});
      return;
    }
  }

  if (role === "guest") {
    if (msg.type === "state") {
      window.__lastGuestView = msg.view;
      refresh();
      return;
    }
    if (msg.type === "error") {
      alert(msg.reason || "エラー");
      return;
    }
    if (msg.type === "joined") {
      setStatus("部屋に参加しました。ホストの開始を待ってね");
    }
  }
}

async function startHost() {
  const name = document.getElementById("name-input").value.trim() || "ホスト";
  role = "host";
  myId = `host-${Math.random().toString(36).slice(2, 8)}`;
  game = new NoodlesGame();
  applyLobbySettings(game);
  game.onChange = () => refresh();
  game.addPlayer(myId, name);

  room = new PeerRoom({
    role: "host",
    maxGuests: MAX_PLAYERS - 1,
    onMessage: onPeerMessage,
    onStatus: setStatus,
  });

  try {
    roomId = await room.connect();
    showTable();
    setStatus(`部屋 ${roomId} — 2〜4人そろったら「はじめる」`);
  } catch (e) {
    console.error(e);
    alert("部屋の作成に失敗しました");
    showLobby();
  }
}

async function startGuest() {
  const name = document.getElementById("name-input").value.trim() || "ゲスト";
  const code = document.getElementById("room-input").value.trim().toUpperCase();
  if (!code) {
    alert("部屋コードを入力してください");
    return;
  }
  role = "guest";
  myId = `guest-${Math.random().toString(36).slice(2, 8)}`;
  roomId = code;

  room = new PeerRoom({
    role: "guest",
    roomId: code,
    onMessage: onPeerMessage,
    onStatus: setStatus,
  });

  try {
    await room.connect();
    showTable();
    room.send({ type: "join", playerId: myId, name });
    setStatus("ホストに参加リクエストを送信したよ");
  } catch (e) {
    console.error(e);
    alert("部屋への接続に失敗しました");
    showLobby();
  }
}

function startSolo() {
  const name = document.getElementById("name-input").value.trim() || "プレイヤー";
  role = "solo";
  myId = "local-0";
  roomId = "SOLO";
  game = new NoodlesGame();
  applyLobbySettings(game);
  game.onChange = () => refresh();
  game.addPlayer("local-0", name);
  game.addPlayer("cpu-0", "CPU", { isCpu: true });
  game.startGame();
  connectionStatus = "1人プレイ（vs CPU）";
  showTable();
  refresh();
}

function startLocal() {
  const name1 = document.getElementById("name-input").value.trim() || "プレイヤー1";
  const count = localPlayerCount();
  role = "local";
  roomId = "LOCAL";
  game = new NoodlesGame();
  applyLobbySettings(game);
  game.onChange = () => {
    syncLocalSeat();
    refresh();
  };
  game.addPlayer("local-0", name1);
  for (let i = 1; i < count; i++) {
    game.addPlayer(`local-${i}`, `プレイヤー${i + 1}`);
  }
  game.startGame();
  localActiveSeat = 0;
  connectionStatus = `同じPC・${count}人ホットシート`;
  showTable();
  refresh();
}

function openLobbyRules() {
  if (lobbyRulesModal) lobbyRulesModal.hidden = false;
}

function closeLobbyRules() {
  if (lobbyRulesModal) lobbyRulesModal.hidden = true;
}

document.getElementById("btn-host")?.addEventListener("click", startHost);
document.getElementById("btn-join")?.addEventListener("click", startGuest);
document.getElementById("btn-solo")?.addEventListener("click", startSolo);
document.getElementById("btn-local")?.addEventListener("click", startLocal);
document.getElementById("btn-rules")?.addEventListener("click", openLobbyRules);
document.getElementById("btn-close-lobby-rules")?.addEventListener("click", closeLobbyRules);
lobbyRulesModal?.addEventListener("click", (e) => {
  if (e.target === lobbyRulesModal) closeLobbyRules();
});

function syncLobbySummary() {
  const ruleVal = document.querySelector(".lobby-details .details-summary-val");
  const settingsVal = document.querySelectorAll(".lobby-details .details-summary-val")[1];
  const rule = selectedRuleSet();
  if (ruleVal) ruleVal.textContent = rule === "classic" ? "本家ルール" : "THE NOODLES";
  const win = document.getElementById("win-score")?.value || 50;
  const taste = Number(document.getElementById("taste-sec")?.value ?? 15);
  if (settingsVal) {
    settingsVal.textContent = Number(taste) === 0 ? `${win}点・制限なし` : `${win}点・${taste}秒`;
  }
}

document.querySelectorAll('input[name="rule-set"]').forEach((el) => {
  el.addEventListener("change", syncLobbySummary);
});
document.getElementById("win-score")?.addEventListener("input", syncLobbySummary);
document.getElementById("taste-sec")?.addEventListener("input", syncLobbySummary);
syncLobbySummary();

showLobby();
