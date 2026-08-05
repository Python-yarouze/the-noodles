/**
 * PeerJS room helpers — host can hold multiple guest connections.
 */

export function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
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
    this.conn = null; // guest single connection
    this.connected = false;
  }

  async connect() {
    if (typeof Peer === "undefined") {
      this.onStatus("PeerJS の読み込みに失敗しました");
      throw new Error("PeerJS missing");
    }

    return new Promise((resolve, reject) => {
      const id = this.role === "host" ? `noodles-${this.roomId}` : undefined;
      this.peer = new Peer(id, { debug: 1 });

      this.peer.on("open", (peerId) => {
        this.onStatus(this.role === "host" ? `部屋待機中: ${this.roomId}` : `接続中…`);

        if (this.role === "guest") {
          const hostId = `noodles-${this.roomId}`;
          this.conn = this.peer.connect(hostId, { reliable: true });
          this._bindConn(this.conn, resolve, reject);
        } else {
          resolve(this.roomId);
        }
      });

      this.peer.on("connection", (conn) => {
        if (this.role !== "host") return;
        if (this.conns.size >= this.maxGuests) {
          conn.on("open", () => {
            conn.send({ type: "error", reason: "部屋が満員です（最大4人）" });
            conn.close();
          });
          return;
        }
        this._bindHostConn(conn);
        this.onStatus(`ゲスト接続 ${this.conns.size}/${this.maxGuests}`);
      });

      this.peer.on("error", (err) => {
        this.onStatus(`Peer エラー: ${err.type || err.message || err}`);
        reject(err);
      });

      this.peer.on("disconnected", () => {
        this.onStatus("シグナリングから切断。再接続を試行…");
        this.peer.reconnect();
      });
    });
  }

  _bindHostConn(conn) {
    conn.on("open", () => {
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
      this.conns.delete(conn.peer);
      this.connected = this.conns.size > 0;
      this.onStatus(`切断（残り接続 ${this.conns.size}）`);
    });
    conn.on("error", () => {
      this.conns.delete(conn.peer);
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
      this.onStatus("ホストとの接続が切れました");
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
      if (this.conn) this.conn.close();
      if (this.peer) this.peer.destroy();
    } catch (_) {
      /* ignore */
    }
  }
}
