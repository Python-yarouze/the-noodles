/**
 * PeerJS room helpers — host can hold multiple guest connections.
 * Uses Open Relay (Metered) TURN when TURN_CREDENTIALS_URL is set in ice-config.js.
 */

const GUEST_CONNECT_TIMEOUT_MS = 20000;
const PENDING_MAX_MS = 20000;
const FALLBACK_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const LINE_HINT =
  "この回線ではつながりにくいことがあります。別のWi-Fiを試すか、時間をおいてやり直してください";

export function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function friendlyPeerError(err) {
  const type = err?.type || "";
  switch (type) {
    case "peer-unavailable":
      return "部屋が見つかりません。コードと、ホストがゲーム画面を開いているかを確認してください";
    case "unavailable-id":
      return "その部屋は使えません。もう一度部屋を作ってください";
    case "network":
    case "disconnected":
    case "socket-closed":
      return "通信が不安定です。つなぎ直しています…";
    case "browser-incompatible":
      return "このブラウザではオンライン対戦できません。別のブラウザを試してください";
    case "server-error":
    case "socket-error":
      return "接続サーバーに問題があります。時間をおいてやり直してください";
    default:
      if (err?.message === "guest connect timeout") {
        return "接続がタイムアウトしました。ホストがゲーム画面を開いているか確認し、モバイル回線や別Wi-Fiを試してください";
      }
      return "つながりませんでした。コードを確認するか、別のWi-Fiを試してください";
  }
}

export function isRoomMissingError(err) {
  return err?.type === "peer-unavailable";
}

async function loadTurnCredentialsUrl() {
  try {
    const mod = await import("./ice-config.js");
    return typeof mod.TURN_CREDENTIALS_URL === "string" ? mod.TURN_CREDENTIALS_URL.trim() : "";
  } catch {
    return "";
  }
}

async function fetchIceServers(onStatus) {
  const url = await loadTurnCredentialsUrl();
  if (!url || url.includes("YOUR_API_KEY")) {
    return FALLBACK_ICE_SERVERS;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const iceServers = await res.json();
    if (!Array.isArray(iceServers) || iceServers.length === 0) {
      throw new Error("empty iceServers");
    }
    return iceServers;
  } catch (e) {
    console.warn("TURN credentials fetch failed", e);
    onStatus?.(LINE_HINT);
    return FALLBACK_ICE_SERVERS;
  }
}

export class PeerRoom {
  /**
   * @param {{ role: 'host'|'guest', roomId?: string, onMessage: (msg:any, meta?: {peerId?:string})=>void, onStatus: (s:string)=>void, onPeerClose?: (peerId:string)=>void, onConnClose?: ()=>void, maxGuests?: number }} opts
   */
  constructor(opts) {
    this.role = opts.role;
    this.roomId = opts.roomId || makeRoomCode();
    this.onMessage = opts.onMessage;
    this.onStatus = opts.onStatus;
    this.onPeerClose = opts.onPeerClose || null;
    this.onConnClose = opts.onConnClose || null;
    this.maxGuests = opts.maxGuests ?? 3;
    this.peer = null;
    /** @type {Map<string, any>} peerId -> DataConnection */
    this.conns = new Map();
    /** Peer ids reserved at connection event (before open). */
    this.pendingPeers = new Set();
    /** @type {Map<string, number>} */
    this.pendingSince = new Map();
    this.conn = null;
    this.connected = false;
    this._connecting = null;
    this._dead = false;
  }

  totalSeats() {
    return this.maxGuests + 1;
  }

  _slotCount() {
    return this.conns.size + this.pendingPeers.size;
  }

  _releasePeer(peerId, { notify = true } = {}) {
    if (!peerId) return;
    const had =
      this.pendingPeers.has(peerId) || this.conns.has(peerId) || this.pendingSince.has(peerId);
    this.pendingPeers.delete(peerId);
    this.pendingSince.delete(peerId);
    this.conns.delete(peerId);
    this.connected = this.conns.size > 0;
    if (notify && had) this.onPeerClose?.(peerId);
  }

  _isConnAlive(conn) {
    if (!conn || conn.open !== true) return false;
    try {
      const pc = conn.peerConnection;
      if (pc) {
        const ice = pc.iceConnectionState;
        const cs = pc.connectionState;
        if (ice === "failed" || ice === "closed" || ice === "disconnected") return false;
        if (cs === "failed" || cs === "closed" || cs === "disconnected") return false;
      }
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  hasLiveConn(peerId) {
    return this._isConnAlive(this.conns.get(peerId));
  }

  /** Drop zombie / stale connections so sleep-reconnect can reclaim slots. */
  pruneDeadConns() {
    return this._pruneDeadConns();
  }

  _pruneDeadConns() {
    const now = Date.now();
    const removed = [];

    for (const [peerId, conn] of [...this.conns.entries()]) {
      if (this._isConnAlive(conn)) continue;
      try {
        conn.close();
      } catch (_) {
        /* ignore */
      }
      this.conns.delete(peerId);
      this.pendingPeers.delete(peerId);
      this.pendingSince.delete(peerId);
      removed.push(peerId);
    }

    for (const peerId of [...this.pendingPeers]) {
      const since = this.pendingSince.get(peerId) || 0;
      if (now - since > PENDING_MAX_MS) {
        this.pendingPeers.delete(peerId);
        this.pendingSince.delete(peerId);
        removed.push(peerId);
      }
    }

    this.connected = this.conns.size > 0;
    for (const peerId of removed) {
      this.onPeerClose?.(peerId);
    }
    return removed.length;
  }

  _fullRoomReason() {
    return `部屋が満員です（${this.totalSeats()}人）`;
  }

  async connect() {
    if (this._connecting) return this._connecting;
    this._connecting = this._connect().finally(() => {
      this._connecting = null;
    });
    return this._connecting;
  }

  async _connect() {
    if (typeof Peer === "undefined") {
      this.onStatus("通信の準備に失敗しました。ページを再読み込みしてください");
      throw new Error("PeerJS missing");
    }

    const iceServers = await fetchIceServers((msg) => this.onStatus(msg));

    return new Promise((resolve, reject) => {
      const id = this.role === "host" ? `noodles-${this.roomId}` : undefined;
      this.peer = new Peer(id, {
        debug: 1,
        config: { iceServers },
      });

      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const ok = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      this.peer.on("open", () => {
        this.onStatus(this.role === "host" ? `部屋待機中: ${this.roomId}` : `接続中…`);

        if (this.role === "guest") {
          const hostId = `noodles-${this.roomId}`;
          this.conn = this.peer.connect(hostId, { reliable: true });
          this._bindConn(this.conn, ok, fail);

          window.setTimeout(() => {
            if (settled || this.connected) return;
            this.onStatus(
              "接続がタイムアウトしました。ホストがゲーム画面を開いているか確認し、モバイル回線や別Wi-Fiを試してください"
            );
            try {
              this.conn?.close();
            } catch (_) {
              /* ignore */
            }
            fail(Object.assign(new Error("guest connect timeout"), { type: "timeout" }));
          }, GUEST_CONNECT_TIMEOUT_MS);
        } else {
          ok(this.roomId);
        }
      });

      this.peer.on("connection", (conn) => {
        if (this.role !== "host") return;
        this._pruneDeadConns();

        if (conn.peer && this.conns.has(conn.peer)) {
          try {
            this.conns.get(conn.peer)?.close();
          } catch (_) {
            /* ignore */
          }
          this._releasePeer(conn.peer, { notify: false });
        }

        this._pruneDeadConns();
        if (this._slotCount() >= this.maxGuests) {
          conn.on("open", () => {
            try {
              conn.send({ type: "error", reason: this._fullRoomReason() });
            } catch (_) {
              /* ignore */
            }
            conn.close();
          });
          return;
        }

        if (conn.peer) {
          this.pendingPeers.add(conn.peer);
          this.pendingSince.set(conn.peer, Date.now());
        }
        this._bindHostConn(conn);
        this.onStatus(`ゲスト接続 ${this._slotCount()}/${this.maxGuests}`);
      });

      this.peer.on("error", (err) => {
        if (this._dead) return;
        this.onStatus(friendlyPeerError(err));
        fail(err);
      });

      this.peer.on("disconnected", () => {
        if (this._dead || !this.peer || this.peer.destroyed) return;
        this.onStatus("通信が不安定です。つなぎ直しています…");
        try {
          this.peer.reconnect();
        } catch (_) {
          /* ignore */
        }
      });
    });
  }

  /**
   * Reclaim the same room Peer ID after the tab returns to the foreground.
   * Does not treat backgrounding as room end.
   */
  async resumeHost() {
    if (this.role !== "host") return false;
    this._pruneDeadConns();
    if (this.peer && !this.peer.destroyed) {
      if (this.peer.disconnected) {
        try {
          this.peer.reconnect();
          this.onStatus("通信が不安定です。つなぎ直しています…");
          return true;
        } catch (e) {
          console.warn("peer.reconnect failed", e);
        }
      } else {
        return true;
      }
    }

    try {
      this._dead = true;
      this.peer?.destroy();
    } catch (_) {
      /* ignore */
    }
    this._dead = false;
    this.peer = null;
    this.conns.clear();
    this.pendingPeers.clear();
    this.pendingSince.clear();
    this.connected = false;
    await this.connect();
    return true;
  }

  _bindHostConn(conn) {
    conn.on("open", () => {
      if (conn.peer) {
        this.pendingPeers.delete(conn.peer);
        this.pendingSince.delete(conn.peer);
      }
      this.conns.set(conn.peer, conn);
      this.connected = this.conns.size > 0;
      this.onStatus(`接続中 ${this.conns.size} 人`);
    });
    conn.on("data", (data) => {
      try {
        const msg = typeof data === "string" ? JSON.parse(data) : data;
        this.onMessage(msg, { peerId: conn.peer });
      } catch (e) {
        console.warn("bad message", e);
      }
    });
    conn.on("close", () => {
      this._releasePeer(conn.peer);
      this.onStatus(`切断（残り接続 ${this.conns.size}）`);
    });
    conn.on("error", () => {
      this._releasePeer(conn.peer);
    });
  }

  _bindConn(conn, resolve, reject) {
    conn.on("open", () => {
      this.connected = true;
      this.onStatus("つながりました");
      resolve(this.roomId);
    });
    conn.on("data", (data) => {
      try {
        this.onMessage(typeof data === "string" ? JSON.parse(data) : data);
      } catch (e) {
        console.warn("bad message", e);
      }
    });
    conn.on("close", () => {
      this.connected = false;
      this.onStatus("接続が切れました。同じ部屋なら再接続できます");
      this.onConnClose?.();
    });
    conn.on("error", (err) => {
      this.onStatus(friendlyPeerError(err));
      reject(err);
    });
  }

  send(msg) {
    if (this.role === "guest") {
      if (!this.conn || !this.connected) return false;
      this.conn.send(msg);
      return true;
    }
    let ok = false;
    for (const c of this.conns.values()) {
      try {
        c.send(msg);
        ok = true;
      } catch (_) {
        /* ignore */
      }
    }
    return ok;
  }

  sendToPeer(peerId, msg) {
    const c = this.conns.get(peerId);
    if (!c) return false;
    c.send(msg);
    return true;
  }

  sendEach(fn) {
    for (const [peerId, c] of this.conns) {
      const msg = fn(peerId);
      if (msg) c.send(msg);
    }
  }

  destroy() {
    this._dead = true;
    this.onStatus = () => {};
    this.onMessage = () => {};
    this.onPeerClose = null;
    this.onConnClose = null;
    try {
      for (const c of this.conns.values()) c.close();
      this.conns.clear();
      this.pendingPeers.clear();
      this.pendingSince.clear();
      if (this.conn) this.conn.close();
      if (this.peer && !this.peer.destroyed) this.peer.destroy();
    } catch (_) {
      /* ignore */
    }
  }
}
