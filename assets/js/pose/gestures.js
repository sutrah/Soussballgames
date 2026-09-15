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
