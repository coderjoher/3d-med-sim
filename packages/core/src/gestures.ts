import type { Calibration, HandFrame, SemanticEvent, TrackingFrame } from './types.js';
import { applyCalibration, DEFAULT_CALIBRATION } from './calibration.js';

export interface GestureOptions {
  primaryHand?: 'left' | 'right';   // I-08
  pinchOn?: number;                 // normalised thumb-index distance to enter pinch (hysteresis)
  pinchOff?: number;                // ... to leave pinch
  dragThreshold?: number;           // cursor movement (screen units) before a pinch becomes a drag/rotate
  resetHoldMs?: number;             // open palm hold for reset (default 1500)
  handLostMs?: number;              // no hands for this long => hand-lost (default 500)
  calibration?: Calibration;
  smoothing?: boolean;              // one-euro filter on the cursor
}

// MediaPipe hand landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const TIPS = [8, 12, 16, 20];
const PIPS = [6, 10, 14, 18];

function dist(a: { x: number; y: number; z?: number }, b: { x: number; y: number; z?: number }): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}
function dist2d(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Thumb-tip to index-tip distance normalised by hand size (wrist→middle MCP). */
export function pinchDistance(hand: HandFrame): number {
  const lm = hand.landmarks;
  if (!lm || lm.length < 21) return Infinity;
  const size = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
  if (size <= 1e-6) return Infinity;
  return dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / size;
}

/** All four fingers extended. */
export function isOpenPalm(hand: HandFrame): boolean {
  const lm = hand.landmarks;
  if (!lm || lm.length < 21) return false;
  const w = lm[WRIST];
  // A finger is extended when its tip is clearly further from the wrist than its PIP joint.
  return TIPS.every((tip, i) => dist(lm[tip], w) > dist(lm[PIPS[i]], w) * 1.15);
}

interface PinchState {
  active: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
  /** Pinch was used for a two-hand zoom: no select on release. */
  consumed: boolean;
}

const newPinch = (): PinchState => ({ active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, dragging: false, consumed: false });

/**
 * Converts landmark frames into semantic events (I-02, PRD gesture table):
 * index movement -> point; pinch+release without drag -> select; pinch+drag -> rotate;
 * two-hand pinch distance change -> zoom; open palm held >= resetHoldMs -> reset (once per hold);
 * hand-lost / hand-found transitions (I-07).
 *
 * Deterministic: output depends only on the frame sequence (timestamps come from frames).
 */
export class GestureRecognizer {
  private primary: 'left' | 'right';
  private pinchOn: number;
  private pinchOff: number;
  private dragThreshold: number;
  private resetHoldMs: number;
  private handLostMs: number;
  private calibration: Calibration;
  private smoothing: boolean;
  private fx = new OneEuroFilter(1.0, 0.02);
  private fy = new OneEuroFilter(1.0, 0.02);

  private pinch: PinchState = newPinch();
  /** Pinch state per handedness, for hysteresis. */
  private pinching: Record<'Left' | 'Right', boolean> = { Left: false, Right: false };
  private zoomPrevDist: number | null = null;
  private palmSince: number | null = null;
  private palmFired = false;
  private lastSeen: number | null = null;
  private lost = false;

  constructor(opts: GestureOptions = {}) {
    this.primary = opts.primaryHand ?? 'right';
    this.pinchOn = opts.pinchOn ?? 0.35;
    this.pinchOff = opts.pinchOff ?? 0.5;
    if (this.pinchOff < this.pinchOn) this.pinchOff = this.pinchOn;
    this.dragThreshold = opts.dragThreshold ?? 0.03;
    this.resetHoldMs = opts.resetHoldMs ?? 1500;
    this.handLostMs = opts.handLostMs ?? 500;
    this.calibration = opts.calibration ?? { ...DEFAULT_CALIBRATION };
    this.smoothing = opts.smoothing ?? false;
  }

  setCalibration(c: Calibration): void {
    this.calibration = { ...c };
  }

  setPrimaryHand(h: 'left' | 'right'): void {
    if (h !== this.primary) {
      this.primary = h;
      this.pinch = newPinch();
      this.fx.reset();
      this.fy.reset();
    }
  }

  reset(): void {
    this.pinch = newPinch();
    this.pinching = { Left: false, Right: false };
    this.zoomPrevDist = null;
    this.palmSince = null;
    this.palmFired = false;
    this.lastSeen = null;
    this.lost = false;
    this.fx.reset();
    this.fy.reset();
  }

  private isPinching(hand: HandFrame): boolean {
    const d = pinchDistance(hand);
    const was = this.pinching[hand.handedness];
    const now = was ? d < this.pinchOff : d < this.pinchOn;
    this.pinching[hand.handedness] = now;
    return now;
  }

  private choosePrimary(hands: HandFrame[]): HandFrame {
    const want = this.primary === 'left' ? 'Left' : 'Right';
    return hands.find((h) => h.handedness === want) ?? hands[0];
  }

  private cursor(hand: HandFrame, t: number): { x: number; y: number } {
    const p = applyCalibration(this.calibration, hand.landmarks[INDEX_TIP]);
    if (!this.smoothing) return p;
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t) };
  }

  process(frame: TrackingFrame): SemanticEvent[] {
    const out: SemanticEvent[] = [];
    const t = frame.t;
    const hands = (frame.hands ?? []).filter((h) => h.landmarks && h.landmarks.length >= 21);

    if (hands.length === 0) {
      if (this.lastSeen === null) this.lastSeen = t;
      if (!this.lost && t - this.lastSeen >= this.handLostMs) {
        this.lost = true;
        out.push({ type: 'hand-lost', source: 'gesture' });
        // Abandon any in-progress gesture: never emit a select for a hand that vanished.
        this.pinch = newPinch();
        this.pinching = { Left: false, Right: false };
        this.zoomPrevDist = null;
        this.palmSince = null;
        this.palmFired = false;
        this.fx.reset();
        this.fy.reset();
      }
      return out;
    }

    this.lastSeen = t;
    if (this.lost) {
      this.lost = false;
      out.push({ type: 'hand-found', source: 'gesture' });
    }

    // Update pinch hysteresis for every visible hand; forget hands that disappeared.
    const pinchByHand = new Map<HandFrame, boolean>();
    for (const h of hands) pinchByHand.set(h, this.isPinching(h));
    for (const side of ['Left', 'Right'] as const) if (!hands.some((h) => h.handedness === side)) this.pinching[side] = false;

    const primary = this.choosePrimary(hands);
    const cur = this.cursor(primary, t);
    const pinchingHands = hands.filter((h) => pinchByHand.get(h));

    // --- two-hand zoom
    if (hands.length >= 2 && pinchingHands.length >= 2) {
      const [a, b] = pinchingHands;
      const d = dist2d(a.landmarks[INDEX_TIP], b.landmarks[INDEX_TIP]);
      if (this.zoomPrevDist !== null && this.zoomPrevDist > 1e-6 && d > 1e-6) {
        const factor = d / this.zoomPrevDist;
        if (Math.abs(factor - 1) > 1e-3) out.push({ type: 'zoom', factor, source: 'gesture' });
      }
      this.zoomPrevDist = d;
      if (this.pinch.active) this.pinch.consumed = true;
      else this.pinch = { ...newPinch(), active: true, consumed: true };
      this.palmSince = null;
      return out;
    }
    this.zoomPrevDist = null;

    out.push({ type: 'point', x: cur.x, y: cur.y, source: 'gesture' });

    // --- single-hand pinch: select / rotate
    const primaryPinching = pinchByHand.get(primary) ?? false;
    const p = this.pinch;
    if (primaryPinching) {
      if (!p.active) {
        this.pinch = { active: true, startX: cur.x, startY: cur.y, lastX: cur.x, lastY: cur.y, dragging: false, consumed: false };
      } else if (!p.consumed) {
        if (!p.dragging && Math.hypot(cur.x - p.startX, cur.y - p.startY) >= this.dragThreshold) {
          p.dragging = true;
          out.push({ type: 'rotate', dx: cur.x - p.startX, dy: cur.y - p.startY, source: 'gesture' });
        } else if (p.dragging) {
          const dx = cur.x - p.lastX;
          const dy = cur.y - p.lastY;
          if (dx !== 0 || dy !== 0) out.push({ type: 'rotate', dx, dy, source: 'gesture' });
        }
        p.lastX = cur.x;
        p.lastY = cur.y;
      }
    } else if (p.active) {
      if (!p.dragging && !p.consumed) out.push({ type: 'select', x: p.startX, y: p.startY, source: 'gesture' });
      this.pinch = newPinch();
    }

    // --- open palm hold: reset (once per hold)
    const palm = hands.some((h) => !pinchByHand.get(h) && isOpenPalm(h));
    if (palm) {
      if (this.palmSince === null) this.palmSince = t;
      if (!this.palmFired && t - this.palmSince >= this.resetHoldMs) {
        this.palmFired = true;
        out.push({ type: 'reset', source: 'gesture' });
      }
    } else {
      this.palmSince = null;
      this.palmFired = false;
    }
    return out;
  }
}

/** One-euro filter for jitter reduction. */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.007,
    private dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tMs: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = value;
      this.tPrev = tMs;
      this.dxPrev = 0;
      return value;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
    this.tPrev = tMs;
    const dx = (value - this.xPrev) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter.alpha(cutoff, dt);
    const xHat = a * value + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.tPrev = null;
    this.dxPrev = 0;
  }
}
