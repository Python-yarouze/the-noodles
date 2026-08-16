/**
 * App entry: lobby + host/guest / solo CPU.
 */

import { NoodlesGame } from "./game.js";
import { PeerRoom, friendlyPeerError, isRoomMissingError } from "./peer-room.js";
import { GameUI } from "./ui.js";
import { decideCpuAction } from "./ai.js";
import { showAppToast } from "./fx.js";
import { MAX_PLAYERS, clampWinScore, clampTasteMs, RULE_LABELS, cardImagePath } from "./deck.js";
import { effectsByCategory } from "./card-effects.js";

const lobbyEl = document.getElementById("lobby");
const tableEl = document.getElementById("table");
const statusEl = document.getElementById("global-status");
const lobbyRulesModal = document.getElementById("lobby-rules-modal");
const lobbyEffectsModal = document.getElementById("lobby-effects-modal");
const lobbyHostConfirm = document.getElementById("lobby-host-confirm");
const lobbyEffectsTabs = document.getElementById("lobby-effects-tabs");
const lobbyEffectsList = document.getElementById("lobby-effects-list");

const LOBBY_BTNS = ["btn-host", "btn-join", "btn-solo"];
let lobbyEffectsTab = null;

/** Actions that must not be double-fired while in flight. */
const LOCKED_ACTIONS = new Set([
  "startGame",
  "rematch",
  "declareSingle",
  "declarePair",
  "taste",
  "skipTaste",
  "skipDiscard",
  "skipAllCook",
  "cook",
  "skipCook",
  "ackCookReveal",
  "endTurnDiscard",
]);

let game = null;
let room = null;
let ui = null;
let role = null;
let myId = null;
let roomId = null;
let connectionStatus = "";
/** @type {Map<string, string>} peerId -> playerId for host routing */
let peerToPlayer = new Map();
let cpuTimer = null;
let cpuBusy = false;
let lobbyBusy = false;
let actionBusy = false;

const RECONNECT_GRACE_MS = 40000;
const HOST_BG_RECOVER_MS = 5000;

/** @type {"" | "guest-drop" | "host-ended"} */
let disconnectKind = "";
let hostEnded = false;
let hostRecoverUntil = 0;
/** @type {Map<string, { playerId: string, name: string, mode: "grace"|"hold", deadline: number|null, timerId: number|null }>} */
let disconnectWaits = new Map();
/** @type {Set<string>} */
let deferredPeerCloses = new Set();
let deferredCloseTimer = null;

function seatStorageKey(id) {
  return `noodles:seat:${id}`;
}

function saveSeat(id, playerId, name) {
  if (!id || !playerId) return;
  try {
    localStorage.setItem(seatStorageKey(id), JSON.stringify({ playerId, name }));
  } catch {
    /* ignore quota / private mode */
  }
}

function loadSeat(id) {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(seatStorageKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.playerId) return null;
    return data;
  } catch {
    return null;
  }
}

function clearSeat(id) {
  if (!id) return;
  try {
    localStorage.removeItem(seatStorageKey(id));
  } catch {
    /* ignore */
  }
}

function setLobbyBusy(busy) {
  lobbyBusy = busy;
  for (const id of LOBBY_BTNS) {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  }
}

function destroyRoomOnly() {
  if (room) {
    try {
      room.onStatus = () => {};
      room.onMessage = () => {};
      room.onConnClose = null;
      room.onPeerClose = null;
      room.destroy();
    } catch (_) {
      /* ignore */
    }
    room = null;
  }
}

function showLobby(opts = {}) {
  const clearSeatOnLeave = opts.clearSeat !== false;
  if (clearSeatOnLeave && roomId) clearSeat(roomId);
  destroySession();
  lobbyEl.hidden = false;
  tableEl.hidden = true;
  tableEl.innerHTML = "";
  document.body.classList.remove("in-game", "match-playing", "match-finished", "match-waiting");
  document.body.classList.add("in-lobby");
  document.body.style.removeProperty("--turn-seat");
  setLobbyBusy(false);
  syncGlobalStatus();
}

function showTable() {
  lobbyEl.hidden = true;
  tableEl.hidden = false;
  document.body.classList.remove("in-lobby");
  document.body.classList.add("in-game");
  ui = new GameUI(tableEl, { onAction: handleUiAction });
  syncGlobalStatus();
  refresh();
}

function destroySession() {
  clearCpuTimer();
  clearDisconnectWaits();
  clearDeferredPeerCloses();
  destroyRoomOnly();
  game = null;
  ui = null;
  role = null;
  myId = null;
  roomId = null;
  peerToPlayer = new Map();
  cpuBusy = false;
  actionBusy = false;
  disconnectKind = "";
  hostEnded = false;
  hostRecoverUntil = 0;
  connectionStatus = "";
  window.__lastGuestView = null;
  window.__disconnectWaits = null;
}

function clearCpuTimer() {
  if (cpuTimer) {
    clearTimeout(cpuTimer);
    cpuTimer = null;
  }
}

function setStatus(msg) {
  connectionStatus = msg;
  syncGlobalStatus();
  refresh();
}

/** Hide top status bar while the table (or an active match) is visible. */
function syncGlobalStatus() {
  if (!statusEl) return;
  const onTable = tableEl && !tableEl.hidden;
  const inMatch =
    game?.state?.status === "playing" || game?.state?.status === "finished";
  if (onTable || inMatch || !connectionStatus) {
    statusEl.textContent = "";
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = connectionStatus;
}

function selectedRuleSet() {
  const el = document.querySelector('input[name="rule-set"]:checked');
  return el?.value === "classic" ? "classic" : "noodles";
}

const LOBBY_SETTINGS_KEY = "noodles.lobbySettings";

function lobbySeatCount() {
  const n = Number(document.getElementById("seat-count")?.value || 2);
  return Math.min(MAX_PLAYERS, Math.max(2, n));
}

function loadLobbySettings() {
  try {
    const raw = localStorage.getItem(LOBBY_SETTINGS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const rule = data.ruleSet === "classic" ? "classic" : "noodles";
    const ruleEl = document.querySelector(`input[name="rule-set"][value="${rule}"]`);
    if (ruleEl) ruleEl.checked = true;
    const winEl = document.getElementById("win-score");
    if (winEl && data.winScore != null) winEl.value = String(clampWinScore(data.winScore));
    const tasteEl = document.getElementById("taste-sec");
    if (tasteEl && data.tasteSec != null) {
      const sec = Math.max(0, Math.min(60, Math.round(Number(data.tasteSec))));
      tasteEl.value = String(Number.isFinite(sec) ? sec : 15);
    }
    const seatEl = document.getElementById("seat-count");
    if (seatEl && data.seatCount != null) {
      seatEl.value = String(lobbySeatCountFrom(data.seatCount));
    }
  } catch {
    /* ignore */
  }
}

function lobbySeatCountFrom(n) {
  return Math.min(MAX_PLAYERS, Math.max(2, Number(n) || 2));
}

function saveLobbySettings() {
  try {
    const tasteSec = Number(document.getElementById("taste-sec")?.value ?? 15);
    localStorage.setItem(
      LOBBY_SETTINGS_KEY,
      JSON.stringify({
        ruleSet: selectedRuleSet(),
        winScore: clampWinScore(document.getElementById("win-score")?.value || 50),
        tasteSec: Number.isFinite(tasteSec) ? Math.max(0, Math.min(60, Math.round(tasteSec))) : 15,
        seatCount: lobbySeatCount(),
      })
    );
  } catch {
    /* ignore */
  }
}

function isLobbyNarrow() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function syncLobbyDetailsMode() {
  const narrow = isLobbyNarrow();
  document.querySelectorAll(".lobby-details").forEach((el) => {
    // PC: must stay open — closed <details> content is inert even if forced visible via CSS
    el.open = !narrow;
  });
}

function bindLobbyDetailsMode() {
  document.querySelectorAll(".lobby-details").forEach((el) => {
    el.addEventListener("toggle", () => {
      if (!isLobbyNarrow() && !el.open) el.open = true;
    });
  });
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
  g.setTargetSeats(lobbySeatCount());
}

function bindGameChange() {
  if (!game) return;
  game.onChange = () => {
    syncReconnectPause();
    refresh();
  };
}

function canGuestReconnect() {
  return (
    role === "guest" &&
    !!roomId &&
    !!loadSeat(roomId) &&
    !hostEnded &&
    disconnectKind !== "host-ended"
  );
}

function serializeDisconnectWaits() {
  return [...disconnectWaits.values()].map((w) => ({
    playerId: w.playerId,
    name: w.name,
    mode: w.mode,
    deadline: w.deadline,
  }));
}

function isHostRecovering() {
  return Date.now() < hostRecoverUntil || document.visibilityState === "hidden";
}

function clearDeferredPeerCloses() {
  if (deferredCloseTimer) {
    clearTimeout(deferredCloseTimer);
    deferredCloseTimer = null;
  }
  deferredPeerCloses = new Set();
}

function clearDisconnectWaits() {
  for (const w of disconnectWaits.values()) {
    if (w.timerId) clearTimeout(w.timerId);
  }
  disconnectWaits = new Map();
  game?.resumeActionTimers?.();
}

function syncReconnectPause() {
  if (!game) return;
  const holds = [...disconnectWaits.values()].filter((w) => w.mode === "hold");
  if (!holds.length) {
    game.resumeActionTimers();
    return;
  }
  const phase = game.state.phase;
  const turnId = game.state.players[game.state.turn]?.id;
  const pending = game.state.pendingAction;
  const needsPause = holds.some((w) => {
    if (turnId === w.playerId) return true;
    if (phase === "taste_window" && pending) {
      const actorId = game.state.players[pending.actorIndex]?.id;
      if (actorId === w.playerId) return false;
      return !(pending.tastePasses || []).includes(w.playerId);
    }
    if (phase === "cook_reveal") {
      return !(game.state.cookAcks || []).includes(w.playerId);
    }
    return false;
  });
  if (needsPause) game.pauseActionTimers();
  else game.resumeActionTimers();
}

function playerStillConnected(playerId) {
  for (const pid of peerToPlayer.values()) {
    if (pid === playerId) return true;
  }
  return false;
}

function startGraceWait(playerId, name) {
  if (!playerId || disconnectWaits.has(playerId)) return;
  const deadline = Date.now() + RECONNECT_GRACE_MS;
  const entry = {
    playerId,
    name: name || "ゲスト",
    mode: "grace",
    deadline,
    timerId: window.setTimeout(() => {
      const current = disconnectWaits.get(playerId);
      if (!current || current.mode !== "grace") return;
      convertSeatToCpu(playerId);
    }, RECONNECT_GRACE_MS),
  };
  disconnectWaits.set(playerId, entry);
  game?.setAwaitingReconnect?.(playerId, true);
  syncReconnectPause();
  refresh();
}

function holdReconnect(playerId) {
  const w = disconnectWaits.get(playerId);
  if (!w) return;
  if (w.timerId) {
    clearTimeout(w.timerId);
    w.timerId = null;
  }
  w.mode = "hold";
  w.deadline = null;
  game?.setAwaitingReconnect?.(playerId, true);
  syncReconnectPause();
  refresh();
}

function convertSeatToCpu(playerId) {
  const w = disconnectWaits.get(playerId);
  if (w?.timerId) clearTimeout(w.timerId);
  disconnectWaits.delete(playerId);
  if (!game) return;
  const p = game.state.players.find((x) => x.id === playerId);
  if (!p || p.isCpu) {
    syncReconnectPause();
    refresh();
    return;
  }
  game.setCpu(playerId, true);
  syncReconnectPause();
  showAppToast(`${p.name} の席をCPUが代理します`);
  refresh();
}

function reclaimHumanSeat(playerId) {
  const w = disconnectWaits.get(playerId);
  if (w?.timerId) clearTimeout(w.timerId);
  disconnectWaits.delete(playerId);
  if (!game) return;
  const p = game.state.players.find((x) => x.id === playerId);
  if (p?.isCpu) game.setCpu(playerId, false);
  else game.setAwaitingReconnect?.(playerId, false);
  syncReconnectPause();
}

function markHostEnded(message) {
  hostEnded = true;
  disconnectKind = "host-ended";
  setStatus(message || "ホストが部屋を終了しました。この部屋には戻れません");
}

function onGuestConnClose() {
  if (hostEnded) return;
  disconnectKind = "guest-drop";
  setStatus("接続が切れました。同じ部屋なら再接続できます");
}

function refresh() {
  if (!ui) return;
  const target = game?.state?.targetSeats || MAX_PLAYERS;
  const meta = {
    connectionStatus,
    role,
    roomId,
    isHost: role === "host",
    actionsLocked: actionBusy,
    canReconnect: canGuestReconnect(),
    disconnectKind,
    disconnectWaits: serializeDisconnectWaits(),
    canStart: role === "host" && game && game.state.status === "waiting" && game.state.players.length >= 1,
    targetSeats: target,
  };
  ui.setMeta(meta);
  syncGlobalStatus();

  if (role === "solo" && game) {
    const view = game.viewFor("local-0");
    ui.render(view, meta);
    scheduleCpu();
    return;
  }

  if (role === "host" && game) {
    const view = game.viewFor(myId);
    ui.render(view, meta);
    broadcastViews();
    scheduleCpu();
    return;
  }

  if (role === "guest") {
    if (window.__lastGuestView) {
      ui.render(
        { ...window.__lastGuestView, disconnectWaits: window.__disconnectWaits || [] },
        meta
      );
    } else {
      ui.render({ status: "waiting", players: [], log: [], ruleSet: "noodles" }, meta);
    }
  }
}

function hasCpuPlayers() {
  return !!game?.state?.players?.some((p) => p.isCpu);
}

function scheduleCpu() {
  if (!game || cpuBusy) return;
  if (role !== "solo" && !(role === "host" && hasCpuPlayers())) return;
  const action = decideCpuAction(game.state);
  if (!action) return;
  clearCpuTimer();
  const delay = 450 + Math.floor(Math.random() * 350);
  cpuTimer = setTimeout(() => runCpuStep(), delay);
}

function runCpuStep() {
  cpuTimer = null;
  if (!game || cpuBusy) return;
  if (role !== "solo" && !(role === "host" && hasCpuPlayers())) return;
  const action = decideCpuAction(game.state);
  if (!action?.playerId) return;

  cpuBusy = true;
  try {
    handleHostAction(action.playerId, action.type, action.payload || {}, {
      skipRefresh: true,
      skipActionLock: true,
    });
  } finally {
    cpuBusy = false;
  }
  refresh();
}

function broadcastViews() {
  if (role !== "host" || !room || !game) return;
  room.pruneDeadConns?.();
  const waits = serializeDisconnectWaits();
  room.sendEach((peerId) => {
    const pid = peerToPlayer.get(peerId);
    if (!pid || pid === myId) return null;
    return { type: "state", view: game.viewFor(pid), disconnectWaits: waits };
  });
}

function sendJoined(peerId, playerId) {
  if (!peerId || !room || !game) return;
  room.sendToPeer(peerId, {
    type: "joined",
    playerId,
    ruleSet: game.state.ruleSet,
    winScore: game.state.winScore,
    tasteWindowMs: game.state.tasteWindowMs,
  });
  room.sendToPeer(peerId, {
    type: "state",
    view: game.viewFor(playerId),
    disconnectWaits: serializeDisconnectWaits(),
  });
}

function handleHostAction(playerId, type, payload, { skipRefresh = false, skipActionLock = false } = {}) {
  if (!game) return { ok: false, reason: "no game" };
  const useLock = !skipActionLock && LOCKED_ACTIONS.has(type);
  if (useLock) {
    if (actionBusy) return { ok: false, reason: "" };
    actionBusy = true;
  }

  let result = { ok: false, reason: "unknown" };
  try {
    switch (type) {
      case "startGame":
        result = game.startGame();
        if (result.ok) {
          connectionStatus = "";
          syncGlobalStatus();
        }
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
      case "skipAllCook": {
        result = game.skipDiscardPhase(playerId);
        if (result.ok) result = game.skipCook(playerId);
        break;
      }
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
      playerId === myId || (role === "solo" && playerId === "local-0");
    if (isHuman) showAppToast(result.reason);
      else if (role === "host") {
        for (const [peerId, pid] of peerToPlayer) {
          if (pid === playerId) room?.sendToPeer(peerId, { type: "error", reason: result.reason });
        }
      }
    }
  } finally {
    if (useLock) actionBusy = false;
  }
  if (!skipRefresh) refresh();
  return result;
}

function rematch() {
  if (!game) return;
  if (role !== "host" && role !== "solo") return;
  if (actionBusy) return;
  actionBusy = true;

  try {
    const humans = game.state.players
      .filter((p) => !String(p.id).startsWith("cpu-"))
      .map((p) => ({
        id: p.id,
        name: p.name,
        isCpu: false,
      }));
    const ruleSet = game.state.ruleSet;
    const winScore = game.state.winScore;
    const tasteWindowMs = game.state.tasteWindowMs;
    const targetSeats = game.state.targetSeats || MAX_PLAYERS;

    clearCpuTimer();
    clearDisconnectWaits();
    cpuBusy = false;
    game = new NoodlesGame();
    game.setRuleSet(ruleSet);
    game.setSettings({ winScore, tasteWindowMs });
    game.setTargetSeats(targetSeats);
    bindGameChange();
    for (const p of humans) {
      game.addPlayer(p.id, p.name, { isCpu: false });
    }
    const started = game.startGame();
    if (!started.ok) {
      showAppToast(started.reason || "再戦を開始できませんでした");
    } else {
      connectionStatus = "";
      if (role === "host") {
        for (const p of humans) {
          if (p.id === myId) continue;
          if (!playerStillConnected(p.id)) startGraceWait(p.id, p.name);
        }
      }
    }
  } finally {
    actionBusy = false;
  }
  refresh();
}

function handleUiAction(type, payload) {
  if (type === "lobby") {
    if (role === "host" && room) {
      try {
        room.send({ type: "room-closed" });
      } catch (_) {
        /* ignore */
      }
    }
    showLobby();
    return;
  }

  if (type === "reconnect") {
    reconnectGuest();
    return;
  }

  if (type === "holdReconnect") {
    if (role === "host" && payload?.playerId) holdReconnect(payload.playerId);
    return;
  }

  if (type === "cpuTakeover") {
    if (role === "host" && payload?.playerId) convertSeatToCpu(payload.playerId);
    return;
  }

  if (type === "rematch") {
    if (role === "guest") return;
    rematch();
    return;
  }

  if (LOCKED_ACTIONS.has(type) && actionBusy) return;

  if (role === "guest") {
    if (LOCKED_ACTIONS.has(type)) {
      actionBusy = true;
      refresh();
    }
    const sent = room?.send({ type: "action", action: type, payload, playerId: myId });
    if (!sent) {
      actionBusy = false;
      disconnectKind = "guest-drop";
      setStatus("送信できません。再接続してください");
    }
    return;
  }

  if (role === "solo") {
    handleHostAction("local-0", type, payload);
    return;
  }

  if (role === "host") {
    handleHostAction(myId, type, payload);
  }
}

function onHostPeerClose(peerId) {
  if (role !== "host" || !game) return;
  if (isHostRecovering()) {
    deferredPeerCloses.add(peerId);
    scheduleDeferredCloseFlush();
    return;
  }
  applyHostPeerClose(peerId);
}

function scheduleDeferredCloseFlush() {
  if (deferredCloseTimer) clearTimeout(deferredCloseTimer);
  const wait = Math.max(HOST_BG_RECOVER_MS, hostRecoverUntil - Date.now());
  deferredCloseTimer = window.setTimeout(() => {
    deferredCloseTimer = null;
    flushDeferredPeerCloses();
  }, wait);
}

function flushDeferredPeerCloses() {
  if (document.visibilityState === "hidden") {
    scheduleDeferredCloseFlush();
    return;
  }
  for (const peerId of [...deferredPeerCloses]) {
    if (room?.hasLiveConn?.(peerId)) {
      deferredPeerCloses.delete(peerId);
      continue;
    }
    deferredPeerCloses.delete(peerId);
    applyHostPeerClose(peerId);
  }
}

function applyHostPeerClose(peerId) {
  if (role !== "host" || !game) return;
  const pid = peerToPlayer.get(peerId);
  peerToPlayer.delete(peerId);
  if (!pid || pid === myId) {
    refresh();
    return;
  }
  if (playerStillConnected(pid)) {
    refresh();
    return;
  }
  const player = game.state.players.find((p) => p.id === pid);
  const name = player?.name || "ゲスト";
  if (game.state.status === "waiting") {
    game.removePlayer(pid);
    setStatus(`${name} が退室しました`);
    return;
  }
  if (player?.isCpu) {
    refresh();
    return;
  }
  startGraceWait(pid, name);
}

async function onHostVisibility() {
  if (role !== "host" || !room) return;
  if (document.visibilityState === "hidden") {
    return;
  }
  hostRecoverUntil = Date.now() + HOST_BG_RECOVER_MS;
  try {
    await room.resumeHost();
  } catch (e) {
    console.warn("host resume failed", e);
    setStatus(friendlyPeerError(e));
  }
  room.pruneDeadConns?.();
  scheduleDeferredCloseFlush();
  refresh();
}

function onPeerMessage(msg, meta = {}) {
  if (role === "host") {
    if (msg.type === "join" || msg.type === "rejoin") {
      if (meta.peerId && peerToPlayer.has(meta.peerId)) {
        const seatedId = peerToPlayer.get(meta.peerId);
        sendJoined(meta.peerId, seatedId);
        refresh();
        return;
      }

      const existing = game.state.players.find((p) => p.id === msg.playerId);
      if (existing) {
        if (meta.peerId) peerToPlayer.set(meta.peerId, msg.playerId);
        reclaimHumanSeat(msg.playerId);
        sendJoined(meta.peerId, msg.playerId);
        if (game.state.status === "playing" || game.state.status === "finished") {
          connectionStatus = "";
        }
        refresh();
        return;
      }
      if (msg.type === "rejoin") {
        if (game.state.status !== "waiting") {
          if (meta.peerId) {
            room.sendToPeer(meta.peerId, {
              type: "error",
              reason: "この席は見つかりません。ホームへ戻ってから参加し直してください",
            });
          }
          return;
        }
      }
      const r = game.addPlayer(msg.playerId, msg.name);
      if (!r.ok) {
        if (meta.peerId) room.sendToPeer(meta.peerId, { type: "error", reason: r.reason });
        else room.send({ type: "error", reason: r.reason });
        return;
      }
      if (meta.peerId) peerToPlayer.set(meta.peerId, msg.playerId);
      sendJoined(meta.peerId, msg.playerId);
      refresh();
      return;
    }
    if (msg.type === "action") {
      const pid = msg.playerId || peerToPlayer.get(meta.peerId);
      const mapped = meta.peerId ? peerToPlayer.get(meta.peerId) : null;
      handleHostAction(mapped || pid, msg.action, msg.payload || {});
      return;
    }
  }

  if (role === "guest") {
    if (msg.type === "room-closed") {
      markHostEnded();
      return;
    }
    if (msg.type === "state") {
      window.__lastGuestView = msg.view;
      window.__disconnectWaits = msg.disconnectWaits || [];
      actionBusy = false;
      if (msg.view?.status === "playing" || msg.view?.status === "finished") {
        connectionStatus = "";
        disconnectKind = disconnectKind === "host-ended" ? disconnectKind : "";
        syncGlobalStatus();
      }
      refresh();
      return;
    }
    if (msg.type === "error") {
      actionBusy = false;
      const reason = msg.reason || "エラー";
      showAppToast(reason);
      if (String(reason).includes("満員")) {
        setStatus("部屋が満員です。一度ホームへ戻るか、少し待って再接続してください");
      }
      refresh();
      return;
    }
    if (msg.type === "joined") {
      if (msg.playerId) myId = msg.playerId;
      if (roomId && myId) {
        const name = document.getElementById("name-input")?.value.trim() || "ゲスト";
        saveSeat(roomId, myId, name);
      }
      if (disconnectKind !== "host-ended") disconnectKind = "";
      setStatus("部屋に参加しました。ホストの開始を待っています");
    }
  }
}

async function startHost() {
  if (lobbyBusy) return;
  openHostConfirm();
}

function hostSettingsSummary() {
  const rule = selectedRuleSet();
  const { winScore, tasteWindowMs } = lobbySettings();
  const seats = lobbySeatCount();
  const tasteLabel = tasteWindowMs ? `${Math.round(tasteWindowMs / 1000)}秒` : "制限なし";
  return [
    ["ルールセット", RULE_LABELS[rule] || rule],
    ["目標ポイント", `${winScore}点`],
    ["味見の制限時間", tasteLabel],
    ["オンライン人数", `${seats}人（不足分はCPU）`],
    ["あなたの名前", document.getElementById("name-input")?.value.trim() || "ホスト"],
  ];
}

function openHostConfirm() {
  const list = document.getElementById("host-confirm-summary");
  if (list) {
    list.innerHTML = hostSettingsSummary()
      .map(([label, value]) => `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`)
      .join("");
  }
  if (lobbyHostConfirm) lobbyHostConfirm.hidden = false;
}

function closeHostConfirm() {
  if (lobbyHostConfirm) lobbyHostConfirm.hidden = true;
}

async function confirmAndCreateHost() {
  if (lobbyBusy) return;
  closeHostConfirm();
  setLobbyBusy(true);
  destroyRoomOnly();

  const name = document.getElementById("name-input").value.trim() || "ホスト";
  const seats = lobbySeatCount();
  role = "host";
  myId = `host-${Math.random().toString(36).slice(2, 8)}`;
  game = new NoodlesGame();
  applyLobbySettings(game);
  bindGameChange();
  game.addPlayer(myId, name);
  peerToPlayer = new Map();
  actionBusy = false;
  disconnectKind = "";
  hostEnded = false;

  room = new PeerRoom({
    role: "host",
    maxGuests: seats - 1,
    onMessage: onPeerMessage,
    onStatus: setStatus,
    onPeerClose: onHostPeerClose,
  });

  try {
    roomId = await room.connect();
    showTable();
    setStatus(`部屋 ${roomId} — ${seats}人部屋（不足分は開始時にCPU）`);
  } catch (e) {
    console.error(e);
    showAppToast(friendlyPeerError(e) || "部屋の作成に失敗しました");
    showLobby({ clearSeat: false });
  } finally {
    setLobbyBusy(false);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openLobbyEffects() {
  renderLobbyEffects();
  if (lobbyEffectsModal) lobbyEffectsModal.hidden = false;
}

function closeLobbyEffects() {
  if (lobbyEffectsModal) lobbyEffectsModal.hidden = true;
}

function renderLobbyEffects() {
  if (!lobbyEffectsTabs || !lobbyEffectsList) return;
  const ruleSet = selectedRuleSet();
  const groups = effectsByCategory(ruleSet);
  const labels = groups.map((g) => g.label);
  if (!lobbyEffectsTab || !labels.includes(lobbyEffectsTab)) {
    lobbyEffectsTab = labels[0] || null;
  }
  lobbyEffectsTabs.innerHTML = labels
    .map(
      (label) =>
        `<button type="button" class="panel-tab ${label === lobbyEffectsTab ? "active" : ""}" data-lobby-tab="${escapeHtml(label)}">${escapeHtml(label)}</button>`
    )
    .join("");
  const active = groups.find((g) => g.label === lobbyEffectsTab) || groups[0];
  lobbyEffectsList.innerHTML = active
    ? `<section class="ref-group">
        <h3 class="ref-group-title">${escapeHtml(active.label)}</h3>
        ${active.cards
          .map(
            (c) => `
          <div class="ref-row ${c.inSet ? "" : "dim"}">
            <img src="${cardImagePath(c.name)}" alt="" />
            <div class="ref-row-body">
              <div class="ref-row-head">
                <strong>${escapeHtml(c.name)}</strong>
                <span class="ref-stats">${escapeHtml(c.base)} ／ ${escapeHtml(c.countLabel)}</span>
              </div>
              <p class="ref-effect">${escapeHtml(c.effect)}</p>
              ${c.discard ? `<p class="ref-discard">${escapeHtml(c.discard)}</p>` : ""}
            </div>
          </div>`
          )
          .join("")}
      </section>`
    : "";
  lobbyEffectsTabs.querySelectorAll("[data-lobby-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      lobbyEffectsTab = btn.getAttribute("data-lobby-tab");
      renderLobbyEffects();
    });
  });
}

async function startGuest() {
  if (lobbyBusy) return;
  const name = document.getElementById("name-input").value.trim() || "ゲスト";
  const code = document.getElementById("room-input").value.trim().toUpperCase();
  if (!code) {
    showAppToast("部屋コードを入力してください");
    return;
  }

  setLobbyBusy(true);
  destroyRoomOnly();

  role = "guest";
  roomId = code;
  const saved = loadSeat(code);
  myId = saved?.playerId || `guest-${Math.random().toString(36).slice(2, 8)}`;
  const joinName = saved?.name || name;
  const isRejoin = !!saved?.playerId;
  actionBusy = false;
  disconnectKind = "";
  hostEnded = false;
  window.__lastGuestView = null;
  window.__disconnectWaits = null;

  room = new PeerRoom({
    role: "guest",
    roomId: code,
    onMessage: onPeerMessage,
    onStatus: setStatus,
    onConnClose: onGuestConnClose,
  });

  try {
    await room.connect();
    showTable();
    saveSeat(code, myId, joinName);
    const sent = room.send({
      type: isRejoin ? "rejoin" : "join",
      playerId: myId,
      name: joinName,
    });
    if (!sent) {
      disconnectKind = "guest-drop";
      setStatus("送信できません。再接続してください");
    } else {
      setStatus(
        isRejoin ? "再接続リクエストを送信したよ" : "ホストに参加リクエストを送信したよ"
      );
    }
  } catch (e) {
    console.error(e);
    showAppToast(friendlyPeerError(e) || "部屋への接続に失敗しました");
    showLobby({ clearSeat: false });
  } finally {
    setLobbyBusy(false);
  }
}

async function reconnectGuest() {
  if (role !== "guest" || !roomId || lobbyBusy) return;
  if (hostEnded || disconnectKind === "host-ended") {
    markHostEnded();
    return;
  }
  const code = roomId;
  const saved = loadSeat(code);
  if (!saved?.playerId) {
    showAppToast("席情報がないため再接続できません");
    return;
  }

  setLobbyBusy(true);
  actionBusy = false;
  destroyRoomOnly();
  myId = saved.playerId;
  const joinName = saved.name || "ゲスト";

  room = new PeerRoom({
    role: "guest",
    roomId: code,
    onMessage: onPeerMessage,
    onStatus: setStatus,
    onConnClose: onGuestConnClose,
  });

  try {
    await room.connect();
    const sent = room.send({
      type: "rejoin",
      playerId: myId,
      name: joinName,
    });
    if (!sent) {
      disconnectKind = "guest-drop";
      setStatus("送信できません。再接続してください");
    } else {
      disconnectKind = "";
      connectionStatus = "";
      setStatus("再接続しました。同期待ち…");
    }
  } catch (e) {
    console.error(e);
    if (isRoomMissingError(e)) {
      markHostEnded("ホストが部屋を終了しました。この部屋には戻れません");
    } else {
      disconnectKind = "guest-drop";
      setStatus(friendlyPeerError(e));
    }
  } finally {
    setLobbyBusy(false);
    refresh();
  }
}

function startSolo() {
  if (lobbyBusy) return;
  setLobbyBusy(true);
  try {
    destroyRoomOnly();
    const name = document.getElementById("name-input").value.trim() || "プレイヤー";
    const targetSeats = lobbySeatCount();
    role = "solo";
    myId = "local-0";
    roomId = "SOLO";
    actionBusy = false;
    game = new NoodlesGame();
    applyLobbySettings(game);
    game.setTargetSeats(targetSeats);
    bindGameChange();
    game.addPlayer("local-0", name);
    game.startGame();
    connectionStatus = "";
    showTable();
    refresh();
  } finally {
    setLobbyBusy(false);
  }
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
document.getElementById("btn-rules")?.addEventListener("click", openLobbyRules);
document.getElementById("btn-effects")?.addEventListener("click", openLobbyEffects);
document.getElementById("btn-close-lobby-rules")?.addEventListener("click", closeLobbyRules);
document.getElementById("btn-close-lobby-effects")?.addEventListener("click", closeLobbyEffects);
document.getElementById("btn-close-host-confirm")?.addEventListener("click", closeHostConfirm);
document.getElementById("btn-host-cancel")?.addEventListener("click", closeHostConfirm);
document.getElementById("btn-host-confirm")?.addEventListener("click", confirmAndCreateHost);
lobbyRulesModal?.addEventListener("click", (e) => {
  if (e.target === lobbyRulesModal) closeLobbyRules();
});
lobbyEffectsModal?.addEventListener("click", (e) => {
  if (e.target === lobbyEffectsModal) closeLobbyEffects();
});
lobbyHostConfirm?.addEventListener("click", (e) => {
  if (e.target === lobbyHostConfirm) closeHostConfirm();
});

document.querySelectorAll('input[name="rule-set"]').forEach((el) => {
  el.addEventListener("change", () => {
    syncLobbySummary();
    saveLobbySettings();
    if (lobbyEffectsModal && !lobbyEffectsModal.hidden) renderLobbyEffects();
  });
});
document.getElementById("win-score")?.addEventListener("input", () => {
  syncLobbySummary();
  saveLobbySettings();
});
document.getElementById("taste-sec")?.addEventListener("input", () => {
  syncLobbySummary();
  saveLobbySettings();
});
document.getElementById("seat-count")?.addEventListener("change", () => {
  syncLobbySummary();
  saveLobbySettings();
});

function syncLobbySummary() {
  const ruleVal = document.querySelector(".lobby-details .details-summary-val");
  const settingsVal = document.querySelectorAll(".lobby-details .details-summary-val")[1];
  const rule = selectedRuleSet();
  if (ruleVal) ruleVal.textContent = rule === "classic" ? "本家ルール" : "THE NOODLES";
  const win = document.getElementById("win-score")?.value || 50;
  const taste = Number(document.getElementById("taste-sec")?.value ?? 15);
  const seats = lobbySeatCount();
  if (settingsVal) {
    const tastePart = Number(taste) === 0 ? "制限なし" : `${taste}秒`;
    settingsVal.textContent = `${win}点・${tastePart}・${seats}人`;
  }
}

loadLobbySettings();
syncLobbySummary();
bindLobbyDetailsMode();
syncLobbyDetailsMode();
window.matchMedia("(max-width: 640px)").addEventListener("change", syncLobbyDetailsMode);
document.addEventListener("visibilitychange", () => {
  onHostVisibility();
});

showLobby();
