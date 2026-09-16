// Petite couche WebRTC P2P au-dessus de PeerJS : un code de room, aucun compte,
// aucun serveur de jeu à héberger (seul le broker public PeerJS sert à la
// signalisation initiale ; toutes les données de jeu passent en direct entre
// les navigateurs). Topologie en étoile : chaque invité ne se connecte qu'à
// l'hôte, qui relaie — jusqu'à 5 joueurs au total (hôte = siège 0, invités
// = sièges 1..4), réutilisable par n'importe quel jeu à plusieurs (room,
// combat 1v1...).

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
    this.role = null; // 'host' | 'guest'
    this.code = null;
    this.maxPlayers = 5;
    this.mySeat = 0; // l'hôte est toujours le siège 0
    this.conns = new Map(); // hôte : siège (1..4) -> DataConnection ; invité : 0 -> DataConnection (vers l'hôte)
    this._nextSeat = 1; // hôte seulement
    this._listeners = new Set(); // (msg, fromSeat) => void
    this._statusListeners = new Set();
    this._rosterListeners = new Set(); // (seats:number[]) => void
  }

  onMessage(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  onStatus(cb) { this._statusListeners.add(cb); return () => this._statusListeners.delete(cb); }
  onRoster(cb) { this._rosterListeners.add(cb); return () => this._rosterListeners.delete(cb); }
  _emitStatus(s, detail) { for (const cb of this._statusListeners) cb(s, detail); }
  _emitRoster() {
    const seats = this.seats;
    for (const cb of this._rosterListeners) cb(seats);
  }

  /** Sièges actuellement connectés (l'hôte les connaît tous ; un invité ne connaît que lui-même + l'hôte). */
  get seats() {
    if (this.role === "host") return [0, ...this.conns.keys()].sort((a, b) => a - b);
    return [0, this.mySeat];
  }

  async host(maxPlayers = 5) {
    await loadPeerJs();
    this.role = "host";
    this.maxPlayers = Math.max(2, Math.min(5, maxPlayers));
    this.mySeat = 0;
    this.code = "SBG-" + randomCode();
    this._emitStatus("connecting-broker");
    return new Promise((resolve, reject) => {
      this.peer = new window.Peer(this.code);
      this.peer.on("open", () => { this._emitStatus("waiting-peer", this.code); resolve(); });
      this.peer.on("connection", (conn) => {
        if (this.conns.size >= this.maxPlayers - 1) { conn.close(); return; } // room pleine
        const seat = this._nextSeat++;
        this.conns.set(seat, conn);
        this._wireConn(conn, seat);
        conn.on("open", () => {
          conn.send({ __seat: seat });
          this._emitRoster();
          this._emitStatus("peer-joined", seat);
        });
        conn.on("close", () => { this.conns.delete(seat); this._emitRoster(); this._emitStatus("peer-left", seat); });
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
        this.conns.set(0, conn);
        let seatAssigned = false;
        conn.on("data", (msg) => {
          if (!seatAssigned && msg && typeof msg.__seat === "number") {
            seatAssigned = true;
            this.mySeat = msg.__seat;
            this._emitStatus("connected");
            resolve();
            return;
          }
          for (const cb of this._listeners) cb(msg, 0);
        });
        conn.on("close", () => this._emitStatus("disconnected"));
        conn.on("error", (err) => this._emitStatus("error", err));
      });
      this.peer.on("error", (err) => { this._emitStatus("error", err); reject(err); });
    });
  }

  _wireConn(conn, seat) {
    conn.on("data", (msg) => { for (const cb of this._listeners) cb(msg, seat); });
    conn.on("error", (err) => this._emitStatus("error", err));
  }

  /** Diffuse à tout le monde (hôte : à tous les invités ; invité : à l'hôte seulement). */
  send(msg) {
    for (const conn of this.conns.values()) if (conn.open) conn.send(msg);
  }

  close() {
    for (const conn of this.conns.values()) conn.close();
    if (this.peer) this.peer.destroy();
  }
}
