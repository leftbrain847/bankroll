/**
 * The Bankroll board: a square track of 40 spaces around the edge of a printed board, set on a tabletop.
 * Start sits in the bottom-right corner and play runs clockwise (left along the bottom first). Each street carries its set colour as a block on the
 * outer edge with its mark and price; the owner's flag sits on the inner edge; houses and hotels sit on the colour
 * block. Tokens are game pieces that hop from space to space. Canvas only: no images, fonts or files.
 */
import { BOARD, BOARD_SIZE, priceOf, type Space } from '../game/board';
import type { GameState } from '../game/rules';

export const TOKENS = [
  { name: 'Red', color: '#e4572e' },
  { name: 'Green', color: '#2e8b57' },
  { name: 'Blue', color: '#2d6cdf' },
  { name: 'Pink', color: '#c2368f' },
  { name: 'Gold', color: '#e6a100' },
  { name: 'Purple', color: '#7b4fd6' },
];

/** Board print colours. */
const INK = '#2b2118';
const FACE = '#f2e8d0';
const FACE_DARK = '#e6d8b6';
const LINE = 'rgba(43,33,24,0.55)';

export interface BoardView {
  canvas: HTMLCanvasElement;
  update(s: GameState, selected: number | null): void;
  /** Resolves once tokens have finished moving. */
  settled(): Promise<void>;
  destroy(): void;
}

const STEP_MS = 95;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which way is "outward" for this space: 0 top, 1 right, 2 bottom, 3 left; -1 for corners. */
  side: number;
}

export function createBoardView(onTap: (pos: number) => void, onStep: () => void): BoardView {
  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The game board. Tap a space for details.');
  const g = canvas.getContext('2d');
  let size = 0;
  let state: GameState | null = null;
  let sel: number | null = null;
  let shown: number[] = [];
  let raf = 0;
  let last = 0;
  let waiters: (() => void)[] = [];

  /** Corner size c and cell width w: size = 2c + 9w, with corners 1.55 cells deep. */
  const geom = () => {
    const w = size / (9 + 2 * 1.55);
    const c = w * 1.55;
    return { w, c };
  };

  /** Start sits in the bottom-right corner and play runs left along the bottom, then clockwise. */
  function rectOf(pos: number): Rect {
    const r = baseRect(pos);
    const flip = [2, 3, 0, 1];
    return { x: size - r.x - r.w, y: size - r.y - r.h, w: r.w, h: r.h, side: r.side < 0 ? -1 : flip[r.side]! };
  }

  /** The layout with Start at the top-left, play running right along the top; rectOf turns it half a turn. */
  function baseRect(pos: number): Rect {
    const { w, c } = geom();
    const side = Math.floor(pos / 10);
    const k = pos % 10;
    const far = c + 9 * w;
    if (k === 0) {
      const xy: [number, number][] = [[0, 0], [far, 0], [far, far], [0, far]];
      const [x, y] = xy[side]!;
      return { x, y, w: c, h: c, side: -1 };
    }
    if (side === 0) return { x: c + (k - 1) * w, y: 0, w, h: c, side: 0 };
    if (side === 1) return { x: far, y: c + (k - 1) * w, w: c, h: w, side: 1 };
    if (side === 2) return { x: c + (9 - k) * w, y: far, w, h: c, side: 2 };
    return { x: 0, y: c + (9 - k) * w, w: c, h: w, side: 3 };
  }

  const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

  function resize(): void {
    const w = Math.min(canvas.parentElement?.clientWidth ?? 360, 560);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    size = w;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${w}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    g?.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function poly(pts: [number, number][]): void {
    if (!g) return;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }

  type Shape = 'circle' | 'triangle' | 'square' | 'diamond' | 'hex' | 'star';
  function shape(kind: Shape, x: number, y: number, r: number): void {
    if (!g) return;
    if (kind === 'circle') {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      return;
    }
    const n = kind === 'triangle' ? 3 : kind === 'square' || kind === 'diamond' ? 4 : kind === 'hex' ? 6 : 10;
    const rot = kind === 'square' ? Math.PI / 4 : kind === 'diamond' ? 0 : -Math.PI / 2;
    poly(Array.from({ length: n }, (_, i) => {
      const rr = kind === 'star' && i % 2 ? r * 0.45 : r;
      const a = rot + (i / n) * Math.PI * 2;
      return [x + Math.cos(a) * rr, y + Math.sin(a) * rr] as [number, number];
    }));
  }
  const TOKEN_SHAPES: Shape[] = ['circle', 'triangle', 'square', 'diamond', 'hex', 'star'];

  function text(t: string, x: number, y: number, px: number, color = INK, weight = 600): void {
    if (!g) return;
    g.fillStyle = color;
    g.font = `${weight} ${px}px ui-rounded, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, x, y);
  }

  /** Original corner art, drawn in ink on the board face. */
  function cornerArt(sp: Extract<Space, { kind: 'corner' }>, r: Rect): void {
    if (!g) return;
    const [x, y] = centre(r);
    const s = r.w;
    g.strokeStyle = INK;
    g.fillStyle = INK;
    g.lineWidth = Math.max(1.5, s * 0.035);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (sp.corner === 'start') {
      // A bold arrow sweeping in the direction of play, over a band of money green.
      g.fillStyle = '#2e8b57';
      g.fillRect(r.x + s * 0.12, y + s * 0.18, s * 0.76, s * 0.12);
      g.fillStyle = INK;
      // The arrow points left: from Start, play runs left along the bottom edge.
      poly([[x + s * 0.3, y - s * 0.12], [x - s * 0.12, y - s * 0.12], [x - s * 0.12, y - s * 0.24], [x - s * 0.34, y - s * 0.04], [x - s * 0.12, y + s * 0.16], [x - s * 0.12, y + s * 0.04], [x + s * 0.3, y + s * 0.04]]);
      g.fill();
      text('START', x, r.y + s * 0.2, s * 0.17, INK, 800);
      text('collect salary', x, r.y + s * 0.88, s * 0.085, INK, 500);
    } else if (sp.corner === 'jail') {
      // A padlock.
      g.beginPath();
      g.arc(x, y - s * 0.02, s * 0.13, Math.PI, 0);
      g.stroke();
      g.fillRect(x - s * 0.2, y - s * 0.02, s * 0.4, s * 0.3);
      g.fillStyle = FACE;
      shape('circle', x, y + s * 0.1, s * 0.04);
      g.fill();
      g.fillRect(x - s * 0.015, y + s * 0.1, s * 0.03, s * 0.09);
      g.fillStyle = INK;
      text('JAIL', x, r.y + s * 0.16, s * 0.15, INK, 800);
      text('passing by is fine', x, r.y + s * 0.88, s * 0.085, INK, 500);
    } else if (sp.corner === 'rest') {
      // A park bench.
      g.fillRect(x - s * 0.28, y - s * 0.06, s * 0.56, s * 0.05);
      g.fillRect(x - s * 0.28, y + s * 0.04, s * 0.56, s * 0.05);
      g.fillRect(x - s * 0.3, y + s * 0.12, s * 0.6, s * 0.05);
      g.fillRect(x - s * 0.24, y + s * 0.12, s * 0.04, s * 0.14);
      g.fillRect(x + s * 0.2, y + s * 0.12, s * 0.04, s * 0.14);
      text('REST STOP', x, r.y + s * 0.18, s * 0.13, INK, 800);
      text('nothing happens', x, r.y + s * 0.86, s * 0.085, INK, 500);
    } else {
      // A rooftop siren light with rays.
      g.fillStyle = '#c0392b';
      g.beginPath();
      g.arc(x, y + s * 0.12, s * 0.15, Math.PI, 0);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = INK;
      g.fillRect(x - s * 0.22, y + s * 0.12, s * 0.44, s * 0.07);
      for (const a of [-2.6, -2.1, -1.57, -1.05, -0.55]) {
        g.beginPath();
        g.moveTo(x + Math.cos(a) * s * 0.21, y + s * 0.12 + Math.sin(a) * s * 0.21);
        g.lineTo(x + Math.cos(a) * s * 0.3, y + s * 0.12 + Math.sin(a) * s * 0.3);
        g.stroke();
      }
      text('ARRESTED', x, r.y + s * 0.15, s * 0.14, INK, 800);
      text('go to Jail', x, r.y + s * 0.86, s * 0.09, INK, 500);
    }
  }

  /** Split a cell into its outer band (colour block) and inner area, given its side. */
  function bands(r: Rect, share: number): { outer: Rect; inner: Rect } {
    if (r.side === 0) return { outer: { ...r, h: r.h * share }, inner: { ...r, y: r.y + r.h * share, h: r.h * (1 - share) } };
    if (r.side === 2) return { outer: { ...r, y: r.y + r.h * (1 - share), h: r.h * share }, inner: { ...r, h: r.h * (1 - share) } };
    if (r.side === 1) return { outer: { ...r, x: r.x + r.w * (1 - share), w: r.w * share }, inner: { ...r, w: r.w * (1 - share) } };
    return { outer: { ...r, w: r.w * share }, inner: { ...r, x: r.x + r.w * share, w: r.w * (1 - share) } };
  }

  function icon(sp: Space, x: number, y: number, s: number): void {
    if (!g) return;
    g.strokeStyle = INK;
    g.fillStyle = INK;
    g.lineWidth = 1.4;
    if (sp.kind === 'subway') {
      shape('diamond', x, y, s);
      g.stroke();
      shape('circle', x, y, s * 0.4);
      g.stroke();
    } else if (sp.kind === 'utility') {
      shape('hex', x, y, s);
      g.stroke();
      shape('circle', x, y, s * 0.35);
      g.fill();
    } else if (sp.kind === 'draw') {
      if (sp.deck === 'news') {
        for (const k of [0.45, 0.85]) {
          g.beginPath();
          g.arc(x - s * 0.45, y + s * 0.45, s * k * 1.2, -Math.PI / 2, 0);
          g.stroke();
        }
        shape('circle', x - s * 0.45, y + s * 0.45, s * 0.14);
        g.fill();
      } else {
        g.strokeRect(x - s * 0.7, y - s * 0.5, s * 1.4, s);
        g.beginPath();
        g.moveTo(x - s * 0.7, y - s * 0.1);
        g.lineTo(x + s * 0.7, y - s * 0.1);
        g.stroke();
      }
    } else if (sp.kind === 'levy') {
      shape('circle', x, y, s * 0.85);
      g.stroke();
      text('%', x, y + 0.5, s * 1.05, INK, 800);
    }
  }

  const shortName = (sp: Space): string => {
    if (sp.kind === 'draw') return sp.name.toUpperCase();
    if (sp.kind === 'levy') return sp.name.split(' ')[0]!.toUpperCase();
    if (sp.kind === 'subway') return sp.name.split(' ')[0]!.toUpperCase();
    if (sp.kind === 'utility') return sp.name.split(' ')[0]!.toUpperCase();
    return sp.name;
  };

  function draw(): void {
    if (!g || !state) return;
    const s = state;
    const { w, c } = geom();
    g.clearRect(0, 0, size, size);
    // Board face with a printed inner panel.
    g.fillStyle = FACE;
    g.fillRect(0, 0, size, size);
    g.fillStyle = FACE_DARK;
    g.fillRect(c, c, 9 * w, 9 * w);
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.strokeRect(1, 1, size - 2, size - 2);
    g.strokeRect(c, c, 9 * w, 9 * w);
    // A quiet diamond lattice printed on the inner panel (decoration, not a logo).
    g.save();
    g.beginPath();
    g.rect(c, c, 9 * w, 9 * w);
    g.clip();
    g.strokeStyle = 'rgba(43,33,24,0.07)';
    g.lineWidth = 1;
    for (let k = -9; k <= 18; k++) {
      g.beginPath();
      g.moveTo(c + k * w, c);
      g.lineTo(c + k * w + 9 * w, c + 9 * w);
      g.moveTo(c + k * w, c + 9 * w);
      g.lineTo(c + k * w + 9 * w, c);
      g.stroke();
    }
    g.restore();

    const fs = Math.max(6.5, w * 0.24);
    BOARD.spaces.forEach((sp, pos) => {
      const r = rectOf(pos);
      g.strokeStyle = LINE;
      g.lineWidth = 1;
      g.strokeRect(r.x, r.y, r.w, r.h);
      if (sel === pos) {
        g.fillStyle = 'rgba(255,214,102,0.45)';
        g.fillRect(r.x, r.y, r.w, r.h);
      }
      if (sp.kind === 'corner') {
        cornerArt(sp, r);
        return;
      }
      const vertical = r.side === 0 || r.side === 2;
      if (sp.kind === 'lot') {
        const grp = BOARD.groups[sp.group]!;
        const { outer, inner } = bands(r, 0.34);
        g.fillStyle = grp.color;
        g.fillRect(outer.x, outer.y, outer.w, outer.h);
        g.strokeStyle = LINE;
        g.strokeRect(outer.x, outer.y, outer.w, outer.h);
        const [ox, oy] = centre(outer);
        const lvl = s.level[pos] ?? 0;
        if (lvl === 5) {
          g.fillStyle = '#fff';
          g.strokeStyle = INK;
          g.lineWidth = 1;
          shape('star', ox, oy, Math.min(outer.w, outer.h) * 0.36);
          g.fill();
          g.stroke();
        } else if (lvl > 0) {
          const span = (vertical ? outer.w : outer.h) * 0.8;
          for (let i = 0; i < lvl; i++) {
            const t = (i + 0.5) / lvl - 0.5;
            const bx = vertical ? ox + t * span : ox;
            const by = vertical ? oy : oy + t * span;
            const d = Math.min(outer.w, outer.h) * 0.22;
            g.fillStyle = '#fffaf0';
            g.strokeStyle = INK;
            g.lineWidth = 1;
            g.beginPath();
            g.arc(bx, by + d * 0.4, d, Math.PI, 0);
            g.closePath();
            g.fill();
            g.stroke();
          }
        } else {
          text(grp.mark, ox, oy + 0.5, Math.min(outer.w, outer.h) * 0.55, grp.color === '#2b2d3a' ? '#fff' : 'rgba(20,14,8,0.7)', 700);
        }
        const [ix, iy] = centre(inner);
        // Name and price, written along the cell.
        g.save();
        g.translate(ix, iy);
        if (!vertical) g.rotate(r.side === 1 ? -Math.PI / 2 : Math.PI / 2);
        const len = vertical ? inner.h : inner.w;
        const words = sp.name.split(' ');
        const lines = words.length > 1 ? [words.slice(0, -1).join(' '), words.at(-1)!] : [sp.name];
        lines.forEach((ln, i) => text(ln, 0, -len * 0.2 + i * fs * 1.05, fs * 0.85, INK, 600));
        text(`$${priceOf(sp)}`, 0, len * 0.32, fs * 0.9, INK, 700);
        g.restore();
      } else {
        const [x, y] = centre(r);
        g.save();
        g.translate(x, y);
        if (!vertical) g.rotate(r.side === 1 ? -Math.PI / 2 : Math.PI / 2);
        const len = vertical ? r.h : r.w;
        const across = vertical ? r.w : r.h;
        g.translate(-x, -y);
        text(shortName(sp), x, y - len * 0.33, fs * 0.8, INK, 800);
        icon(sp, x, y + len * 0.02, across * 0.28);
        const price = priceOf(sp) || (sp.kind === 'levy' ? sp.amount : 0);
        if (price) text(sp.kind === 'levy' ? `pay $${price}` : `$${price}`, x, y + len * 0.34, fs * 0.85, INK, 700);
        g.restore();
      }
      // Owner flag on the inner edge, and a mortgage stamp.
      const o = s.owner[pos];
      if (o !== null && o !== undefined) {
        const col = TOKENS[s.players[o]?.token ?? 0]?.color ?? INK;
        const t = Math.min(r.w, r.h) * 0.2;
        const fx = r.side === 1 ? r.x + 1 : r.side === 3 ? r.x + r.w - t - 1 : r.x + 1;
        const fy = r.side === 0 ? r.y + r.h - t - 1 : r.side === 2 ? r.y + 1 : r.y + 1;
        g.fillStyle = col;
        g.fillRect(fx, fy, t, t);
        g.strokeStyle = INK;
        g.lineWidth = 1;
        g.strokeRect(fx, fy, t, t);
        if (s.mortgaged[pos]) {
          g.fillStyle = 'rgba(242,232,208,0.6)';
          g.fillRect(r.x, r.y, r.w, r.h);
          g.strokeStyle = '#b3261e';
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(r.x + 3, r.y + 3);
          g.lineTo(r.x + r.w - 3, r.y + r.h - 3);
          g.stroke();
        }
      }
    });

    // Tokens: game pieces on the inner half of their space, fanned when they share one.
    const live = s.players.map((p, i) => ({ p, i })).filter(({ p }) => !p.bankrupt);
    const at = new Map<number, number[]>();
    for (const { i, p } of live) {
      const k = Math.round(shown[i] ?? p.pos) % BOARD_SIZE;
      at.set(k, [...(at.get(k) ?? []), i]);
    }
    const tok = Math.max(5.5, w * 0.24);
    for (const { p, i } of live) {
      const d = shown[i] ?? p.pos;
      const lo = Math.floor(d) % BOARD_SIZE;
      const hi = (lo + 1) % BOARD_SIZE;
      const f = d - Math.floor(d);
      const [ax, ay] = centre(rectOf(lo));
      const [bx, by] = centre(rectOf(hi));
      let x = ax + (bx - ax) * f;
      let y = ay + (by - ay) * f;
      const hop = Math.sin(f * Math.PI) * tok * 1.2;
      const stack = at.get(Math.round(d) % BOARD_SIZE) ?? [i];
      const slot = stack.indexOf(i);
      const n = stack.length;
      if (n > 1) {
        const a = (slot / n) * Math.PI * 2;
        x += Math.cos(a) * tok * 1.1;
        y += Math.sin(a) * tok * 1.1;
      }
      y -= hop;
      // Shadow, then the piece.
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.ellipse(x + 1.5, y + tok * 0.9 + hop, tok * 0.9, tok * 0.35, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = TOKENS[p.token]?.color ?? INK;
      g.strokeStyle = i === s.current ? '#fff' : INK;
      g.lineWidth = i === s.current ? 2.4 : 1.4;
      shape(TOKEN_SHAPES[p.token % TOKEN_SHAPES.length]!, x, y, tok);
      g.fill();
      g.stroke();
      if (p.inJail) {
        g.strokeStyle = INK;
        g.lineWidth = 1;
        shape('hex', x, y, tok * 1.5);
        g.stroke();
      }
    }
  }

  function tick(t: number): void {
    raf = 0;
    if (!state) return;
    const dt = last ? t - last : 16;
    last = t;
    let moving = false;
    state.players.forEach((p, i) => {
      const cur = shown[i] ?? p.pos;
      if (cur === p.pos) return;
      const back = (Math.floor(cur) - p.pos + BOARD_SIZE) % BOARD_SIZE;
      // Jumps to Jail and short moves backward snap; forward moves hop one space per STEP_MS.
      if ((p.inJail && p.pos === 10) || back <= 3) {
        shown[i] = p.pos;
        return;
      }
      const before = Math.floor(cur);
      const dist = (p.pos - cur + BOARD_SIZE) % BOARD_SIZE;
      const stepBy = dt / STEP_MS;
      const next = stepBy >= dist ? p.pos : (cur + stepBy) % BOARD_SIZE;
      shown[i] = next;
      if (Math.floor(next) !== before) onStep();
      moving = true;
    });
    draw();
    if (moving) raf = requestAnimationFrame(tick);
    else {
      last = 0;
      const ws = waiters;
      waiters = [];
      ws.forEach((f) => f());
    }
  }

  canvas.addEventListener('click', (ev) => {
    const b = canvas.getBoundingClientRect();
    const x = ev.clientX - b.left;
    const y = ev.clientY - b.top;
    for (let pos = 0; pos < BOARD_SIZE; pos++) {
      const r = rectOf(pos);
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return onTap(pos);
    }
  });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;

  return {
    canvas,
    update(s, selected) {
      const first = !state || state.players.length !== s.players.length;
      state = s;
      sel = selected;
      if (first) shown = s.players.map((p) => p.pos);
      if (!size) {
        ro?.observe(canvas.parentElement ?? canvas);
        resize();
      }
      if (!raf) raf = requestAnimationFrame(tick);
    },
    settled() {
      if (!state || state.players.every((p, i) => shown[i] === p.pos)) return Promise.resolve();
      return new Promise((r) => waiters.push(r));
    },
    destroy() {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      waiters.forEach((f) => f());
      waiters = [];
    },
  };
}
