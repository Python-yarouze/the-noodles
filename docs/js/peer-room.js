/**
 * PeerJS room helpers — host can hold multiple guest connections.
 * Uses Open Relay (Metered) TURN when TURN_CREDENTIALS_URL is set in ice-config.js.
 */

const GUEST_CONNECT_TIMEOUT_MS = 20000;
const FALLBACK_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
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
    onStatus?.("TURN未設定 — STUNのみで接続を試行");
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
    onStatus?.("TURN取得失敗 — STUNのみで接続を試行");
    return FALLBACK_ICE_SERVERS;
  }
}

export class PeerRoom {
  /**
   * @param {{ role: 'host'|'guest', roomId?: string, onMessage: (msg:any, meta?: {peerId?:string})=>void, onStatus: (s:string)=>void, maxGuests?: number }} opts
   */
  constructor(opts) {
    this.role = opts.role;
    this.roomId = opts.roomId || makeRoomCode();
    this.onMessage = opts.onMessage;
    this.onStatus = opts.onStatus;
    this.maxGuests = opts.maxGuests ?? 3;
    this.peer = null;
    /** @type {Map<string, any>} peerId -> DataConnection */
    this.conns = new Map();
    /** Peer ids reserved at connection event (before open). */
    this.pendingPeers = new Set();
    this.conn = null; // guest single connection
    this.connected = false;
  }

  _slotCount() {
    return this.conns.size + this.pendingPeers.size;
  }

  _releasePeer(peerId) {
    if (!peerId) return;
    this.pendingPeers.delete(peerId);
    this.conns.delete(peerId);
    this.connected = this.conns.size > 0;
  }

  async connect() {
    if (typeof Peer === "undefined") {
      this.onStatus("PeerJS の読み込みに失敗しました");
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

      this.peer.on("open", (peerId) => {
        this.onStatus(this.role === "host" ? `部屋待機中: ${this.roomId}` : `接続中…`);

        if (this.role === "guest") {
          const hostId = `noodles-${this.roomId}`;
          this.conn = this.peer.connect(hostId, { reliable: true });
          this._bindConn(this.conn, ok, fail);

          window.setTimeout(() => {
            if (settled || this.connected) return;
            this.onStatus(
              "接続がタイムアウトしました。このネットワークではつながりにくいことがあります（モバイル回線や別Wi-Fiを試してください）"
            );
            try {
              this.conn?.close();
            } catch (_) {
              /* ignore */
            }
            fail(new Error("guest connect timeout"));
          }, GUEST_CONNECT_TIMEOUT_MS);
        } else {
          ok(this.roomId);
        }
      });

      this.peer.on("connection", (conn) => {
        if (this.role !== "host") return;
        if (this._slotCount() >= this.maxGuests) {
          conn.on("open", () => {
            try {
              conn.send({ type: "error", reason: "部屋が満員です（最大4人）" });
            } catch (_) {
              /* ignore */
            }
            conn.close();
          });
          return;
        }
        if (conn.peer) this.pendingPeers.add(conn.peer);
        this._bindHostConn(conn);
        this.onStatus(`ゲスト接続 ${this._slotCount()}/${this.maxGuests}`);
      });

      this.peer.on("error", (err) => {
        this.onStatus(`Peer エラー: ${err.type || err.message || err}`);
        fail(err);
      });

      this.peer.on("disconnected", () => {
        this.onStatus("シグナリングから切断。再接続を試行…");
        try {
          this.peer.reconnect();
        } catch (_) {
          /* ignore */
        }
      });
    });
  }

  _bindHostConn(conn) {
    conn.on("open", () => {
      if (conn.peer) this.pendingPeers.delete(conn.peer);
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
      this.onStatus("P2P 接続完了");
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
      this.onStatus("ホストとの接続が切れました。ホストが閉じた部屋は再開できません");
    });
    conn.on("error", (err) => {
      this.onStatus(`接続エラー: ${err.message || err}`);
      reject(err);
    });
  }

  /** Guest send, or host broadcast to all. */
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

  /** Host: send to one peer by PeerJS id, or by matching open connections. */
  sendToPeer(peerId, msg) {
    const c = this.conns.get(peerId);
    if (!c) return false;
    c.send(msg);
    return true;
  }

  /** Host: send personalized message via callback per connection. */
  sendEach(fn) {
    for (const [peerId, c] of this.conns) {
      const msg = fn(peerId);
      if (msg) c.send(msg);
    }
  }

  destroy() {
    try {
      for (const c of this.conns.values()) c.close();
      this.conns.clear();
      this.pendingPeers.clear();
      if (this.conn) this.conn.close();
      if (this.peer) this.peer.destroy();
    } catch (_) {
      /* ignore */
    }
  }
}
