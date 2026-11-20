/**
 * The Moonhold loop: 40 spaces, numbered 0-39 in play order. The layout of kinds (which space is a corner, a lot,
 * a gate, a works, a draw or a levy) follows the standard trading-game loop; every name here is Moonhold's own.
 */
import { ECONOMY, lotTerms, type EconomyConfig, type LotTerms } from './economy';

export type Corner = 'launch' | 'quarantine' | 'drift' | 'beam';
export type DeckId = 'signal' | 'salvage';

export type Space =
  | { kind: 'corner'; corner: Corner; name: string }
  | { kind: 'lot'; name: string; group: number; terms: LotTerms }
  | { kind: 'gate'; name: string; price: number }
  | { kind: 'works'; name: string; price: number }
  | { kind: 'draw'; deck: DeckId; name: string }
  | { kind: 'levy'; name: string; amount: number };

export interface Group {
  name: string;
  /** Display colour (UI only). The sequence deliberately avoids the classic board's colour order. */
  color: string;
  /** A short mark drawn on each lot, so groups read without colour. */
  mark: string;
  lots: number[];
}

export const BOARD_SIZE = 40;
export const QUARANTINE = 10;
export const BEAM = 30;

/** Group names, colours, marks and lot names, in board order. Positions of each group's lots are below. */
const GROUP_DEFS: { name: string; color: string; mark: string; lots: [number, string][] }[] = [
  { name: 'Dustline', color: '#a9b2bf', mark: '·', lots: [[1, 'Pebble Reach'], [3, 'Grit Hollow']] },
  { name: 'Brine', color: '#25b6a4', mark: '≈', lots: [[6, 'Saltglass'], [8, 'Brinefall'], [9, 'Tidewell']] },
  { name: 'Lumen', color: '#8b5cf6', mark: '✧', lots: [[11, 'Glowmere'], [13, 'Lantern Crag'], [14, 'Lumen Rise']] },
  { name: 'Thicket', color: '#94cf3f', mark: '♣', lots: [[16, 'Mossback'], [18, 'Fernhalo'], [19, 'Thicket Deep']] },
  { name: 'Frost', color: '#6fd6f2', mark: '❄', lots: [[21, 'Rimecap'], [23, 'Hoarfrost Bay'], [24, 'Glacier Eye']] },
  { name: 'Bloom', color: '#e04aa0', mark: '✿', lots: [[26, 'Petalfall'], [27, 'Orchid Drift'], [29, 'Bloomhaven']] },
  { name: 'Aurum', color: '#e8b931', mark: '◆', lots: [[31, 'Gilded Shoal'], [32, 'Sunvault'], [34, 'Aurum Crown']] },
  { name: 'Zenith', color: '#2b2d3a', mark: '★', lots: [[37, 'Starwell'], [39, 'Zenith Throne']] },
];

const OTHER: Record<number, Space> = {
  0: { kind: 'corner', corner: 'launch', name: 'Launch' },
  2: { kind: 'draw', deck: 'salvage', name: 'Salvage' },
  4: { kind: 'levy', name: 'Dock Levy', amount: 0 },
  5: { kind: 'gate', name: 'Halo Gate', price: 0 },
  7: { kind: 'draw', deck: 'signal', name: 'Signal' },
  10: { kind: 'corner', corner: 'quarantine', name: 'Quarantine' },
  12: { kind: 'works', name: 'Sail Works', price: 0 },
  15: { kind: 'gate', name: 'Rift Gate', price: 0 },
  17: { kind: 'draw', deck: 'salvage', name: 'Salvage' },
  20: { kind: 'corner', corner: 'drift', name: 'Drift' },
  22: { kind: 'draw', deck: 'signal', name: 'Signal' },
  25: { kind: 'gate', name: 'Arc Gate', price: 0 },
  28: { kind: 'works', name: 'Ice Works', price: 0 },
  30: { kind: 'corner', corner: 'beam', name: 'Tractor Beam' },
  33: { kind: 'draw', deck: 'salvage', name: 'Salvage' },
  35: { kind: 'gate', name: 'Veil Gate', price: 0 },
  36: { kind: 'draw', deck: 'signal', name: 'Signal' },
  38: { kind: 'levy', name: 'Beacon Toll', amount: 0 },
};

export interface Board {
  spaces: Space[];
  groups: Group[];
  gates: number[];
  works: number[];
}

/** Build the board from an economy. Pure: the same economy always gives the same board. */
export function makeBoard(e: EconomyConfig = ECONOMY): Board {
  const spaces: Space[] = new Array(BOARD_SIZE);
  const groups: Group[] = GROUP_DEFS.map((g) => ({ name: g.name, color: g.color, mark: g.mark, lots: g.lots.map(([p]) => p) }));
  GROUP_DEFS.forEach((g, gi) => {
    g.lots.forEach(([pos, name], i) => {
      spaces[pos] = { kind: 'lot', name, group: gi, terms: lotTerms(e, gi, GROUP_DEFS.length, i, g.lots.length, Math.floor(pos / 10)) };
    });
  });
  for (const [k, s] of Object.entries(OTHER)) {
    const pos = Number(k);
    if (s.kind === 'gate') spaces[pos] = { ...s, price: e.gatePrice };
    else if (s.kind === 'works') spaces[pos] = { ...s, price: e.worksPrice };
    else if (s.kind === 'levy') spaces[pos] = { ...s, amount: pos === 4 ? e.taxHigh : e.taxLow };
    else spaces[pos] = s;
  }
  const gates = spaces.flatMap((s, i) => (s.kind === 'gate' ? [i] : []));
  const works = spaces.flatMap((s, i) => (s.kind === 'works' ? [i] : []));
  return { spaces, groups, gates, works };
}

export const BOARD = makeBoard();

/** Spaces that can be owned. */
export const isOwnable = (s: Space): s is Extract<Space, { kind: 'lot' | 'gate' | 'works' }> =>
  s.kind === 'lot' || s.kind === 'gate' || s.kind === 'works';

export const priceOf = (s: Space): number => (s.kind === 'lot' ? s.terms.price : s.kind === 'gate' || s.kind === 'works' ? s.price : 0);
