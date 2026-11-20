/**
 * The Bankroll loop: 40 spaces, numbered 0-39 in play order. The layout of kinds (which space is a corner, a lot,
 * a subway, a utilities, a draw or a levy) is the 40-space property-trading loop; every name here is Bankroll's own.
 */
import { ECONOMY, lotTerms, type EconomyConfig, type LotTerms } from './economy';

export type Corner = 'start' | 'jail' | 'rest' | 'arrest';
export type DeckId = 'news' | 'civic';

export type Space =
  | { kind: 'corner'; corner: Corner; name: string }
  | { kind: 'lot'; name: string; group: number; terms: LotTerms }
  | { kind: 'subway'; name: string; price: number }
  | { kind: 'utility'; name: string; price: number }
  | { kind: 'draw'; deck: DeckId; name: string }
  | { kind: 'levy'; name: string; amount: number };

export interface Group {
  name: string;
  /** Display colour (UI only). Bankroll's own palette and order. */
  color: string;
  /** A short mark drawn on each lot, so groups read without colour. */
  mark: string;
  lots: number[];
}

export const BOARD_SIZE = 40;
export const JAIL = 10;
export const ARREST = 30;

/** Group names, colours, marks and lot names, in board order. Positions of each group's lots are below. */
const GROUP_DEFS: { name: string; color: string; mark: string; lots: [number, string][] }[] = [
  { name: 'Dockside', color: '#a9b2bf', mark: '·', lots: [[1, 'Rivet Row'], [3, 'Cannery Lane']] },
  { name: 'Old Market', color: '#25b6a4', mark: '≈', lots: [[6, 'Tanner Street'], [8, 'Cooper Street'], [9, 'Market Square']] },
  { name: 'Arts District', color: '#8b5cf6', mark: '✧', lots: [[11, 'Gallery Walk'], [13, 'Canvas Avenue'], [14, 'Studio Row']] },
  { name: 'Greenway', color: '#94cf3f', mark: '♣', lots: [[16, 'Elm Terrace'], [18, 'Linden Avenue'], [19, 'Arbor Court']] },
  { name: 'University Hill', color: '#6fd6f2', mark: '❄', lots: [[21, 'College Street'], [23, 'Scholar Avenue'], [24, 'Belltower Place']] },
  { name: 'Theater Row', color: '#e04aa0', mark: '✿', lots: [[26, 'Marquee Street'], [27, 'Encore Avenue'], [29, 'Curtain Square']] },
  { name: 'Financial District', color: '#e8b931', mark: '◆', lots: [[31, 'Ledger Street'], [32, 'Exchange Place'], [34, 'Vault Avenue']] },
  { name: 'Skyline', color: '#b8733a', mark: '★', lots: [[37, 'Summit Heights'], [39, 'Crown Tower']] },
];

const OTHER: Record<number, Space> = {
  0: { kind: 'corner', corner: 'start', name: 'Start' },
  2: { kind: 'draw', deck: 'civic', name: 'Civic' },
  4: { kind: 'levy', name: 'Tax Bill', amount: 0 },
  5: { kind: 'subway', name: 'Harbor Line', price: 0 },
  7: { kind: 'draw', deck: 'news', name: 'News' },
  10: { kind: 'corner', corner: 'jail', name: 'Jail' },
  12: { kind: 'utility', name: 'Power Grid', price: 0 },
  15: { kind: 'subway', name: 'Midtown Line', price: 0 },
  17: { kind: 'draw', deck: 'civic', name: 'Civic' },
  20: { kind: 'corner', corner: 'rest', name: 'Rest Stop' },
  22: { kind: 'draw', deck: 'news', name: 'News' },
  25: { kind: 'subway', name: 'Uptown Line', price: 0 },
  28: { kind: 'utility', name: 'Water Main', price: 0 },
  30: { kind: 'corner', corner: 'arrest', name: 'Arrested' },
  33: { kind: 'draw', deck: 'civic', name: 'Civic' },
  35: { kind: 'subway', name: 'Airport Line', price: 0 },
  36: { kind: 'draw', deck: 'news', name: 'News' },
  38: { kind: 'levy', name: 'Bridge Toll', amount: 0 },
};

export interface Board {
  spaces: Space[];
  groups: Group[];
  subways: number[];
  utilities: number[];
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
    if (s.kind === 'subway') spaces[pos] = { ...s, price: e.subwayPrice };
    else if (s.kind === 'utility') spaces[pos] = { ...s, price: e.utilityPrice };
    else if (s.kind === 'levy') spaces[pos] = { ...s, amount: pos === 4 ? e.taxHigh : e.taxLow };
    else spaces[pos] = s;
  }
  const subways = spaces.flatMap((s, i) => (s.kind === 'subway' ? [i] : []));
  const utilities = spaces.flatMap((s, i) => (s.kind === 'utility' ? [i] : []));
  return { spaces, groups, subways, utilities };
}

export const BOARD = makeBoard();

/** Spaces that can be owned. */
export const isOwnable = (s: Space): s is Extract<Space, { kind: 'lot' | 'subway' | 'utility' }> =>
  s.kind === 'lot' || s.kind === 'subway' || s.kind === 'utility';

export const priceOf = (s: Space): number => (s.kind === 'lot' ? s.terms.price : s.kind === 'subway' || s.kind === 'utility' ? s.price : 0);
