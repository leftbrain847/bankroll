/**
 * Bankroll client: setup, the board, the action panel and the sheets (space details, holdings, trades, rules).
 * Everything runs on this device. The rules engine (src/game/) decides what is legal; this file only renders the
 * state, turns taps into engine actions, paces the bots and saves the game locally.
 */
import config from '../../app.config.json';
import { BOARD, isOwnable, priceOf } from '../game/board';
import { DECK_NAMES, cardById } from '../game/cards';
import { unmortgageCost } from '../game/economy';
import { botStep, raiseCash } from '../game/ai';
import {
  actorOf, apply, canManage, DEFAULT_RULES, describeBundle, groupHasBuildings, groupOf, liquidationValue, MAX_LEVEL, money, newGame, ownsGroup, rentFor,
  type Action, type GameState, type LogEntry, type PlayerSetup,
} from '../game/rules';
import { createBoardView, TOKENS } from './board-view';
import { HELP } from './help';
import { isMuted, play, setMuted, type Cue } from './sound';
import { button, el, render, store } from './ui';

const RULES = DEFAULT_RULES;
const SAVE_KEY = 'bankroll.save.v2';
const PREFS_KEY = 'bankroll.prefs.v1';
const PACE = { bot: 700, botAuction: 380, afterCard: 1500, afterMove: 450 };
const MAX_NAME = 14;

type Sheet =
  | { kind: 'space'; pos: number }
  | { kind: 'holdings'; player: number }
  | { kind: 'trade'; to: number; give: Set<number>; get: Set<number>; giveCash: number; getCash: number; givePasses: number; getPasses: number }
  | { kind: 'help' }
  | null;

interface Ui {
  screen: 'setup' | 'game';
  game: GameState | null;
  setup: PlayerSetup[];
  sheet: Sheet;
  error: string;
  selected: number | null;
  heardSeq: number;
}

const ui: Ui = { screen: 'setup', game: null, setup: [], sheet: null, error: '', selected: null, heardSeq: 0 };

const seed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;

// ---------- prefs and save ----------

try {
  const prefs = JSON.parse(store.get(PREFS_KEY) ?? '{}') as { muted?: boolean };
  setMuted(!!prefs.muted);
} catch {
  /* defaults */
}

function loadSave(): GameState | null {
  try {
    const raw = store.get(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (!Array.isArray(s.players) || s.owner?.length !== BOARD.spaces.length || !s.phase) return null;
    return s;
  } catch {
    return null;
  }
}

const save = (): void => {
  if (ui.game) store.set(SAVE_KEY, JSON.stringify(ui.game));
};

// ---------- engine glue ----------

const board = createBoardView(
  (pos) => {
    play('tap');
    ui.selected = pos;
    ui.sheet = { kind: 'space', pos };
    draw();
  },
  () => play('step'),
);

function cueFor(entries: LogEntry[]): Cue | null {
  const order: [LogEntry['kind'], Cue][] = [
    ['win', 'win'], ['bankrupt', 'bankrupt'], ['jail', 'jail'], ['card', 'card'], ['buy', 'buy'], ['build', 'build'],
    ['rent', 'pay'], ['tax', 'pay'], ['salary', 'coin'], ['auction', 'bid'], ['roll', 'roll'],
  ];
  for (const [k, c] of order) if (entries.some((e) => e.kind === k)) return c;
  return null;
}

function setGame(next: GameState): void {
  const fresh = next.log.filter((e) => e.seq > ui.heardSeq);
  ui.heardSeq = next.seq;
  ui.game = next;
  ui.error = '';
  const cue = cueFor(fresh);
  if (cue) play(cue);
  save();
  draw();
  scheduleBot();
}

function act(a: Action): void {
  const s = ui.game;
  if (!s) return;
  const r = apply(s, actorOf(s), a, RULES);
  if (!r.state) {
    ui.error = r.error;
    draw();
    return;
  }
  setGame(r.state);
}

let botTimer: ReturnType<typeof setTimeout> | null = null;
let botEpoch = 0;

function scheduleBot(): void {
  const s = ui.game;
  if (botTimer) clearTimeout(botTimer);
  botTimer = null;
  if (!s || s.phase.kind === 'over') return;
  const p = s.players[actorOf(s)];
  if (!p?.bot) return;
  const epoch = ++botEpoch;
  const lastKind = s.log.at(-1)?.kind;
  const delay = s.phase.kind === 'auction' ? PACE.botAuction : lastKind === 'card' ? PACE.afterCard : PACE.bot;
  void board.settled().then(() => {
    if (epoch !== botEpoch) return;
    botTimer = setTimeout(() => {
      if (epoch !== botEpoch || ui.game !== s) return;
      setGame(botStep(s, RULES));
    }, delay);
  });
}

function startGame(setup: PlayerSetup[]): void {
  const s = newGame(setup, seed(), RULES);
  ui.screen = 'game';
  ui.sheet = null;
  ui.selected = null;
  ui.heardSeq = 0;
  setGame(s);
}

// ---------- small views ----------

const tokenDot = (token: number, big = false): HTMLElement =>
  el('span', { className: `tok t${token}${big ? ' big' : ''}`, attrs: { 'aria-hidden': 'true' } });

function dice(roll: [number, number] | null): HTMLElement {
  const face = (n: number) => {
    const on: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    return el('span', { className: 'die', attrs: { 'aria-label': `die showing ${n}` } }, Array.from({ length: 9 }, (_, i) => el('i', { className: on[n]?.includes(i) ? 'on' : '' })));
  };
  return el('div', { className: 'dice' }, roll ? [face(roll[0]), face(roll[1])] : []);
}

function spaceKindLabel(pos: number): string {
  const sp = BOARD.spaces[pos]!;
  switch (sp.kind) {
    case 'lot':
      return `${BOARD.groups[sp.group]!.name}`;
    case 'subway':
      return 'Subway line';
    case 'utility':
      return 'Utility';
    case 'draw':
      return `${DECK_NAMES[sp.deck]} card`;
    case 'levy':
      return 'Levy';
    default:
      return 'Corner';
  }
}

function spaceFacts(s: GameState, pos: number): HTMLElement {
  const sp = BOARD.spaces[pos]!;
  const rows: [string, string][] = [];
  const e = RULES.economy;
  if (sp.kind === 'lot') {
    const t = sp.terms;
    rows.push(['Price', money(t.price)], ['Bare rent, whole set owned', money(t.rent[0] * e.fullGroupMultiplier)], ['Building cost', `${money(t.buildCost)} each`], ['Mortgage value', money(t.mortgage)]);
  } else if (sp.kind === 'subway') {
    rows.push(['Price', money(sp.price)], ...[1, 2, 3, 4].map((n) => [`Owner has ${n} line${n > 1 ? 's' : ''}`, money(e.subwayRent * 2 ** (n - 1))] as [string, string]), ['Mortgage', money(Math.round(sp.price * e.mortgageShare))]);
  } else if (sp.kind === 'utility') {
    rows.push(['Price', money(sp.price)], ['Owner has one utility', `dice × ${e.utilityMultiplierOne}`], ['Owner has both', `dice × ${e.utilityMultiplierBoth}`], ['Mortgage', money(Math.round(sp.price * e.mortgageShare))]);
  } else if (sp.kind === 'levy') rows.push(['Pay', money(sp.amount)]);
  else if (sp.kind === 'draw') rows.push(['Effect', `Draw a ${DECK_NAMES[sp.deck]} card`]);
  else if (sp.corner === 'start') rows.push(['Salary', `${money(e.salary)} each time you pass or land here`]);
  else if (sp.corner === 'jail') rows.push(['Landing here by a roll', 'No effect'], ['Getting out', `${money(e.jailFine)}, a jail pass, or doubles`]);
  else if (sp.corner === 'rest') rows.push(['Effect', 'Nothing happens. Take a breather']);
  else rows.push(['Effect', 'You are arrested: move to Jail, turn ends']);
  const o = s.owner[pos];
  if (isOwnable(sp)) {
    rows.push(['Owner', o === null || o === undefined ? 'For sale' : `${s.players[o]!.name}${s.mortgaged[pos] ? ' (mortgaged)' : ''}`]);
    if (o !== null && o !== undefined) {
      const lvl = s.level[pos] ?? 0;
      if (sp.kind === 'lot') rows.push(['Buildings', lvl === 5 ? 'Hotel' : lvl ? `${lvl} house${lvl > 1 ? 's' : ''}` : 'None']);
      rows.push(['Rent now', sp.kind === 'utility' ? `dice × ${rentFor(s, RULES, pos, 1)}` : money(rentFor(s, RULES, pos, 7))]);
    }
  }
  return el('dl', { className: 'facts' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
}

/** Build / sell / mortgage controls for one property, when its owner may manage now. */
function claimControls(s: GameState, pos: number): HTMLElement | null {
  const me = actorOf(s);
  if (s.owner[pos] !== me || !canManage(s, me) || s.players[me]?.bot) return null;
  const sp = BOARD.spaces[pos]!;
  const e = RULES.economy;
  const btns: HTMLElement[] = [];
  if (sp.kind === 'lot') {
    const lvl = s.level[pos] ?? 0;
    const can = (a: Action) => !apply(s, me, a, RULES).error;
    if (lvl < MAX_LEVEL && ownsGroup(s, RULES, me, sp.group)) btns.push(button(`Build ${lvl === 4 ? 'hotel' : 'house'} ${money(sp.terms.buildCost)}`, () => act({ type: 'build', pos }), 'small', !can({ type: 'build', pos })));
    if (lvl > 0) btns.push(button(`Sell ${lvl === 5 ? 'hotel' : 'house'}`, () => act({ type: 'sell', pos }), 'small ghost', !can({ type: 'sell', pos })));
    if (lvl > 0 && groupHasBuildings(s, RULES, sp.group)) {
      const g = BOARD.groups[sp.group]!;
      const flat: Action = { type: 'setLevels', group: sp.group, levels: g.lots.map(() => 0) };
      if (can(flat) && !can({ type: 'sell', pos })) btns.push(button('Sell all in set', () => act(flat), 'small ghost'));
    }
  }
  const mval = Math.round(priceOf(sp) * e.mortgageShare);
  if (s.mortgaged[pos]) btns.push(button(`Pay off ${money(unmortgageCost(e, mval))}`, () => act({ type: 'unmortgage', pos }), 'small ghost', (s.players[me]?.cash ?? 0) < unmortgageCost(e, mval)));
  else {
    const g = groupOf(RULES, pos);
    btns.push(button(`Mortgage for ${money(mval)}`, () => act({ type: 'mortgage', pos }), 'small ghost', g !== null && groupHasBuildings(s, RULES, g)));
  }
  return el('div', { className: 'row' }, btns);
}

function levelText(lvl: number): string {
  return lvl === 5 ? 'hotel' : lvl ? `${lvl} house${lvl > 1 ? 's' : ''}` : '';
}

// ---------- sheets ----------

function sheetFrame(title: string, body: Node[], extra: Node[] = []): HTMLElement {
  const sheet = el('section', { className: 'sheet', attrs: { role: 'dialog', 'aria-label': title } }, [
    el('header', {}, [el('h2', { text: title }), button('Close', () => close(), 'small ghost')]),
    ...body,
    ...extra,
  ]);
  // Taps inside the sheet must not reach the scrim, which closes it.
  sheet.addEventListener('click', (ev) => ev.stopPropagation());
  return el('div', { className: 'scrim', onClick: () => close() }, [sheet]);
}

function close(): void {
  ui.sheet = null;
  ui.selected = null;
  ui.error = '';
  draw();
}

function spaceSheet(s: GameState, pos: number): HTMLElement {
  const sp = BOARD.spaces[pos]!;
  const grp = sp.kind === 'lot' ? BOARD.groups[sp.group] : null;
  const head = el('div', { className: 'prop-head' }, [
    el('span', { className: 'swatch', text: grp?.mark ?? '', style: { background: grp?.color ?? 'var(--line)', color: 'var(--ink)' } }),
    el('div', {}, [el('strong', { text: sp.name }), el('span', { className: 'muted', text: spaceKindLabel(pos) })]),
  ]);
  // Rents as a grid of tiles: bare, whole set, 1-4 houses, hotel. The current level is highlighted.
  let grid: HTMLElement | null = null;
  if (sp.kind === 'lot') {
    const t = sp.terms;
    const lvl = s.level[pos] ?? 0;
    const tiles: [string, number, boolean][] = [
      ['Bare', t.rent[0], lvl === 0],
      ...[1, 2, 3, 4].map((n) => [`${n} house${n > 1 ? 's' : ''}`, t.rent[n]!, lvl === n] as [string, number, boolean]),
      ['Hotel', t.rent[5], lvl === 5],
    ];
    grid = el('div', { className: 'rent-grid', attrs: { 'aria-label': 'Rent by buildings' } }, tiles.map(([label, v, on]) =>
      el('div', { className: `rent-tile${on && s.owner[pos] !== null ? ' on' : ''}` }, [el('span', { text: label }), el('strong', { text: money(v) })])));
  }
  const card = el('div', { className: 'prop' }, [head, grid, spaceFacts(s, pos)].filter(Boolean) as Node[]);
  const controls = claimControls(s, pos);
  return sheetFrame('Details', [card, controls, ui.error ? el('p', { className: 'error', text: ui.error }) : null].filter(Boolean) as Node[]);
}

function holdingsSheet(s: GameState, p: number): HTMLElement {
  const pl = s.players[p]!;
  const mine = s.owner.flatMap((o, i) => (o === p ? [i] : []));
  const rows = mine.map((pos) => {
    const sp = BOARD.spaces[pos]!;
    const grp = sp.kind === 'lot' ? BOARD.groups[sp.group]! : null;
    return el('li', { className: 'holding' }, [
      el('div', { className: 'holding-name' }, [
        el('span', { className: 'swatch sm', text: grp?.mark ?? (sp.kind === 'subway' ? '◇' : '⬡'), style: { background: grp?.color ?? 'var(--line)', color: 'var(--ink)' } }),
        el('button', { className: 'link', text: sp.name, onClick: () => ((ui.sheet = { kind: 'space', pos }), (ui.selected = pos), draw()) }),
        el('span', { className: 'muted', text: `${s.mortgaged[pos] ? 'mortgaged ' : ''}${levelText(s.level[pos] ?? 0)}` }),
      ]),
      claimControls(s, pos),
    ]);
  });
  return sheetFrame(`${pl.name}'s properties`, [
    el('p', { className: 'muted', text: `${money(pl.cash)} in hand · ${pl.passes.length} jail pass${pl.passes.length === 1 ? '' : 'es'} · could raise ${money(liquidationValue(s, RULES, p))} in all` }),
    rows.length ? el('ul', { className: 'holdings' }, rows) : el('p', { text: 'No properties yet.' }),
    ui.error ? el('p', { className: 'error', text: ui.error }) : null,
  ].filter(Boolean) as Node[]);
}

function tradeSheet(s: GameState, t: Extract<Sheet, { kind: 'trade' }>): HTMLElement {
  const me = actorOf(s);
  const others = s.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== me && !p.bankrupt);
  const tradable = (p: number) =>
    s.owner.flatMap((o, pos) => {
      if (o !== p) return [];
      const g = groupOf(RULES, pos);
      return g !== null && groupHasBuildings(s, RULES, g) ? [] : [pos];
    });
  const pick = (set: Set<number>, pos: number) => {
    if (set.has(pos)) set.delete(pos);
    else set.add(pos);
    draw();
  };
  const lotList = (owner: number, set: Set<number>) =>
    el('ul', { className: 'picks' }, tradable(owner).map((pos) => {
      const sp = BOARD.spaces[pos]!;
      const grp = sp.kind === 'lot' ? BOARD.groups[sp.group] : null;
      return el('li', {}, [
        el('button', { className: `pick${set.has(pos) ? ' on' : ''}`, onClick: () => pick(set, pos), attrs: { 'aria-pressed': String(set.has(pos)), type: 'button' } }, [
          el('span', { className: 'swatch sm', text: grp?.mark ?? (sp.kind === 'subway' ? '◇' : '⬡'), style: { background: grp?.color ?? 'var(--line)', color: 'var(--ink)' } }),
          el('span', { text: `${sp.name}${s.mortgaged[pos] ? ' (m)' : ''}` }),
        ]),
      ]);
    }));
  const stepper = (label: string, value: number, max: number, set: (v: number) => void, steps: number[]) =>
    el('div', { className: 'stepper' }, [
      el('span', { text: label }),
      ...steps.map((d) => button(d > 0 ? `+${d}` : `${d}`, () => (set(Math.max(0, Math.min(max, value + d))), draw()), 'small ghost')),
    ]);
  const meP = s.players[me]!;
  const them = s.players[t.to];
  const draft: Action = {
    type: 'propose',
    to: t.to,
    give: { lots: [...t.give], cash: t.giveCash, passes: t.givePasses },
    get: { lots: [...t.get], cash: t.getCash, passes: t.getPasses },
  };
  return sheetFrame('Make an offer', [
    el('div', { className: 'row' }, others.map(({ p, i }) => button(p.name, () => {
      Object.assign(t, { to: i, get: new Set<number>(), getCash: 0, getPasses: 0 });
      draw();
    }, `small ${i === t.to ? '' : 'ghost'}`))),
    el('div', { className: 'trade-cols' }, [
      el('div', {}, [
        el('h3', { text: 'You give' }),
        lotList(me, t.give),
        stepper(`Cash ${money(t.giveCash)}`, t.giveCash, meP.cash, (v) => (t.giveCash = v), [-50, -10, 10, 50]),
        meP.passes.length ? stepper(`Passes ${t.givePasses}`, t.givePasses, meP.passes.length, (v) => (t.givePasses = v), [-1, 1]) : null,
      ].filter(Boolean) as Node[]),
      el('div', {}, [
        el('h3', { text: `${them?.name ?? '—'} gives` }),
        lotList(t.to, t.get),
        stepper(`Cash ${money(t.getCash)}`, t.getCash, them?.cash ?? 0, (v) => (t.getCash = v), [-50, -10, 10, 50]),
        them?.passes.length ? stepper(`Passes ${t.getPasses}`, t.getPasses, them.passes.length, (v) => (t.getPasses = v), [-1, 1]) : null,
      ].filter(Boolean) as Node[]),
    ]),
    ui.error ? el('p', { className: 'error', text: ui.error }) : null,
    el('div', { className: 'row' }, [
      button('Send offer', () => {
        const r = apply(s, me, draft, RULES);
        if (!r.state) {
          ui.error = r.error;
          draw();
          return;
        }
        ui.sheet = null;
        setGame(r.state);
      }, 'primary'),
    ]),
  ].filter(Boolean) as Node[]);
}

function helpSheet(): HTMLElement {
  return sheetFrame('How to play', HELP.flatMap((sec) => [el('h3', { text: sec.title }), ...sec.body.map((b) => el('p', { text: b }))]));
}

// ---------- the action panel ----------

function panel(s: GameState): HTMLElement {
  const a = actorOf(s);
  const p = s.players[a];
  const e = RULES.economy;
  const kids: (Node | null)[] = [];

  if (s.phase.kind === 'over') {
    const w = s.players[s.phase.winner]!;
    kids.push(el('p', { className: 'big', text: `${w.name} wins with ${money(w.cash)}!` }), button('New game', () => ((ui.screen = 'setup'), store.remove(SAVE_KEY), draw()), 'primary'));
    return el('div', { className: 'panel' }, kids);
  }
  if (!p) return el('div', { className: 'panel' });

  kids.push(el('div', { className: 'turn-banner', style: { '--tok': TOKENS[p.token]?.color ?? '#fff' } }, [
    tokenDot(p.token, true),
    el('strong', { text: p.bot ? `${p.name} is thinking…` : a === s.current && !s.trade && !s.debts.length && s.phase.kind !== 'auction' ? `${p.name}, your move` : `${p.name}, over to you` }),
    el('span', { className: 'cash', text: money(p.cash) }),
  ]));

  if (p.bot) return el('div', { className: 'panel' }, kids);

  const row = (...b: (HTMLElement | null)[]) => el('div', { className: 'row' }, b.filter(Boolean) as HTMLElement[]);
  const manageRow = () => row(button('My properties', () => ((ui.sheet = { kind: 'holdings', player: a }), draw()), 'ghost'),
    button('Trade', () => {
      const to = s.players.findIndex((q, i) => i !== a && !q.bankrupt);
      ui.sheet = { kind: 'trade', to, give: new Set(), get: new Set(), giveCash: 0, getCash: 0, givePasses: 0, getPasses: 0 };
      draw();
    }, 'ghost', s.phase.kind === 'buy'));

  const d = s.debts[0];
  if (s.trade && s.trade.to === a) {
    const from = s.players[s.trade.from]!;
    kids.push(
      el('p', { text: `${from.name} offers you ${describeBundle(RULES, s.trade.give)}, and asks for ${describeBundle(RULES, s.trade.get)}.` }),
      row(button('Accept', () => act({ type: 'accept' }), 'primary'), button('Decline', () => act({ type: 'reject' }), 'ghost')),
    );
  } else if (d) {
    const to = d.creditor === 'bank' ? 'the bank' : s.players[d.creditor]!.name;
    const short = d.amount - p.cash;
    const canQuit = liquidationValue(s, RULES, a) < d.amount;
    kids.push(
      el('p', { text: `You owe ${to} ${money(d.amount)} (${d.reason}).${short > 0 ? ` Raise ${money(short)} more by selling buildings, mortgaging or trading.` : ''}` }),
      row(
        button(`Pay ${money(d.amount)}`, () => act({ type: 'payDebt' }), 'primary', short > 0),
        short > 0 && !canQuit ? button('Raise it for me', () => autoRaise(), 'ghost') : null,
        canQuit ? button('Declare bankruptcy', () => act({ type: 'bankrupt' }), 'danger') : null,
      ),
      manageRow(),
    );
  } else if (s.phase.kind === 'auction' && s.auction) {
    const au = s.auction;
    const lead = au.leader === null ? 'No bids yet' : `High bid ${money(au.high)} by ${s.players[au.leader]!.name}`;
    const incs = [5, 25, 100].map((n) => Math.max(e.minBidStep, n));
    kids.push(
      el('p', { text: `Auction: ${BOARD.spaces[au.pos]!.name} (listed ${money(priceOf(BOARD.spaces[au.pos]!))}). ${lead}.` }),
      row(...incs.map((n) => button(`Bid ${money(au.high + n)}`, () => act({ type: 'bid', amount: au.high + n }), 'primary', au.high + n > p.cash)), button('Drop out', () => act({ type: 'passBid' }), 'ghost')),
    );
  } else if (s.phase.kind === 'buy') {
    const pos = s.phase.pos;
    const price = priceOf(BOARD.spaces[pos]!);
    kids.push(
      el('p', { text: `${BOARD.spaces[pos]!.name} is for sale.` }),
      row(
        button(`Buy for ${money(price)}`, () => act({ type: 'buy' }), 'primary', p.cash < price),
        button('Auction it', () => act({ type: 'decline' }), 'ghost'),
        button('Details', () => ((ui.sheet = { kind: 'space', pos }), (ui.selected = pos), draw()), 'ghost'),
      ),
      p.cash < price ? manageRow() : null,
    );
  } else if (s.phase.kind === 'roll') {
    if (p.inJail) {
      kids.push(
        el('p', { text: `In Jail (try ${p.tries + 1} of ${RULES.jailTries}).` }),
        row(
          button('Roll for doubles', () => act({ type: 'roll' }), 'primary act-roll'),
          button(`Pay ${money(e.jailFine)}`, () => act({ type: 'payFine' }), 'ghost', p.cash < e.jailFine),
          p.passes.length ? button('Use jail pass', () => act({ type: 'usePass' }), 'ghost') : null,
        ),
      );
    } else kids.push(row(button(s.doubles ? 'Roll again' : 'Roll', () => act({ type: 'roll' }), 'primary act-roll')));
    kids.push(manageRow());
  } else if (s.phase.kind === 'end') {
    kids.push(row(button('End turn', () => act({ type: 'endTurn' }), 'primary act-end')), manageRow());
  }
  if (ui.error && !ui.sheet) kids.push(el('p', { className: 'error', text: ui.error }));
  return el('div', { className: 'panel' }, kids);
}

function autoRaise(): void {
  let s = ui.game;
  if (!s) return;
  const a = actorOf(s);
  const d = s.debts[0];
  for (let i = 0; i < 60 && d && s.players[a]!.cash < d.amount; i++) {
    const step = raiseCash(s, RULES, a);
    if (!step) break;
    const r = apply(s, a, step, RULES);
    if (!r.state) break;
    s = r.state;
  }
  setGame(s);
}

// ---------- hub (centre of the board) ----------

function hub(s: GameState): HTMLElement {
  const lastRollSeq = Math.max(0, ...s.log.filter((e) => e.kind === 'roll').map((e) => e.seq));
  const card = s.lastCard && s.lastCard.seq >= lastRollSeq ? cardById(s.lastCard.id) : null;
  const latest = s.log.at(-1);
  const kids: Node[] = [dice(s.lastRoll)];
  if (card) {
    kids.push(el('div', { className: `card ${card.deck}` }, [
      el('span', { className: 'deck', text: DECK_NAMES[card.deck] }),
      el('strong', { text: card.title }),
      el('span', { text: card.text }),
    ]));
  } else if (latest) kids.push(el('p', { className: 'latest', text: latest.text }));
  return el('div', { className: 'hub', attrs: { 'aria-live': 'polite' } }, kids);
}

function players(s: GameState): HTMLElement {
  return el('ul', { className: 'players' }, s.players.map((p, i) =>
    el('li', {}, [
      el('button', {
        className: `chip${i === s.current ? ' current' : ''}${p.bankrupt ? ' out' : ''}`,
        onClick: () => ((ui.sheet = { kind: 'holdings', player: i }), draw()),
        attrs: { type: 'button', 'aria-label': `${p.name}: ${money(p.cash)}${p.bankrupt ? ', out' : ''}` },
      }, [
        tokenDot(p.token),
        el('span', { className: 'chip-name', text: p.name }),
        el('span', { className: 'chip-cash', text: p.bankrupt ? 'out' : money(p.cash) }),
        el('span', { className: 'chip-meta', text: `${s.owner.filter((o) => o === i).length} properties${p.passes.length ? ` · ${p.passes.length} pass` : ''}${p.inJail ? ' · Q' : ''}${p.bot ? ' · bot' : ''}` }),
      ]),
    ])));
}

function logView(s: GameState): HTMLElement {
  return el('ol', { className: 'log' }, [...s.log].reverse().slice(0, 8).map((e) => el('li', { text: e.text, className: `log-${e.kind}` })));
}

function topBar(): HTMLElement {
  return el('header', { className: 'top' }, [
    el('h1', { text: config.title }),
    el('div', { className: 'row' }, [
      button(isMuted() ? '♪ Off' : '♪ On', () => {
        setMuted(!isMuted());
        store.set(PREFS_KEY, JSON.stringify({ muted: isMuted() }));
        draw();
      }, 'small ghost'),
      button('Rules', () => ((ui.sheet = { kind: 'help' }), draw()), 'small ghost'),
      ui.screen === 'game' ? button('Menu', () => {
        botEpoch++;
        ui.screen = 'setup';
        ui.sheet = null;
        draw();
      }, 'small ghost') : null,
    ].filter(Boolean) as Node[]),
  ]);
}

// ---------- setup ----------

const BOT_NAMES = ['Vega', 'Orrin', 'Tamsin', 'Juno', 'Pell', 'Ishka'];

function defaultSetup(): PlayerSetup[] {
  return [
    { name: 'Captain', token: 0, bot: false },
    { name: BOT_NAMES[1]!, token: 1, bot: true },
    { name: BOT_NAMES[2]!, token: 2, bot: true },
  ];
}

function setupScreen(): HTMLElement {
  if (!ui.setup.length) ui.setup = defaultSetup();
  const st = ui.setup;
  const saved = loadSave();
  const nextToken = (cur: number) => {
    const used = new Set(st.map((p) => p.token));
    for (let k = 1; k <= TOKENS.length; k++) {
      const t = (cur + k) % TOKENS.length;
      if (!used.has(t)) return t;
    }
    return cur;
  };
  const rows = st.map((p, i) => el('li', { className: 'seat' }, [
    el('button', { className: 'tokbtn', onClick: () => ((p.token = nextToken(p.token)), draw()), attrs: { type: 'button', 'aria-label': `Token: ${TOKENS[p.token]?.name}. Tap to change.` } }, [tokenDot(p.token, true)]),
    (() => {
      const inp = el('input', { attrs: { value: p.name, maxlength: String(MAX_NAME), 'aria-label': `Player ${i + 1} name`, autocomplete: 'off' } });
      inp.addEventListener('input', () => (p.name = inp.value.slice(0, MAX_NAME)));
      return inp;
    })(),
    button(p.bot ? 'Bot' : 'Human', () => ((p.bot = !p.bot), draw()), `small ${p.bot ? 'ghost' : ''}`),
    st.length > RULES.minPlayers ? button('✕', () => (st.splice(i, 1), draw()), 'small ghost') : null,
  ].filter(Boolean) as Node[]));
  return el('main', { className: 'setup' }, [
    topBar(),
    el('p', { className: 'lede', text: 'Buy property, build houses and hotels, collect rent, and outlast everyone else. Pass one device around, add bots, or both.' }),
    el('div', { className: 'row' }, [
      button('Quick game vs 3 bots', () => startGame([{ name: 'Captain', token: 0, bot: false }, ...[1, 2, 3].map((t) => ({ name: BOT_NAMES[t]!, token: t, bot: true }))]), 'primary quick'),
      saved && saved.phase.kind !== 'over' ? button('Resume saved game', () => {
        ui.screen = 'game';
        ui.heardSeq = saved.seq;
        setGame(saved);
      }, 'ghost') : null,
    ].filter(Boolean) as Node[]),
    el('h2', { text: 'Players' }),
    el('ul', { className: 'seats' }, rows),
    el('div', { className: 'row' }, [
      st.length < RULES.maxPlayers ? button('Add player', () => {
        st.push({ name: BOT_NAMES[st.length] ?? `Bot ${st.length + 1}`, token: nextToken(st.at(-1)?.token ?? 0), bot: true });
        draw();
      }, 'ghost') : null,
      button('Start game', () => {
        const clean = st.map((p, i) => ({ ...p, name: p.name.trim().slice(0, MAX_NAME) || `Player ${i + 1}` }));
        startGame(clean);
      }, 'primary start'),
    ].filter(Boolean) as Node[]),
    el('p', { className: 'muted', text: 'Tip: tap any space on the board to see its prices and rents.' }),
  ]);
}

// ---------- render ----------

function draw(): void {
  if (ui.screen === 'setup' || !ui.game) {
    render(el('div', {}, [setupScreen(), ui.sheet?.kind === 'help' ? helpSheet() : null].filter(Boolean) as Node[]));
    return;
  }
  const s = ui.game;
  const stage = el('div', { className: 'stage' }, [board.canvas, hub(s)]);
  const sheet = ui.sheet;
  const sheetEl = !sheet
    ? null
    : sheet.kind === 'space'
      ? spaceSheet(s, sheet.pos)
      : sheet.kind === 'holdings'
        ? holdingsSheet(s, sheet.player)
        : sheet.kind === 'trade'
          ? tradeSheet(s, sheet)
          : helpSheet();
  render(el('main', { className: 'game' }, [topBar(), stage, panel(s), players(s), logView(s), sheetEl].filter(Boolean) as Node[]));
  board.update(s, ui.selected);
}

draw();
