// Primitives réutilisables pour transformer des points de pose bruts
// en gestes de jeu : pas, saut, accroupissement, inclinaison, position latérale...

/** Lissage exponentiel simple. */
export class EMA {
  constructor(alpha = 0.3, initial = null) {
    this.alpha = alpha;
    this.value = initial;
  }
  push(x) {
    if (x == null) return this.value;
    this.value = this.value == null ? x : this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }
}

/** Suit une moyenne glissante lente pour servir de "ligne de repos" (baseline). */
export class Baseline {
  constructor(alpha = 0.02) {
    this.ema = new EMA(alpha);
  }
  update(x) { return this.ema.push(x); }
  get value() { return this.ema.value; }
}

/**
 * Détecteur de front montant avec hystérésis : déclenche "on" quand le signal
 * dépasse `high`, se réarme quand il repasse sous `low`. Sert pour les pas,
 * sauts, tapes de pied, etc.
 */
export class EdgeTrigger {
  constructor(low, high, cooldownMs = 150) {
    this.low = low;
    this.high = high;
    this.cooldownMs = cooldownMs;
    this.armed = true;
    this.last = 0;
  }
  update(value, t = performance.now()) {
    if (this.armed && value >= this.high && t - this.last > this.cooldownMs) {
      this.armed = false;
      this.last = t;
      return true;
    }
    if (!this.armed && value <= this.low) {
      this.armed = true;
    }
    return false;
  }
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Angle (radians) de la ligne épaules par rapport à l'horizontale. Positif = penché à droite. */
export function shoulderTilt(lm, LM) {
  const l = lm[LM.L_SHOULDER], r = lm[LM.R_SHOULDER];
  return Math.atan2(r.y - l.y, r.x - l.x);
}

/** Score [0..1] de "levée de genou" le plus haut des deux jambes, relatif à la hanche. */
export function kneeLift(lm, LM) {
  const hipY = mid(lm[LM.L_HIP], lm[LM.R_HIP]).y;
  const kneeY = Math.min(lm[LM.L_KNEE].y, lm[LM.R_KNEE].y);
  return Math.max(0, (hipY - kneeY));
}

export function visible(lm, indices, min = 0.4) {
  return indices.every((i) => (lm[i]?.v ?? 0) >= min);
}

/** { left, right } : true si le poignet correspondant est nettement au-dessus de l'épaule. */
export function handsRaised(lm, LM, margin = 0.08) {
  return {
    left: lm[LM.L_WRIST].y < lm[LM.L_SHOULDER].y - margin,
    right: lm[LM.R_WRIST].y < lm[LM.R_SHOULDER].y - margin,
  };
}

/** Vrai si les deux poignets sont écartés bien au-delà de la largeur des épaules (bras en croix). */
export function armsSpread(lm, LM, ratio = 2.1) {
  const shoulderW = dist(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]) || 1;
  const wristW = dist(lm[LM.L_WRIST], lm[LM.R_WRIST]);
  return wristW / shoulderW > ratio;
}

/** Zone latérale (-1 gauche, 0 centre, 1 droite) à partir d'un x normalisé, avec hystérésis. */
export function lateralZone(x, prevZone = 0, { enter = 0.14, exit = 0.08 } = {}) {
  const center = 0.5;
  if (prevZone <= -1 && x < center - exit) return -1;
  if (prevZone >= 1 && x > center + exit) return 1;
  if (x < center - enter) return -1;
  if (x > center + enter) return 1;
  if (Math.abs(x - center) < exit) return 0;
  return prevZone;
}

/**
 * Score [0..1] d'extension du coude (0 = bras plié en garde, 1 = bras tendu),
 * via la loi des cosinus sur épaule-coude-poignet. Combiné à un `EdgeTrigger`
 * sur ce signal, ça détecte le geste de "coup de poing" (garde pliée → bras
 * tendu). Utilisé seul, un bras tendu au repos (le long du corps) donnerait
 * aussi un score proche de 1 : on ne s'appuie donc que sur le FRONT montant
 * (le passage garde → extension), jamais sur l'état statique.
 */
export function elbowExtension(lm, LM, side) {
  const sh = lm[side === "left" ? LM.L_SHOULDER : LM.R_SHOULDER];
  const el = lm[side === "left" ? LM.L_ELBOW : LM.R_ELBOW];
  const wr = lm[side === "left" ? LM.L_WRIST : LM.R_WRIST];
  const upper = dist(sh, el) || 1e-4;
  const fore = dist(el, wr) || 1e-4;
  const span = dist(sh, wr);
  const cosAngle = (upper * upper + fore * fore - span * span) / (2 * upper * fore);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle))); // 0 (plié) .. π (tendu)
  return angle / Math.PI;
}
