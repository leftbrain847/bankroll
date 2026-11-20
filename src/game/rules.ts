/**
 * Moonhold rules engine. Pure and deterministic: `apply(state, player, action)` returns a new state (or an error)
 * and never touches the clock, Math.random or the DOM. Dice and deck shuffles come from a seeded generator kept in
 * the state, so a game replays exactly from its seed and its list of actions.
 */
import { BOARD, BOARD_SIZE, isOwnable, priceOf, QUARANTINE, type Board, type DeckId } from './board';
import { cardById, DECKS, DECK_NAMES, type Card } from './cards';
import { ECONOMY, gateRent, transferFee, unmortgageCost, worksRent, type EconomyConfig } from './economy';

export interface RulesConfig {
  economy: EconomyConfig;
  board: Board;
  minPlayers: number;
  maxPlayers: number;
  /** Doubles in a row that send you to Quarantine. */
  doublesLimit: number;
  /** Failed doubles attempts in Quarantine before you must pay and leave. */
  quarantineTries: number;
  /** Salary for landing exactly on Launch, as well as passing it. */
  salaryOnLanding: boolean;
  /** Log entries kept in the state. */
  logLimit: number;
}

export const DEFAULT_RULES: RulesConfig = {
  economy: ECONOMY,
  board: BOARD,
  minPlayers: 2,
  maxPlayers: 6,
  doublesLimit: 3,
  quarantineTries: 3,
  salaryOnLanding: true,
  logLimit: 120,
};

export const MAX_LEVEL = 5; // 1-4 domes, 5 = spire

export interface PlayerSetup {
  name: string;
  token: number;
  bot: boolean;
}

export interface Player extends PlayerSetup {
  cash: number;
  pos: number;
  inQuarantine: boolean;
  tries: number;
  /** Clearance pass card ids held. */
  passes: string[];
  bankrupt: boolean;
}

export type Creditor = number | 'bank';

export interface Debt {
  debtor: number;
  creditor: Creditor;
  amount: number;
  reason: string;
}

export interface Auction {
  pos: number;
  high: number;
  leader: number | null;
  /** Players still bidding, in turn order. */
  active: number[];
  /** Whose turn it is to bid (a player index). */
  bidder: number;
}

export interface Bundle {
  lots: number[];
  cash: number;
  passes: number;
}

export interface Trade {
  from: number;
  to: number;
  give: Bundle;
  get: Bundle;
}

/** What happens once the current interruption (purchase, auction) is settled. */
export type After = 'roll' | 'end' | 'next';

export type Phase =
  | { kind: 'roll' }
  | { kind: 'buy'; pos: number; then: After }
  | { kind: 'auction'; then: After }
  | { kind: 'end' }
  | { kind: 'over'; winner: number };

export type LogKind = 'roll' | 'move' | 'salary' | 'buy' | 'rent' | 'tax' | 'card' | 'quarantine' | 'build' | 'mortgage' | 'auction' | 'trade' | 'debt' | 'bankrupt' | 'win' | 'turn';

export interface LogEntry {
  seq: number;
  kind: LogKind;
  text: string;
  player?: number;
}

export interface GameState {
  players: Player[];
  /** Owner of each space, by position (null = bank). */
  owner: (number | null)[];
  /** Building level of each lot: 0, 1-4 domes, 5 = spire. */
  level: number[];
  mortgaged: boolean[];
  bank: { domes: number; spires: number };
  decks: Record<DeckId, string[]>;
  rng: number;
  current: number;
  doubles: number;
  turn: number;
  phase: Phase;
  debts: Debt[];
  auction: Auction | null;
  /** Lots waiting for auction after a player went bankrupt to the bank. */
  auctionQueue: number[];
  trade: Trade | null;
  lastRoll: [number, number] | null;
  lastCard: { id: string; player: number; seq: number } | null;
  log: LogEntry[];
  seq: number;
  /** Bot memory: `${player}:${pos}` -> turn a trade for it was last proposed. */
  memo: Record<string, number>;
}

export type Action =
  | { type: 'roll' }
  | { type: 'payFine' }
  | { type: 'usePass' }
  | { type: 'buy' }
  | { type: 'decline' }
  | { type: 'bid'; amount: number }
  | { type: 'passBid' }
  | { type: 'setLevels'; group: number; levels: number[] }
  | { type: 'build'; pos: number }
  | { type: 'sell'; pos: number }
  | { type: 'mortgage'; pos: number }
  | { type: 'unmortgage'; pos: number }
  | { type: 'propose'; to: number; give: Bundle; get: Bundle }
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'payDebt' }
  | { type: 'bankrupt' }
  | { type: 'endTurn' };

export type Result = { state: GameState; error?: undefined } | { error: string; state?: undefined };

// ---------- seeded randomness ----------

/** mulberry32 step: returns [value in [0,1), next state]. */
export function rand(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

function nextRand(s: GameState): number {
  const [v, n] = rand(s.rng);
  s.rng = n;
  return v;
}

const die = (s: GameState): number => 1 + Math.floor(nextRand(s) * 6);

function shuffle<T>(s: GameState, list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand(s) * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

// ---------- setup ----------

export function newGame(setup: PlayerSetup[], seed: number, rules: RulesConfig = DEFAULT_RULES): GameState {
  if (setup.length < rules.minPlayers || setup.length > rules.maxPlayers) throw new Error(`need ${rules.minPlayers}-${rules.maxPlayers} players`);
  const s: GameState = {
    players: setup.map((p) => ({ ...p, cash: rules.economy.startingCash, pos: 0, inQuarantine: false, tries: 0, passes: [], bankrupt: false })),
    owner: new Array(BOARD_SIZE).fill(null),
    level: new Array(BOARD_SIZE).fill(0),
    mortgaged: new Array(BOARD_SIZE).fill(false),
    bank: { domes: rules.economy.domes, spires: rules.economy.spires },
    decks: { signal: [], salvage: [] },
    rng: seed >>> 0,
    current: 0,
    doubles: 0,
    turn: 1,
    phase: { kind: 'roll' },
    debts: [],
    auction: null,
    auctionQueue: [],
    trade: null,
    lastRoll: null,
    lastCard: null,
    log: [],
    seq: 0,
    memo: {},
  };
  s.decks.signal = shuffle(s, DECKS.signal.map((c) => c.id));
  s.decks.salvage = shuffle(s, DECKS.salvage.map((c) => c.id));
  log(s, rules, 'turn', `${s.players[0]?.name ?? 'Player 1'} goes first.`, 0);
  return s;
}

// ---------- helpers ----------

const P = (s: GameState, i: number): Player => {
  const p = s.players[i];
  if (!p) throw new Error(`no player ${i}`);
  return p;
};

export const money = (n: number): string => `✦${n.toLocaleString('en-US')}`;

function log(s: GameState, rules: RulesConfig, kind: LogKind, text: string, player?: number): void {
  s.seq += 1;
  s.log.push({ seq: s.seq, kind, text, ...(player !== undefined ? { player } : {}) });
  if (s.log.length > rules.logLimit) s.log.splice(0, s.log.length - rules.logLimit);
}

const spaceName = (rules: RulesConfig, pos: number): string => rules.board.spaces[pos]?.name ?? `space ${pos}`;

/** Who must act now. */
export function actorOf(s: GameState): number {
  if (s.phase.kind === 'over') return -1;
  if (s.trade) return s.trade.to;
  const d = s.debts[0];
  if (d) return d.debtor;
  if (s.phase.kind === 'auction' && s.auction) return s.auction.bidder;
  return s.current;
}

export const alive = (s: GameState): number[] => s.players.flatMap((p, i) => (p.bankrupt ? [] : [i]));

/** Whether player p may build, sell, mortgage or propose trades right now. */
export function canManage(s: GameState, p: number): boolean {
  if (s.phase.kind === 'over' || s.trade || s.phase.kind === 'auction') return false;
  const d = s.debts[0];
  if (d) return d.debtor === p;
  return p === s.current && (s.phase.kind === 'roll' || s.phase.kind === 'end' || s.phase.kind === 'buy');
}

export const groupOf = (rules: RulesConfig, pos: number): number | null => {
  const sp = rules.board.spaces[pos];
  return sp?.kind === 'lot' ? sp.group : null;
};

export function ownsGroup(s: GameState, rules: RulesConfig, p: number, g: number): boolean {
  const grp = rules.board.groups[g];
  return !!grp && grp.lots.every((pos) => s.owner[pos] === p);
}

const domesAt = (lvl: number): number => (lvl >= 1 && lvl <= 4 ? lvl : 0);
const spiresAt = (lvl: number): number => (lvl === MAX_LEVEL ? 1 : 0);

export const groupHasBuildings = (s: GameState, rules: RulesConfig, g: number): boolean =>
  (rules.board.groups[g]?.lots ?? []).some((pos) => (s.level[pos] ?? 0) > 0);

/** Rent owed for landing on pos. `dice` is the roll total; `cardBoost` doubles gate tolls / forces 10x works. */
export function rentFor(s: GameState, rules: RulesConfig, pos: number, dice: number, cardBoost = false): number {
  const sp = rules.board.spaces[pos];
  const o = s.owner[pos];
  if (!sp || o === null || o === undefined || s.mortgaged[pos]) return 0;
  const e = rules.economy;
  if (sp.kind === 'lot') {
    const lvl = s.level[pos] ?? 0;
    if (lvl > 0) return sp.terms.rent[lvl] ?? 0;
    return sp.terms.rent[0] * (ownsGroup(s, rules, o, sp.group) ? e.fullGroupMultiplier : 1);
  }
  if (sp.kind === 'gate') {
    const n = rules.board.gates.filter((g) => s.owner[g] === o).length;
    return gateRent(e, n) * (cardBoost ? 2 : 1);
  }
  if (sp.kind === 'works') {
    const n = rules.board.works.filter((w) => s.owner[w] === o).length;
    return cardBoost ? dice * e.worksMultiplierBoth : worksRent(e, n, dice);
  }
  return 0;
}

/** Cash a player could raise by selling every building and mortgaging every lot. */
export function liquidationValue(s: GameState, rules: RulesConfig, p: number): number {
  let total = P(s, p).cash;
  s.owner.forEach((o, pos) => {
    if (o !== p) return;
    const sp = rules.board.spaces[pos];
    if (!sp || !isOwnable(sp)) return;
    if (sp.kind === 'lot') total += Math.floor((s.level[pos] ?? 0) * sp.terms.buildCost * rules.economy.buildingRefund);
    if (!s.mortgaged[pos]) total += Math.round(priceOf(sp) * rules.economy.mortgageShare);
  });
  return total;
}

/** Net worth: cash plus lot prices (mortgaged lots at price less mortgage) plus building cost. */
export function netWorth(s: GameState, rules: RulesConfig, p: number): number {
  let total = P(s, p).cash;
  s.owner.forEach((o, pos) => {
    if (o !== p) return;
    const sp = rules.board.spaces[pos];
    if (!sp || !isOwnable(sp)) return;
    const price = priceOf(sp);
    total += s.mortgaged[pos] ? price - Math.round(price * rules.economy.mortgageShare) : price;
    if (sp.kind === 'lot') total += (s.level[pos] ?? 0) * sp.terms.buildCost;
  });
  return total;
}

// ---------- money ----------

/** Charge p `amount`, paid to `creditor`. Pays at once if p has the cash; otherwise queues a debt to raise. */
function charge(s: GameState, rules: RulesConfig, p: number, creditor: Creditor, amount: number, reason: string): void {
  if (amount <= 0) return;
  const pl = P(s, p);
  if (pl.cash >= amount) {
    pl.cash -= amount;
    if (creditor !== 'bank') P(s, creditor).cash += amount;
  } else {
    s.debts.push({ debtor: p, creditor, amount, reason });
    log(s, rules, 'debt', `${pl.name} owes ${money(amount)} (${reason}) and must raise the cash.`, p);
  }
}

// ---------- movement ----------

function passLaunch(s: GameState, rules: RulesConfig, p: number): void {
  const pl = P(s, p);
  pl.cash += rules.economy.salary;
  log(s, rules, 'salary', `${pl.name} passes Launch and collects ${money(rules.economy.salary)}.`, p);
}

function sendToQuarantine(s: GameState, rules: RulesConfig, p: number, why: string): void {
  const pl = P(s, p);
  pl.pos = QUARANTINE;
  pl.inQuarantine = true;
  pl.tries = 0;
  if (p === s.current) s.doubles = 0;
  log(s, rules, 'quarantine', `${pl.name} ${why} and goes to Quarantine.`, p);
}

/** Move forward `steps`, paying salary on passing (or landing on) Launch. */
function moveBy(s: GameState, rules: RulesConfig, p: number, steps: number): void {
  const pl = P(s, p);
  const raw = pl.pos + steps;
  if (raw >= BOARD_SIZE && (rules.salaryOnLanding || raw % BOARD_SIZE !== 0)) passLaunch(s, rules, p);
  pl.pos = raw % BOARD_SIZE;
  log(s, rules, 'move', `${pl.name} moves to ${spaceName(rules, pl.pos)}.`, p);
}

function advanceTo(s: GameState, rules: RulesConfig, p: number, to: number): void {
  const pl = P(s, p);
  const steps = (to - pl.pos + BOARD_SIZE) % BOARD_SIZE || BOARD_SIZE;
  moveBy(s, rules, p, steps);
}

/**
 * Resolve landing on the player's current space. `dice` is the roll total (used by works); `cardBoost` is set when
 * a card sent them to the nearest gate or works. Returns true when a purchase decision is now pending.
 */
function land(s: GameState, rules: RulesConfig, p: number, dice: number, then: After, cardBoost = false): boolean {
  const pl = P(s, p);
  const sp = rules.board.spaces[pl.pos];
  if (!sp) return false;
  if (sp.kind === 'corner') {
    if (sp.corner === 'beam') sendToQuarantine(s, rules, p, 'is caught by the Tractor Beam');
    return false;
  }
  if (sp.kind === 'levy') {
    log(s, rules, 'tax', `${pl.name} pays the ${sp.name}: ${money(sp.amount)}.`, p);
    charge(s, rules, p, 'bank', sp.amount, sp.name);
    return false;
  }
  if (sp.kind === 'draw') {
    drawCard(s, rules, p, sp.deck, then);
    return s.phase.kind === 'buy';
  }
  // Ownable.
  const o = s.owner[pl.pos];
  if (o === null || o === undefined) {
    s.phase = { kind: 'buy', pos: pl.pos, then };
    return true;
  }
  if (o === p) return false;
  if (s.mortgaged[pl.pos]) {
    log(s, rules, 'rent', `${sp.name} is mortgaged: no rent.`, p);
    return false;
  }
  let roll = dice;
  if (cardBoost && sp.kind === 'works') {
    const a = die(s);
    const b = die(s);
    roll = a + b;
    s.lastRoll = [a, b];
    log(s, rules, 'roll', `${pl.name} rolls ${a} + ${b} for the works fee.`, p);
  }
  const rent = rentFor(s, rules, pl.pos, roll, cardBoost);
  log(s, rules, 'rent', `${pl.name} owes ${P(s, o).name} ${money(rent)} for ${sp.name}.`, p);
  charge(s, rules, p, o, rent, `rent on ${sp.name}`);
  return false;
}

function drawCard(s: GameState, rules: RulesConfig, p: number, deck: DeckId, then: After): void {
  const id = s.decks[deck].shift();
  if (!id) return; // every card of the deck is held as a pass (only possible with house rules); nothing happens
  const card: Card = cardById(id);
  const pl = P(s, p);
  s.lastCard = { id, player: p, seq: s.seq + 1 };
  log(s, rules, 'card', `${pl.name} draws ${DECK_NAMES[deck]}: “${card.title}”. ${card.text}`, p);
  const e = card.effect;
  if (e.type === 'pass') pl.passes.push(id);
  else s.decks[deck].push(id);
  switch (e.type) {
    case 'advance':
      advanceTo(s, rules, p, e.to);
      land(s, rules, p, s.lastRoll ? s.lastRoll[0] + s.lastRoll[1] : 7, then);
      break;
    case 'nearest': {
      const targets = e.kind === 'gate' ? rules.board.gates : rules.board.works;
      const to = targets.find((t) => t > pl.pos) ?? targets[0] ?? 0;
      advanceTo(s, rules, p, to);
      land(s, rules, p, 0, then, true);
      break;
    }
    case 'collect':
      pl.cash += e.amount;
      break;
    case 'pay':
      charge(s, rules, p, 'bank', e.amount, card.title);
      break;
    case 'payEach':
      for (const q of alive(s)) if (q !== p) charge(s, rules, p, q, e.amount, card.title);
      break;
    case 'collectEach':
      for (const q of alive(s)) if (q !== p) charge(s, rules, q, p, e.amount, card.title);
      break;
    case 'repairs': {
      let total = 0;
      s.owner.forEach((o, pos) => {
        if (o !== p) return;
        const lvl = s.level[pos] ?? 0;
        total += domesAt(lvl) * e.perDome + spiresAt(lvl) * e.perSpire;
      });
      if (total > 0) charge(s, rules, p, 'bank', total, card.title);
      else log(s, rules, 'card', `${pl.name} has no buildings to repair.`, p);
      break;
    }
    case 'toQuarantine':
      sendToQuarantine(s, rules, p, 'is flagged');
      break;
    case 'back': {
      pl.pos = (pl.pos - e.steps + BOARD_SIZE) % BOARD_SIZE;
      log(s, rules, 'move', `${pl.name} drifts back to ${spaceName(rules, pl.pos)}.`, p);
      land(s, rules, p, s.lastRoll ? s.lastRoll[0] + s.lastRoll[1] : 7, then);
      break;
    }
  }
}

// ---------- turn flow ----------

/** Where the turn goes after a move resolves. */
function afterMove(s: GameState, p: number, rolledDoubles: boolean): After {
  return rolledDoubles && !P(s, p).inQuarantine ? 'roll' : 'end';
}

function settle(s: GameState, then: After): void {
  if (s.phase.kind === 'over') return;
  if (then === 'next') nextTurn(s);
  else s.phase = { kind: then };
}

function nextTurn(s: GameState): void {
  const live = alive(s);
  if (live.length <= 1) return;
  let n = s.current;
  do n = (n + 1) % s.players.length;
  while (P(s, n).bankrupt);
  s.current = n;
  s.doubles = 0;
  s.turn += 1;
  s.phase = { kind: 'roll' };
}

function doRoll(s: GameState, rules: RulesConfig, p: number): void {
  const pl = P(s, p);
  const a = die(s);
  const b = die(s);
  s.lastRoll = [a, b];
  const dbl = a === b;
  log(s, rules, 'roll', `${pl.name} rolls ${a} + ${b}${dbl ? ' (doubles)' : ''}.`, p);

  if (pl.inQuarantine) {
    if (dbl) {
      pl.inQuarantine = false;
      pl.tries = 0;
      log(s, rules, 'quarantine', `${pl.name} rolls doubles and leaves Quarantine.`, p);
      moveBy(s, rules, p, a + b);
      if (!land(s, rules, p, a + b, 'end')) settle(s, 'end');
      return;
    }
    pl.tries += 1;
    if (pl.tries < rules.quarantineTries) {
      log(s, rules, 'quarantine', `${pl.name} stays in Quarantine (attempt ${pl.tries} of ${rules.quarantineTries}).`, p);
      s.phase = { kind: 'end' };
      return;
    }
    pl.inQuarantine = false;
    pl.tries = 0;
    log(s, rules, 'quarantine', `${pl.name} has used every attempt, pays ${money(rules.economy.quarantineFee)} and leaves.`, p);
    charge(s, rules, p, 'bank', rules.economy.quarantineFee, 'Quarantine fee');
    moveBy(s, rules, p, a + b);
    if (!land(s, rules, p, a + b, 'end')) settle(s, 'end');
    return;
  }

  if (dbl) {
    s.doubles += 1;
    if (s.doubles >= rules.doublesLimit) {
      sendToQuarantine(s, rules, p, `rolls doubles ${rules.doublesLimit} times in a row`);
      s.phase = { kind: 'end' };
      return;
    }
  } else s.doubles = 0;
  moveBy(s, rules, p, a + b);
  const then = afterMove(s, p, dbl);
  const pending = land(s, rules, p, a + b, then);
  if (!pending) settle(s, afterMove(s, p, dbl));
}

function startAuction(s: GameState, rules: RulesConfig, pos: number, then: After): void {
  const live = alive(s);
  if (live.length === 0) return settle(s, then);
  // Bidding starts with the player whose turn it is (or the next one alive) and goes around the table.
  const start = live.includes(s.current) ? s.current : (live.find((i) => i > s.current) ?? live[0] ?? 0);
  const order = [...live.filter((i) => i >= start), ...live.filter((i) => i < start)];
  s.auction = { pos, high: 0, leader: null, active: order, bidder: order[0] ?? 0 };
  s.phase = { kind: 'auction', then };
  log(s, rules, 'auction', `${spaceName(rules, pos)} goes to auction.`);
}

function nextBidder(a: Auction, from: number): number | null {
  if (a.active.length === 0) return null;
  const idx = a.active.indexOf(from);
  for (let k = 1; k <= a.active.length; k++) {
    const cand = a.active[(Math.max(idx, 0) + k) % a.active.length];
    if (cand !== undefined && cand !== a.leader) return cand;
  }
  return null;
}

function finishAuction(s: GameState, rules: RulesConfig): void {
  const a = s.auction;
  if (!a || s.phase.kind !== 'auction') return;
  const then = s.phase.then;
  if (a.leader !== null) {
    const w = P(s, a.leader);
    w.cash -= a.high;
    s.owner[a.pos] = a.leader;
    log(s, rules, 'auction', `${w.name} wins ${spaceName(rules, a.pos)} for ${money(a.high)}.`, a.leader);
  } else log(s, rules, 'auction', `No bids: ${spaceName(rules, a.pos)} stays with the bank.`);
  s.auction = null;
  const queued = s.auctionQueue.shift();
  if (queued !== undefined) startAuction(s, rules, queued, then);
  else settle(s, then);
}

function auctionStep(s: GameState, rules: RulesConfig): void {
  const a = s.auction;
  if (!a) return;
  const only = a.active.length === 1 ? a.active[0] : undefined;
  if (a.active.length === 0 || (only !== undefined && only === a.leader)) return finishAuction(s, rules);
  const nb = nextBidder(a, a.bidder);
  if (nb === null) return finishAuction(s, rules);
  a.bidder = nb;
}

// ---------- building ----------

/** Validate and price a change of building levels across one group. */
export function planLevels(s: GameState, rules: RulesConfig, p: number, g: number, levels: number[]): { cost: number; refund: number; domes: number; spires: number } | { error: string } {
  const grp = rules.board.groups[g];
  if (!grp) return { error: 'no such group' };
  if (levels.length !== grp.lots.length || levels.some((l) => !Number.isInteger(l) || l < 0 || l > MAX_LEVEL)) return { error: 'bad levels' };
  if (!ownsGroup(s, rules, p, g)) return { error: `you need every lot in ${grp.name} to build` };
  const before = grp.lots.map((pos) => s.level[pos] ?? 0);
  if (before.every((b, i) => b === levels[i])) return { error: 'nothing to change' };
  if (levels.some((l) => l > 0) && grp.lots.some((pos) => s.mortgaged[pos])) return { error: 'lift every mortgage in the group first' };
  if (Math.max(...levels) - Math.min(...levels) > 1) return { error: 'build and sell evenly: lots in a group may differ by one level at most' };
  const first = rules.board.spaces[grp.lots[0] ?? 0];
  const unit = first?.kind === 'lot' ? first.terms.buildCost : 0;
  let up = 0;
  let down = 0;
  let peakNeed = 0;
  let returned = 0;
  before.forEach((b, i) => {
    const a = levels[i] ?? 0;
    if (a > b) {
      up += a - b;
      peakNeed += (a === MAX_LEVEL ? 4 : a) - domesAt(b);
    } else if (a < b) {
      down += b - a;
      if (b === MAX_LEVEL) peakNeed += domesAt(a);
      else returned += b - a;
    }
  });
  const domes = levels.reduce((t, l) => t + domesAt(l), 0) - before.reduce((t, l) => t + domesAt(l), 0);
  const spires = levels.reduce((t, l) => t + spiresAt(l), 0) - before.reduce((t, l) => t + spiresAt(l), 0);
  if (s.bank.domes + returned < peakNeed) return { error: `the bank has only ${s.bank.domes} domes left` };
  if (spires > s.bank.spires) return { error: `the bank has only ${s.bank.spires} spires left` };
  const cost = up * unit;
  const refund = Math.floor(down * unit * rules.economy.buildingRefund);
  if (cost - refund > P(s, p).cash) return { error: `that costs ${money(cost - refund)}` };
  return { cost, refund, domes, spires };
}

function setLevels(s: GameState, rules: RulesConfig, p: number, g: number, levels: number[]): string | null {
  const plan = planLevels(s, rules, p, g, levels);
  if ('error' in plan) return plan.error;
  const grp = rules.board.groups[g]!;
  grp.lots.forEach((pos, i) => (s.level[pos] = levels[i] ?? 0));
  s.bank.domes -= plan.domes;
  s.bank.spires -= plan.spires;
  P(s, p).cash += plan.refund - plan.cost;
  const pl = P(s, p);
  if (plan.cost) log(s, rules, 'build', `${pl.name} builds on ${grp.name} for ${money(plan.cost)}.`, p);
  if (plan.refund) log(s, rules, 'build', `${pl.name} sells buildings on ${grp.name} for ${money(plan.refund)}.`, p);
  return null;
}

function stepLevel(s: GameState, rules: RulesConfig, p: number, pos: number, delta: 1 | -1): string | null {
  const g = groupOf(rules, pos);
  if (g === null) return 'only lots take buildings';
  const grp = rules.board.groups[g]!;
  const levels = grp.lots.map((q) => (s.level[q] ?? 0) + (q === pos ? delta : 0));
  return setLevels(s, rules, p, g, levels);
}

// ---------- bankruptcy ----------

function goBankrupt(s: GameState, rules: RulesConfig, p: number, creditor: Creditor): void {
  const pl = P(s, p);
  const e = rules.economy;
  // Buildings go back to the bank at the refund rate first; the cash follows the rest of the estate.
  s.owner.forEach((o, pos) => {
    if (o !== p) return;
    const sp = rules.board.spaces[pos];
    const lvl = s.level[pos] ?? 0;
    if (sp?.kind === 'lot' && lvl > 0) {
      pl.cash += Math.floor(lvl * sp.terms.buildCost * e.buildingRefund);
      s.bank.domes += domesAt(lvl);
      s.bank.spires += spiresAt(lvl);
      s.level[pos] = 0;
    }
  });
  const lots = s.owner.flatMap((o, pos) => (o === p ? [pos] : []));
  const target = creditor !== 'bank' && !P(s, creditor).bankrupt ? creditor : 'bank';
  if (target === 'bank') {
    for (const id of pl.passes) s.decks[cardById(id).deck].push(id);
    for (const pos of lots) {
      s.owner[pos] = null;
      s.mortgaged[pos] = false;
    }
    s.auctionQueue.push(...lots);
    log(s, rules, 'bankrupt', `${pl.name} is bankrupt. The bank takes everything${lots.length ? ' and auctions the lots' : ''}.`, p);
  } else {
    const c = P(s, target);
    c.cash += Math.max(0, pl.cash);
    c.passes.push(...pl.passes);
    let fees = 0;
    for (const pos of lots) {
      s.owner[pos] = target;
      if (s.mortgaged[pos]) fees += transferFee(e, Math.round(priceOf(rules.board.spaces[pos]!) * e.mortgageShare));
    }
    log(s, rules, 'bankrupt', `${pl.name} is bankrupt. ${c.name} takes their cash, lots and passes.`, p);
    if (fees) charge(s, rules, target, 'bank', fees, 'interest on mortgaged lots received');
  }
  pl.cash = 0;
  pl.passes = [];
  pl.bankrupt = true;
  s.debts = s.debts.filter((d) => d.debtor !== p).map((d) => (d.creditor === p ? { ...d, creditor: 'bank' as const } : d));
  if (s.trade && (s.trade.from === p || s.trade.to === p)) s.trade = null;
  if (s.auction) {
    s.auction.active = s.auction.active.filter((i) => i !== p);
    if (s.auction.leader === p) {
      s.auction.leader = null;
      s.auction.high = 0;
    }
  }
  const live = alive(s);
  if (live.length === 1) {
    const w = live[0]!;
    s.phase = { kind: 'over', winner: w };
    s.auction = null;
    s.auctionQueue = [];
    s.debts = [];
    log(s, rules, 'win', `${P(s, w).name} is the last one standing and wins Moonhold!`, w);
    return;
  }
  if (p === s.current) {
    // The turn passes once any auctions of the estate are done.
    if (s.auctionQueue.length && !s.auction) {
      const pos = s.auctionQueue.shift()!;
      nextTurn(s);
      startAuction(s, rules, pos, 'roll');
    } else if (s.phase.kind === 'auction') s.phase = { kind: 'auction', then: 'next' };
    else nextTurn(s);
  } else if (s.auctionQueue.length && !s.auction) {
    const pos = s.auctionQueue.shift()!;
    startAuction(s, rules, pos, s.phase.kind === 'roll' ? 'roll' : 'end');
  }
}

// ---------- trades ----------

function validBundle(s: GameState, rules: RulesConfig, who: number, b: Bundle): string | null {
  if (!Array.isArray(b.lots) || !Number.isInteger(b.cash) || !Number.isInteger(b.passes) || b.cash < 0 || b.passes < 0) return 'bad offer';
  if (new Set(b.lots).size !== b.lots.length) return 'bad offer';
  const pl = P(s, who);
  if (b.cash > pl.cash) return `${pl.name} does not have ${money(b.cash)}`;
  if (b.passes > pl.passes.length) return `${pl.name} does not hold that many passes`;
  for (const pos of b.lots) {
    if (s.owner[pos] !== who) return `${pl.name} does not own ${spaceName(rules, pos)}`;
    const g = groupOf(rules, pos);
    if (g !== null && groupHasBuildings(s, rules, g)) return `sell the buildings in ${rules.board.groups[g]?.name} before trading its lots`;
  }
  return null;
}

function validTrade(s: GameState, rules: RulesConfig, t: Trade): string | null {
  if (t.from === t.to || !s.players[t.to] || P(s, t.to).bankrupt) return 'pick someone still in the game';
  const empty = (b: Bundle): boolean => b.lots.length === 0 && b.cash === 0 && b.passes === 0;
  if (empty(t.give) && empty(t.get)) return 'the offer is empty';
  return validBundle(s, rules, t.from, t.give) ?? validBundle(s, rules, t.to, t.get);
}

function moveBundle(s: GameState, rules: RulesConfig, from: number, to: number, b: Bundle): number {
  const f = P(s, from);
  const t = P(s, to);
  f.cash -= b.cash;
  t.cash += b.cash;
  t.passes.push(...f.passes.splice(0, b.passes));
  let fees = 0;
  for (const pos of b.lots) {
    s.owner[pos] = to;
    if (s.mortgaged[pos]) fees += transferFee(rules.economy, Math.round(priceOf(rules.board.spaces[pos]!) * rules.economy.mortgageShare));
  }
  return fees;
}

export const describeBundle = (rules: RulesConfig, b: Bundle): string => {
  const parts = [...b.lots.map((pos) => spaceName(rules, pos))];
  if (b.cash) parts.push(money(b.cash));
  if (b.passes) parts.push(`${b.passes} clearance pass${b.passes > 1 ? 'es' : ''}`);
  return parts.length ? parts.join(', ') : 'nothing';
};

// ---------- the reducer ----------

const clone = (s: GameState): GameState => structuredClone(s);

export function apply(state: GameState, player: number, action: Action, rules: RulesConfig = DEFAULT_RULES): Result {
  if (state.phase.kind === 'over') return { error: 'the game is over' };
  if (player !== actorOf(state)) return { error: 'not your move' };
  const s = clone(state);
  const pl = P(s, player);
  const err = (m: string): Result => ({ error: m });
  const manage = (): Result | null => (canManage(s, player) ? null : err('not now'));

  switch (action.type) {
    case 'roll': {
      if (s.debts.length || s.trade || s.phase.kind !== 'roll' || player !== s.current) return err('not now');
      doRoll(s, rules, player);
      break;
    }
    case 'payFine': {
      if (s.debts.length || s.trade || s.phase.kind !== 'roll' || !pl.inQuarantine) return err('not now');
      if (pl.cash < rules.economy.quarantineFee) return err(`the fee is ${money(rules.economy.quarantineFee)}`);
      pl.cash -= rules.economy.quarantineFee;
      pl.inQuarantine = false;
      pl.tries = 0;
      log(s, rules, 'quarantine', `${pl.name} pays ${money(rules.economy.quarantineFee)} and leaves Quarantine.`, player);
      break;
    }
    case 'usePass': {
      if (s.debts.length || s.trade || s.phase.kind !== 'roll' || !pl.inQuarantine) return err('not now');
      const id = pl.passes.shift();
      if (!id) return err('no clearance pass');
      s.decks[cardById(id).deck].push(id);
      pl.inQuarantine = false;
      pl.tries = 0;
      log(s, rules, 'quarantine', `${pl.name} uses a clearance pass and leaves Quarantine.`, player);
      break;
    }
    case 'buy': {
      if (s.debts.length || s.trade || s.phase.kind !== 'buy') return err('not now');
      const { pos, then } = s.phase;
      const price = priceOf(rules.board.spaces[pos]!);
      if (pl.cash < price) return err(`you need ${money(price)}`);
      pl.cash -= price;
      s.owner[pos] = player;
      log(s, rules, 'buy', `${pl.name} buys ${spaceName(rules, pos)} for ${money(price)}.`, player);
      settle(s, then);
      break;
    }
    case 'decline': {
      if (s.debts.length || s.trade || s.phase.kind !== 'buy') return err('not now');
      log(s, rules, 'buy', `${pl.name} passes on ${spaceName(rules, s.phase.pos)}.`, player);
      startAuction(s, rules, s.phase.pos, s.phase.then);
      break;
    }
    case 'bid': {
      const a = s.auction;
      if (s.debts.length || !a || s.phase.kind !== 'auction') return err('not now');
      const min = a.high + rules.economy.minBidStep;
      if (!Number.isInteger(action.amount) || action.amount < min) return err(`bid at least ${money(min)}`);
      if (action.amount > pl.cash) return err(`you have ${money(pl.cash)}`);
      a.high = action.amount;
      a.leader = player;
      log(s, rules, 'auction', `${pl.name} bids ${money(action.amount)}.`, player);
      auctionStep(s, rules);
      break;
    }
    case 'passBid': {
      const a = s.auction;
      if (s.debts.length || !a || s.phase.kind !== 'auction') return err('not now');
      const next = nextBidder(a, player);
      a.active = a.active.filter((i) => i !== player);
      log(s, rules, 'auction', `${pl.name} drops out.`, player);
      if (next !== null && next !== player) a.bidder = next;
      const only = a.active.length === 1 ? a.active[0] : undefined;
      if (a.active.length === 0 || (only !== undefined && only === a.leader) || next === null || next === player) finishAuction(s, rules);
      break;
    }
    case 'setLevels': {
      const no = manage();
      if (no) return no;
      const e = setLevels(s, rules, player, action.group, action.levels);
      if (e) return err(e);
      break;
    }
    case 'build':
    case 'sell': {
      const no = manage();
      if (no) return no;
      const e = stepLevel(s, rules, player, action.pos, action.type === 'build' ? 1 : -1);
      if (e) return err(e);
      break;
    }
    case 'mortgage': {
      const no = manage();
      if (no) return no;
      const sp = rules.board.spaces[action.pos];
      if (!sp || !isOwnable(sp) || s.owner[action.pos] !== player) return err('not yours');
      if (s.mortgaged[action.pos]) return err('already mortgaged');
      const g = groupOf(rules, action.pos);
      if (g !== null && groupHasBuildings(s, rules, g)) return err('sell the buildings in this group first');
      const m = Math.round(priceOf(sp) * rules.economy.mortgageShare);
      s.mortgaged[action.pos] = true;
      pl.cash += m;
      log(s, rules, 'mortgage', `${pl.name} mortgages ${sp.name} for ${money(m)}.`, player);
      break;
    }
    case 'unmortgage': {
      const no = manage();
      if (no) return no;
      const sp = rules.board.spaces[action.pos];
      if (!sp || !isOwnable(sp) || s.owner[action.pos] !== player) return err('not yours');
      if (!s.mortgaged[action.pos]) return err('not mortgaged');
      const cost = unmortgageCost(rules.economy, Math.round(priceOf(sp) * rules.economy.mortgageShare));
      if (pl.cash < cost) return err(`lifting it costs ${money(cost)}`);
      pl.cash -= cost;
      s.mortgaged[action.pos] = false;
      log(s, rules, 'mortgage', `${pl.name} lifts the mortgage on ${sp.name} for ${money(cost)}.`, player);
      break;
    }
    case 'propose': {
      const no = manage();
      if (no) return no;
      if (s.phase.kind === 'buy') return err('decide on the purchase first');
      const t: Trade = { from: player, to: action.to, give: action.give, get: action.get };
      const e = validTrade(s, rules, t);
      if (e) return err(e);
      s.trade = t;
      log(s, rules, 'trade', `${pl.name} offers ${P(s, t.to).name} ${describeBundle(rules, t.give)} for ${describeBundle(rules, t.get)}.`, player);
      break;
    }
    case 'accept':
    case 'reject': {
      const t = s.trade;
      if (!t) return err('no offer');
      s.trade = null;
      if (action.type === 'reject') {
        log(s, rules, 'trade', `${pl.name} turns the offer down.`, player);
        break;
      }
      const e = validTrade(s, rules, t);
      if (e) return err(e);
      const feeTo = moveBundle(s, rules, t.from, t.to, t.give);
      const feeFrom = moveBundle(s, rules, t.to, t.from, t.get);
      log(s, rules, 'trade', `${pl.name} accepts the trade with ${P(s, t.from).name}.`, player);
      if (feeTo) charge(s, rules, t.to, 'bank', feeTo, 'interest on mortgaged lots received');
      if (feeFrom) charge(s, rules, t.from, 'bank', feeFrom, 'interest on mortgaged lots received');
      break;
    }
    case 'payDebt': {
      const d = s.debts[0];
      if (!d) return err('nothing owed');
      if (pl.cash < d.amount) return err(`raise ${money(d.amount - pl.cash)} more first`);
      pl.cash -= d.amount;
      if (d.creditor !== 'bank') P(s, d.creditor).cash += d.amount;
      s.debts.shift();
      log(s, rules, 'debt', `${pl.name} pays ${money(d.amount)}.`, player);
      break;
    }
    case 'bankrupt': {
      const d = s.debts[0];
      if (!d) return err('you can only go bankrupt when you owe more than you can pay');
      if (liquidationValue(s, rules, player) >= d.amount) return err('you can still raise enough: sell buildings or mortgage lots');
      goBankrupt(s, rules, player, d.creditor);
      break;
    }
    case 'endTurn': {
      if (s.debts.length || s.trade || s.phase.kind !== 'end') return err('not now');
      nextTurn(s);
      log(s, rules, 'turn', `Over to ${P(s, s.current).name}.`, s.current);
      break;
    }
    default:
      return err('unknown action');
  }
  return { state: s };
}

