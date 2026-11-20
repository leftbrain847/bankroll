/**
 * The orbit: Bankroll's 40 spaces drawn as beads on a ring, Launch at the top, play running clockwise. Lots are
 * coloured beads with their group's mark; the owner's colour rings the bead; domes and spires sit outside it.
 * Tokens travel just inside the ring. Canvas only, so the page holds no external or inline assets.
 */
import { BOARD, BOARD_SIZE, type Space } from '../game/board';
import type { GameState } from '../game/rules';

export const TOKENS = [
  { name: 'Comet', color: '#ff8c42' },
  { name: 'Prism', color: '#3ddc97' },
  { name: 'Kestrel', color: '#4ea8de' },
  { name: 'Lantern', color: '#f15bb5' },
  { name: 'Coral', color: '#fee440' },
  { name: 'Nova', color: '#c77dff' },
];

export interface BoardView {
  canvas: HTMLCanvasElement;
  update(s: GameState, selected: number | null): void;
  /** Resolves once tokens have finished walking. */
  settled(): Promise<void>;
  destroy(): void;
}

const STEP_MS = 85;

export function createBoardView(onTap: (pos: number) => void, onStep: () => void): BoardView {
  const canvas = document.createElement('canvas');
  canvas.className = 'board';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The orbit board. Tap a space for details.');
  const g = canvas.getContext('2d');
  let size = 0;
  let state: GameState | null = null;
  let sel: number | null = null;
  /** Displayed position of each token, which walks toward its real one. */
  let shown: number[] = [];
  let raf = 0;
  let last = 0;
  let waiters: (() => void)[] = [];

  const geom = () => {
    const c = size / 2;
    const R = c - 24;
    return { c, R };
  };
  const at = (pos: number, r: number): [number, number] => {
    const { c } = geom();
    const a = -Math.PI / 2 + (pos / BOARD_SIZE) * Math.PI * 2;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };

  function resize(): void {
    const w = Math.min(canvas.parentElement?.clientWidth ?? 360, 520);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    size = w;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${w}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    g?.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function shape(kind: 'circle' | 'triangle' | 'square' | 'diamond' | 'hex' | 'star', x: number, y: number, r: number): void {
    if (!g) return;
    g.beginPath();
    if (kind === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
    else {
      const pts = kind === 'triangle' ? 3 : kind === 'square' || kind === 'diamond' ? 4 : kind === 'hex' ? 6 : 10;
      const rot = kind === 'square' ? Math.PI / 4 : kind === 'triangle' ? -Math.PI / 2 : kind === 'star' ? -Math.PI / 2 : 0;
      for (let i = 0; i < pts; i++) {
        const rr = kind === 'star' && i % 2 ? r * 0.45 : r;
        const a = rot + (i / pts) * Math.PI * 2;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.closePath();
    }
  }

  const TOKEN_SHAPES = ['circle', 'triangle', 'square', 'diamond', 'hex', 'star'] as const;

  function cornerArt(sp: Extract<Space, { kind: 'corner' }>, x: number, y: number, r: number): void {
    if (!g) return;
    g.lineWidth = 1.6;
    g.strokeStyle = '#e9ecff';
    g.beginPath();
    if (sp.corner === 'launch') {
      // Rings with a forward chevron.
      g.arc(x, y, r * 0.55, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(x - r * 0.15, y - r * 0.3);
      g.lineTo(x + r * 0.2, y);
      g.lineTo(x - r * 0.15, y + r * 0.3);
    } else if (sp.corner === 'quarantine') {
      // A sealed hex pod.
      shape('hex', x, y, r * 0.55);
      g.stroke();
      g.beginPath();
      g.moveTo(x - r * 0.3, y);
      g.lineTo(x + r * 0.3, y);
    } else if (sp.corner === 'drift') {
      // Two lazy waves.
      for (const dy of [-0.18, 0.18]) {
        g.moveTo(x - r * 0.5, y + r * dy);
        g.bezierCurveTo(x - r * 0.2, y + r * (dy - 0.3), x + r * 0.2, y + r * (dy + 0.3), x + r * 0.5, y + r * dy);
      }
    } else {
      // A spiral pulling inward.
      for (let i = 0; i <= 40; i++) {
        const a = i * 0.45;
        const rr = r * 0.6 * (1 - i / 44);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
    }
    g.stroke();
  }

  function draw(): void {
    if (!g || !state) return;
    const s = state;
    const { c, R } = geom();
    g.clearRect(0, 0, size, size);
    // Orbit line.
    g.strokeStyle = 'rgba(160,170,255,0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.stroke();
    const beadR = Math.min(11, (Math.PI * 2 * R) / BOARD_SIZE / 2 - 1.5);

    BOARD.spaces.forEach((sp, pos) => {
      const [x, y] = at(pos, R);
      const corner = sp.kind === 'corner';
      const r = corner ? beadR * 1.45 : beadR;
      const owner = s.owner[pos];
      if (sel === pos) {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.beginPath();
        g.arc(x, y, r + 7, 0, Math.PI * 2);
        g.fill();
      }
      if (sp.kind === 'lot') {
        const grp = BOARD.groups[sp.group]!;
        g.fillStyle = grp.color;
        shape('circle', x, y, r);
        g.fill();
        if (grp.color === '#2b2d3a') {
          g.strokeStyle = '#e8e8f0';
          g.lineWidth = 1;
          g.stroke();
        }
        g.fillStyle = grp.color === '#2b2d3a' ? '#ffffff' : 'rgba(10,12,30,0.75)';
        g.font = `${Math.round(r * 1.05)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(grp.mark, x, y + 0.5);
      } else if (corner) {
        g.fillStyle = '#1d2450';
        shape('circle', x, y, r);
        g.fill();
        cornerArt(sp as Extract<Space, { kind: 'corner' }>, x, y, r);
      } else {
        g.fillStyle = '#141a3a';
        g.strokeStyle = '#aab3ff';
        g.lineWidth = 1.5;
        if (sp.kind === 'gate') {
          shape('diamond', x, y, r);
          g.fill();
          g.stroke();
          g.beginPath();
          g.arc(x, y, r * 0.35, 0, Math.PI * 2);
          g.stroke();
        } else if (sp.kind === 'works') {
          shape('hex', x, y, r);
          g.fill();
          g.stroke();
          g.fillStyle = '#ffd166';
          shape('circle', x, y, r * 0.3);
          g.fill();
        } else if (sp.kind === 'draw') {
          shape('circle', x, y, r * 0.95);
          g.fill();
          g.beginPath();
          if (sp.deck === 'signal') {
            for (const k of [0.35, 0.65]) {
              g.beginPath();
              g.arc(x - r * 0.35, y + r * 0.35, r * k * 1.2, -Math.PI / 2, 0);
              g.stroke();
            }
          } else {
            shape('triangle', x, y + 1, r * 0.55);
            g.stroke();
          }
        } else if (sp.kind === 'levy') {
          shape('square', x, y, r * 0.95);
          g.fill();
          g.stroke();
          g.beginPath();
          g.moveTo(x - r * 0.4, y + r * 0.4);
          g.lineTo(x + r * 0.4, y - r * 0.4);
          g.stroke();
        }
      }
      // Ownership ring and mortgage hatch.
      if (owner !== null && owner !== undefined) {
        g.strokeStyle = TOKENS[s.players[owner]?.token ?? 0]?.color ?? '#fff';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, r + 3, 0, Math.PI * 2);
        g.stroke();
        if (s.mortgaged[pos]) {
          g.strokeStyle = 'rgba(0,0,0,0.65)';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(x - r * 0.7, y - r * 0.7);
          g.lineTo(x + r * 0.7, y + r * 0.7);
          g.stroke();
        }
      }
      // Buildings outside the ring.
      const lvl = s.level[pos] ?? 0;
      if (lvl > 0) {
        const outR = R + r + 8;
        const ang = -Math.PI / 2 + (pos / BOARD_SIZE) * Math.PI * 2;
        if (lvl === 5) {
          const [bx, by] = [c + Math.cos(ang) * outR, c + Math.sin(ang) * outR];
          g.fillStyle = '#ffffff';
          shape('star', bx, by, 6);
          g.fill();
        } else {
          for (let i = 0; i < lvl; i++) {
            const off = (i - (lvl - 1) / 2) * 0.045;
            const [bx, by] = [c + Math.cos(ang + off) * outR, c + Math.sin(ang + off) * outR];
            g.fillStyle = '#e9ecff';
            g.beginPath();
            g.arc(bx, by, 2.6, Math.PI, 0);
            g.fill();
          }
        }
      }
    });

    // Tokens, walking inside the ring; several on one space fan out.
    const live = s.players.map((p, i) => ({ p, i })).filter(({ p }) => !p.bankrupt);
    const groups = new Map<number, number[]>();
    for (const { i } of live) {
      const k = Math.round(shown[i] ?? 0) % BOARD_SIZE;
      groups.set(k, [...(groups.get(k) ?? []), i]);
    }
    for (const { p, i } of live) {
      const d = shown[i] ?? p.pos;
      const k = Math.round(d) % BOARD_SIZE;
      const stack = groups.get(k) ?? [i];
      const slot = stack.indexOf(i);
      const rr = R - beadR - 11 - slot * 10;
      const pos = p.inQuarantine && Math.abs(d - p.pos) < 0.01 ? d + 0.0 : d;
      const [x, y] = at(pos, Math.max(rr, R * 0.55));
      const col = TOKENS[p.token]?.color ?? '#fff';
      g.fillStyle = col;
      g.strokeStyle = i === s.current ? '#ffffff' : 'rgba(0,0,0,0.6)';
      g.lineWidth = i === s.current ? 2.2 : 1.2;
      shape(TOKEN_SHAPES[p.token % TOKEN_SHAPES.length]!, x, y, 6.5);
      g.fill();
      g.stroke();
      if (p.inQuarantine) {
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 1;
        shape('hex', x, y, 9.5);
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
      const target = p.pos;
      // Jumps to Quarantine and moves backward snap; forward moves walk one space per STEP_MS.
      const fwd = (target - Math.floor(cur) + BOARD_SIZE) % BOARD_SIZE;
      const back = (Math.floor(cur) - target + BOARD_SIZE) % BOARD_SIZE;
      if ((p.inQuarantine && target === 10) || back <= 3) {
        shown[i] = target;
        return;
      }
      void fwd;
      const before = Math.floor(cur);
      let next = cur + dt / STEP_MS;
      const dist = (target - cur + BOARD_SIZE) % BOARD_SIZE;
      if (dt / STEP_MS >= dist) next = target;
      shown[i] = next % BOARD_SIZE;
      if (Math.floor(next) !== before) onStep();
      moving = true;
    });
    draw();
    if (moving) raf = requestAnimationFrame(tick);
    else {
      last = 0;
      const w = waiters;
      waiters = [];
      w.forEach((f) => f());
    }
  }

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const { c, R } = geom();
    const dx = x - c;
    const dy = y - c;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dist - R) > 26) return;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    onTap(Math.round((a / (Math.PI * 2)) * BOARD_SIZE) % BOARD_SIZE);
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
