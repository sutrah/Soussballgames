// Petite couche WebRTC P2P au-dessus de PeerJS : un code de room, aucun compte,
// aucun serveur de jeu à héberger (seul le broker public PeerJS sert à la
// signalisation initiale ; toutes les données de jeu passent en direct entre
// les deux navigateurs).

const PEERJS_CDN = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
let peerjsLoaded = null;

function loadPeerJs() {
  if (peerjsLoaded) return peerjsLoaded;
  peerjsLoaded = new Promise((resolve, reject) => {
    if (window.Peer) return resolve();
    const script = document.createElement("script");
    script.src = PEERJS_CDN;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Impossible de charger PeerJS"));
    document.head.appendChild(script);
  });
  return peerjsLoaded;
}

function randomCode(len = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export class PeerRoom {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'guest'
    this.code = null;
    this._listeners = new Set();
    this._statusListeners = new Set();
  }

  onMessage(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  onStatus(cb) { this._statusListeners.add(cb); return () => this._statusListeners.delete(cb); }
  _emitStatus(s, detail) { for (const cb of this._statusListeners) cb(s, detail); }

  async host() {
    await loadPeerJs();
    this.role = "host";
    this.code = "SBG-" + randomCode();
    this._emitStatus("connecting-broker");
    return new Promise((resolve, reject) => {
      this.peer = new window.Peer(this.code);
      this.peer.on("open", () => this._emitStatus("waiting-peer", this.code));
      this.peer.on("connection", (conn) => {
        this.conn = conn;
        this._wireConn(conn);
        conn.on("open", () => { this._emitStatus("connected"); resolve(); });
      });
      this.peer.on("error", (err) => { this._emitStatus("error", err); reject(err); });
    });
  }

  async join(code) {
    await loadPeerJs();
    this.role = "guest";
    this.code = code.trim().toUpperCase();
    this._emitStatus("connecting-broker");
    return new Promise((resolve, reject) => {
      this.peer = new window.Peer();
      this.peer.on("open", () => {
        this._emitStatus("connecting-peer");
        const conn = this.peer.connect(this.code, { reliable: true });
        this.conn = conn;
        this._wireConn(conn);
        conn.on("open", () => { this._emitStatus("connected"); resolve(); });
      });
      this.peer.on("error", (err) => { this._emitStatus("error", err); reject(err); });
    });
  }

  _wireConn(conn) {
    conn.on("data", (msg) => { for (const cb of this._listeners) cb(msg); });
    conn.on("close", () => this._emitStatus("disconnected"));
    conn.on("error", (err) => this._emitStatus("error", err));
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  close() {
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
  }
}
