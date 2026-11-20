import { describe, expect, it } from 'vitest';
import { BOARD, BOARD_SIZE, QUARANTINE } from '../src/game/board';
import { DECKS } from '../src/game/cards';
import { ECONOMY, lotTerms } from '../src/game/economy';
import { botStep, judgeTrade } from '../src/game/ai';
import { actorOf, apply, DEFAULT_RULES, newGame, rand, rentFor, type Action, type GameState } from '../src/game/rules';

const E = ECONOMY;
const lot = (pos: number) => {
  const sp = BOARD.spaces[pos];
  if (sp?.kind !== 'lot') throw new Error(`${pos} is not a lot`);
  return sp;
};

function game(n = 3, seed = 1): GameState {
  return newGame(Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: i, bot: false })), seed);
}

/** Point the generator at a seed whose next two dice are a and b. */
function rig(s: GameState, a: number, b: number): GameState {
  for (let seed = 0; ; seed++) {
    const [v1, n1] = rand(seed);
    const [v2] = rand(n1);
    if (1 + Math.floor(v1 * 6) === a && 1 + Math.floor(v2 * 6) === b) {
      s.rng = seed;
      return s;
    }
  }
}

function act(s: GameState, a: Action, who = actorOf(s)): GameState {
  const r = apply(s, who, a);
  if (!r.state) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

const fails = (s: GameState, a: Action, who = actorOf(s)): string => apply(s, who, a).error ?? '';

function roll(s: GameState, a: number, b: number): GameState {
  return act(rig(s, a, b), { type: 'roll' });
}

const give = (s: GameState, p: number, ...pos: number[]) => pos.forEach((q) => (s.owner[q] = p));

describe('board layout', () => {
  it('has 40 spaces with corners, lots, gates, works, draws and levies in the standard places', () => {
    const kinds = BOARD.spaces.map((s) => s.kind);
    expect(kinds).toHaveLength(BOARD_SIZE);
    expect([0, 10, 20, 30].map((i) => BOARD.spaces[i]?.kind)).toEqual(['corner', 'corner', 'corner', 'corner']);
    expect(BOARD.gates).toEqual([5, 15, 25, 35]);
    expect(BOARD.works).toEqual([12, 28]);
    expect(BOARD.spaces.flatMap((s, i) => (s.kind === 'draw' && s.deck === 'salvage' ? [i] : []))).toEqual([2, 17, 33]);
    expect(BOARD.spaces.flatMap((s, i) => (s.kind === 'draw' && s.deck === 'signal' ? [i] : []))).toEqual([7, 22, 36]);
    expect(BOARD.spaces.flatMap((s, i) => (s.kind === 'levy' ? [i] : []))).toEqual([4, 38]);
    expect(kinds.filter((k) => k === 'lot')).toHaveLength(22);
    expect(BOARD.groups.map((g) => g.lots.length)).toEqual([2, 3, 3, 3, 3, 3, 3, 2]);
    expect(BOARD.groups.map((g) => g.lots)).toEqual([[1, 3], [6, 8, 9], [11, 13, 14], [16, 18, 19], [21, 23, 24], [26, 27, 29], [31, 32, 34], [37, 39]]);
  });

  it('uses no classic group colour sequence', () => {
    const classic = ['#8b4513', '#add8e6', '#ff69b4', '#ffa500', '#ff0000', '#ffff00', '#008000', '#00008b'];
    expect(BOARD.groups.map((g) => g.color)).not.toEqual(classic);
    expect(new Set(BOARD.groups.map((g) => g.color)).size).toBe(8);
  });
});

describe('economy (generated, one config)', () => {
  const lots = BOARD.groups.map((g) => g.lots.map((p) => lot(p).terms));

  it('prices rise group by group, and the last lot in each group is pricier', () => {
    for (let g = 1; g < lots.length; g++) expect(lots[g]![0]!.price).toBeGreaterThan(lots[g - 1]!.at(-1)!.price - 1);
    for (const g of lots) {
      expect(g.at(-1)!.price).toBeGreaterThan(g[0]!.price);
      expect(g.at(-1)!.price / g[0]!.price).toBeLessThan(1.25);
    }
  });

  it('rent ladders follow roughly 5x, 15x, 40-45x, 50-55x, 60-70x base with a steep jump at 3 domes', () => {
    for (const t of lots.flat()) {
      const m = t.rent.slice(1).map((r) => r / t.rent[0]);
      expect(m[0]).toBeGreaterThan(4);
      expect(m[0]).toBeLessThan(6);
      expect(m[1]).toBeGreaterThan(12);
      expect(m[1]).toBeLessThan(17);
      expect(m[2]).toBeGreaterThan(36);
      expect(m[2]).toBeLessThan(47);
      expect(m[3]).toBeGreaterThan(45);
      expect(m[3]).toBeLessThan(58);
      expect(m[4]).toBeGreaterThan(55);
      expect(m[4]).toBeLessThan(72);
      expect(t.rent[3] - t.rent[2]).toBeGreaterThan(2 * (t.rent[2] - t.rent[1]));
    }
  });

  it('building cost has four tiers, one per side', () => {
    const bySide = [0, 1, 2, 3].map((side) => new Set(BOARD.groups.flatMap((g) => g.lots).filter((p) => Math.floor(p / 10) === side).map((p) => lot(p).terms.buildCost)));
    expect(bySide.map((s) => s.size)).toEqual([1, 1, 1, 1]);
    const tiers = bySide.map((s) => [...s][0]!);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });

  it('every number moves when a constant is tuned', () => {
    const tuned = lotTerms({ ...E, groupPriceA: E.groupPriceA + 40 }, 0, 8, 0, 2, 0);
    expect(tuned.price).toBeGreaterThan(lot(1).terms.price);
  });

  it('keeps the classic balance within 15% on aggregate ratios to starting cash', () => {
    // Reference aggregates of the standard game, as multiples of its starting cash (not its tables).
    const ref = { prices: 3.06, base: 0.25, hotels: 15.93, gate: 0.1333, salary: 0.1333, fine: 0.0333 };
    const sum = (f: (t: (typeof lots)[0][0]) => number) => lots.flat().reduce((a, t) => a + f(t), 0) / E.startingCash;
    const near = (v: number, r: number) => expect(Math.abs(v / r - 1)).toBeLessThan(0.15);
    near(sum((t) => t.price), ref.prices);
    near(sum((t) => t.rent[0]), ref.base);
    near(sum((t) => t.rent[5]), ref.hotels);
    near(E.gatePrice / E.startingCash, ref.gate);
    near(E.salary / E.startingCash, ref.salary);
    near(E.quarantineFee / E.startingCash, ref.fine);
  });
});

describe('cards', () => {
  it('has two decks of 16 with the standard mix of effect types', () => {
    const mix = (d: keyof typeof DECKS) => DECKS[d].reduce<Record<string, number>>((m, c) => ({ ...m, [c.effect.type]: (m[c.effect.type] ?? 0) + 1 }), {});
    expect(DECKS.signal).toHaveLength(16);
    expect(DECKS.salvage).toHaveLength(16);
    expect(mix('signal')).toEqual({ advance: 5, nearest: 3, collect: 2, pass: 1, back: 1, toQuarantine: 1, repairs: 1, pay: 1, payEach: 1 });
    expect(mix('salvage')).toEqual({ advance: 1, collect: 8, pay: 3, pass: 1, toQuarantine: 1, collectEach: 1, repairs: 1 });
    expect(DECKS.signal.filter((c) => c.effect.type === 'nearest' && c.effect.kind === 'gate')).toHaveLength(2);
  });
});

describe('movement and Launch', () => {
  it('moves by 2d6 and pays salary for passing Launch', () => {
    let s = game();
    s.players[0]!.pos = 36;
    s = roll(s, 3, 2); // 36 + 5 = 41 -> 1
    expect(s.players[0]!.pos).toBe(1);
    expect(s.players[0]!.cash).toBe(E.startingCash + E.salary);
  });

  it('pays salary for landing exactly on Launch', () => {
    let s = game();
    s.players[0]!.pos = 34;
    s = roll(s, 2, 4);
    expect(s.players[0]!.pos).toBe(0);
    expect(s.players[0]!.cash).toBe(E.startingCash + E.salary);
  });

  it('doubles roll again; three doubles in a row go to Quarantine', () => {
    let s = game();
    s = roll(s, 2, 2); // -> 4, Dock Levy
    expect(s.phase.kind).toBe('roll');
    expect(s.current).toBe(0);
    s = roll(s, 3, 3); // -> 10, only landing there
    expect(s.players[0]!.inQuarantine).toBe(false);
    s = roll(s, 1, 1); // third doubles
    expect(s.players[0]!.pos).toBe(QUARANTINE);
    expect(s.players[0]!.inQuarantine).toBe(true);
    expect(s.phase.kind).toBe('end');
  });

  it('the Tractor Beam sends you to Quarantine without salary, and ends the turn even on doubles', () => {
    let s = game();
    s.players[0]!.pos = 26;
    s = roll(s, 2, 2);
    expect(s.players[0]!.pos).toBe(QUARANTINE);
    expect(s.players[0]!.cash).toBe(E.startingCash);
    expect(s.phase.kind).toBe('end');
  });
});

describe('Quarantine', () => {
  const quarantined = () => {
    const s = game();
    Object.assign(s.players[0]!, { pos: QUARANTINE, inQuarantine: true, tries: 0 });
    return s;
  };

  it('leave by paying the fee, then roll as normal', () => {
    let s = act(quarantined(), { type: 'payFine' });
    expect(s.players[0]!.inQuarantine).toBe(false);
    expect(s.players[0]!.cash).toBe(E.startingCash - E.quarantineFee);
    s = roll(s, 1, 2);
    expect(s.players[0]!.pos).toBe(13);
  });

  it('leave with a clearance pass, which goes back to the bottom of its deck', () => {
    let s = quarantined();
    s.players[0]!.passes = ['s8'];
    s.decks.signal = s.decks.signal.filter((c) => c !== 's8');
    s = act(s, { type: 'usePass' });
    expect(s.players[0]!.inQuarantine).toBe(false);
    expect(s.decks.signal.at(-1)).toBe('s8');
  });

  it('rolling doubles leaves and moves, with no extra roll', () => {
    let s = roll(quarantined(), 3, 3);
    expect(s.players[0]!.inQuarantine).toBe(false);
    expect(s.players[0]!.pos).toBe(16);
    if (s.phase.kind === 'buy') s = act(s, { type: 'buy' });
    expect(s.phase.kind).toBe('end');
  });

  it('after the third failed attempt you must pay and move', () => {
    let s = quarantined();
    for (let i = 0; i < 2; i++) {
      s = roll(s, 1, 2);
      expect(s.players[0]!.inQuarantine).toBe(true);
      s.phase = { kind: 'roll' };
    }
    s = roll(s, 1, 2);
    expect(s.players[0]!.inQuarantine).toBe(false);
    expect(s.players[0]!.pos).toBe(13);
    expect(s.players[0]!.cash).toBe(E.startingCash - E.quarantineFee);
  });
});

describe('buying and auctions', () => {
  it('buy an unowned lot', () => {
    let s = roll(game(), 1, 2); // -> 3
    expect(s.phase).toMatchObject({ kind: 'buy', pos: 3 });
    s = act(s, { type: 'buy' });
    expect(s.owner[3]).toBe(0);
    expect(s.players[0]!.cash).toBe(E.startingCash - lot(3).terms.price);
  });

  it('declining sends the lot to auction for everyone; the highest bid wins', () => {
    let s = roll(game(3), 1, 2);
    s = act(s, { type: 'decline' });
    expect(s.phase.kind).toBe('auction');
    expect(actorOf(s)).toBe(0); // the decliner may bid too
    s = act(s, { type: 'bid', amount: 10 });
    s = act(s, { type: 'bid', amount: 20 });
    s = act(s, { type: 'passBid' }); // P2
    s = act(s, { type: 'passBid' }); // P0
    expect(s.owner[3]).toBe(1);
    expect(s.players[1]!.cash).toBe(E.startingCash - 20);
    expect(s.phase.kind).toBe('end');
  });

  it('with no bids the lot stays with the bank', () => {
    let s = roll(game(2), 1, 2);
    s = act(s, { type: 'decline' });
    s = act(s, { type: 'passBid' });
    s = act(s, { type: 'passBid' });
    expect(s.owner[3]).toBeNull();
  });

  it('bids must beat the high bid and fit your cash', () => {
    let s = roll(game(2), 1, 2);
    s = act(s, { type: 'decline' });
    s = act(s, { type: 'bid', amount: 50 });
    expect(fails(s, { type: 'bid', amount: 50 })).toMatch(/at least/);
    expect(fails(s, { type: 'bid', amount: E.startingCash + 1 })).toMatch(/you have/);
  });
});

describe('rent', () => {
  it('charges base rent, double for a full unimproved group (even with a mortgaged lot), none on a mortgaged lot', () => {
    const s = game();
    give(s, 1, 6);
    expect(rentFor(s, DEFAULT_RULES, 6, 7)).toBe(lot(6).terms.rent[0]);
    give(s, 1, 8, 9);
    expect(rentFor(s, DEFAULT_RULES, 6, 7)).toBe(lot(6).terms.rent[0] * 2);
    s.mortgaged[8] = true;
    expect(rentFor(s, DEFAULT_RULES, 6, 7)).toBe(lot(6).terms.rent[0] * 2);
    expect(rentFor(s, DEFAULT_RULES, 8, 7)).toBe(0);
  });

  it('landing pays the owner', () => {
    let s = game();
    give(s, 1, 3);
    s = roll(s, 1, 2);
    expect(s.players[0]!.cash).toBe(E.startingCash - lot(3).terms.rent[0]);
    expect(s.players[1]!.cash).toBe(E.startingCash + lot(3).terms.rent[0]);
  });

  it('gate rent doubles per gate owned: 1x, 2x, 4x, 8x', () => {
    const s = game();
    const r = [5, 15, 25, 35].map((g, i) => {
      give(s, 1, g);
      void i;
      return rentFor(s, DEFAULT_RULES, 5, 7);
    });
    expect(r).toEqual([E.gateRent, E.gateRent * 2, E.gateRent * 4, E.gateRent * 8]);
  });

  it('works rent is the dice times 4 with one owned, times 10 with both', () => {
    const s = game();
    give(s, 1, 12);
    expect(rentFor(s, DEFAULT_RULES, 12, 9)).toBe(36);
    give(s, 1, 28);
    expect(rentFor(s, DEFAULT_RULES, 12, 9)).toBe(90);
  });
});

describe('building', () => {
  const owner = () => {
    const s = game();
    give(s, 0, 6, 8, 9);
    s.players[0]!.cash = 10_000;
    return s;
  };

  it('needs the whole group', () => {
    const s = game();
    give(s, 0, 6, 8);
    expect(fails(s, { type: 'build', pos: 6 })).toMatch(/every lot/);
  });

  it('builds evenly: lots in a group differ by one level at most', () => {
    let s = act(owner(), { type: 'build', pos: 6 });
    expect(fails(s, { type: 'build', pos: 6 })).toMatch(/evenly/);
    s = act(s, { type: 'build', pos: 8 });
    s = act(s, { type: 'build', pos: 9 });
    s = act(s, { type: 'build', pos: 6 });
    expect([6, 8, 9].map((p) => s.level[p])).toEqual([2, 1, 1]);
    expect(fails(s, { type: 'sell', pos: 8 })).toMatch(/evenly/);
  });

  it('4 domes then a spire; a spire returns its 4 domes to the bank', () => {
    let s = act(owner(), { type: 'setLevels', group: 1, levels: [4, 4, 4] });
    expect(s.bank.domes).toBe(E.domes - 12);
    s = act(s, { type: 'build', pos: 6 });
    expect(s.level[6]).toBe(5);
    expect(s.bank.domes).toBe(E.domes - 8);
    expect(s.bank.spires).toBe(E.spires - 1);
    expect(fails(s, { type: 'build', pos: 6 })).toBeTruthy();
    expect(rentFor(s, DEFAULT_RULES, 6, 7)).toBe(lot(6).terms.rent[5]);
  });

  it('costs the side tier per level, and sells back at half', () => {
    let s = act(owner(), { type: 'setLevels', group: 1, levels: [1, 1, 1] });
    const bc = lot(6).terms.buildCost;
    expect(s.players[0]!.cash).toBe(10_000 - 3 * bc);
    s = act(s, { type: 'sell', pos: 6 });
    expect(s.players[0]!.cash).toBe(10_000 - 3 * bc + Math.floor(bc / 2));
  });

  it('cannot build while any lot in the group is mortgaged', () => {
    const s = owner();
    s.mortgaged[9] = true;
    expect(fails(s, { type: 'build', pos: 6 })).toMatch(/mortgage/);
  });

  it('housing shortage: no dome when the bank is out', () => {
    const s = owner();
    s.bank.domes = 2;
    expect(fails(s, { type: 'setLevels', group: 1, levels: [1, 1, 1] })).toMatch(/only 2 domes/);
    expect(act(s, { type: 'setLevels', group: 1, levels: [1, 1, 0] }).bank.domes).toBe(0);
  });

  it('housing shortage: a spire cannot break into domes the bank lacks, but the group can sell down at once', () => {
    let s = act(owner(), { type: 'setLevels', group: 1, levels: [5, 5, 5] });
    s.bank.domes = 0;
    expect(fails(s, { type: 'sell', pos: 6 })).toMatch(/domes/);
    s = act(s, { type: 'setLevels', group: 1, levels: [0, 0, 0] });
    expect(s.bank.spires).toBe(E.spires);
  });

  it('a spire needs a spire in the bank', () => {
    let s = act(owner(), { type: 'setLevels', group: 1, levels: [4, 4, 4] });
    s.bank.spires = 0;
    expect(fails(s, { type: 'build', pos: 6 })).toMatch(/spires/);
  });
});

describe('mortgages', () => {
  it('pays half the price; lifting costs the mortgage plus 10%', () => {
    let s = game();
    give(s, 0, 39);
    s = act(s, { type: 'mortgage', pos: 39 });
    const m = Math.round(lot(39).terms.price * 0.5);
    expect(s.players[0]!.cash).toBe(E.startingCash + m);
    s = act(s, { type: 'unmortgage', pos: 39 });
    expect(s.players[0]!.cash).toBe(E.startingCash + m - Math.ceil(m * 1.1));
  });

  it('cannot mortgage while the group has buildings', () => {
    let s = game();
    give(s, 0, 37, 39);
    s.players[0]!.cash = 5000;
    s = act(s, { type: 'build', pos: 37 });
    expect(fails(s, { type: 'mortgage', pos: 39 })).toMatch(/buildings/);
  });
});

describe('trading', () => {
  it('swaps lots, cash and clearance passes between players', () => {
    let s = game();
    give(s, 0, 1);
    give(s, 1, 3);
    s.players[1]!.passes = ['v5'];
    s = act(s, { type: 'propose', to: 1, give: { lots: [1], cash: 100, passes: 0 }, get: { lots: [3], cash: 0, passes: 1 } });
    expect(actorOf(s)).toBe(1);
    s = act(s, { type: 'accept' });
    expect(s.owner[3]).toBe(0);
    expect(s.owner[1]).toBe(1);
    expect(s.players[0]!.passes).toEqual(['v5']);
    expect(s.players[1]!.cash).toBe(E.startingCash + 100);
  });

  it('can be turned down', () => {
    let s = game();
    give(s, 1, 3);
    s = act(s, { type: 'propose', to: 1, give: { lots: [], cash: 10, passes: 0 }, get: { lots: [3], cash: 0, passes: 0 } });
    s = act(s, { type: 'reject' });
    expect(s.owner[3]).toBe(1);
    expect(s.trade).toBeNull();
  });

  it('refuses lots from a group with buildings, and charges interest on mortgaged lots received', () => {
    let s = game();
    give(s, 0, 37, 39);
    s.players[0]!.cash = 5000;
    s = act(s, { type: 'build', pos: 37 });
    expect(fails(s, { type: 'propose', to: 1, give: { lots: [39], cash: 0, passes: 0 }, get: { lots: [], cash: 10, passes: 0 } })).toMatch(/buildings/);
    s = act(s, { type: 'sell', pos: 37 });
    s = act(s, { type: 'mortgage', pos: 39 });
    s = act(s, { type: 'propose', to: 1, give: { lots: [39], cash: 0, passes: 0 }, get: { lots: [], cash: 10, passes: 0 } });
    s = act(s, { type: 'accept' });
    const fee = Math.ceil(Math.round(lot(39).terms.price * 0.5) * 0.1);
    expect(s.players[1]!.cash).toBe(E.startingCash - 10 - fee);
    expect(s.mortgaged[39]).toBe(true);
  });
});

describe('debt and bankruptcy', () => {
  it('a short player must raise cash before paying, and cannot quit while they can still raise it', () => {
    let s = game();
    give(s, 1, 3);
    give(s, 0, 39);
    s.players[0]!.cash = 1;
    s = roll(s, 1, 2);
    expect(s.debts).toHaveLength(1);
    expect(actorOf(s)).toBe(0);
    expect(fails(s, { type: 'bankrupt' })).toMatch(/still raise/);
    s = act(s, { type: 'mortgage', pos: 39 });
    s = act(s, { type: 'payDebt' });
    expect(s.debts).toHaveLength(0);
    expect(s.players[1]!.cash).toBe(E.startingCash + lot(3).terms.rent[0]);
  });

  it('bankrupt to a player: they take the cash, lots and passes', () => {
    let s = game();
    give(s, 1, 39);
    s.players[1]!.cash = 0;
    s.level[39] = 0;
    give(s, 0, 1);
    s.players[0]!.passes = ['s8'];
    s.players[0]!.cash = 2;
    s.players[0]!.pos = 34;
    s.mortgaged[1] = true;
    s = roll(s, 2, 3);
    s = act(s, { type: 'bankrupt' });
    expect(s.players[0]!.bankrupt).toBe(true);
    expect(s.owner[1]).toBe(1);
    expect(s.players[1]!.passes).toEqual(['s8']);
    expect(s.current).toBe(1);
  });

  it('bankrupt to the bank: lots return and go to auction; last player standing wins', () => {
    let s = game(2);
    give(s, 0, 1, 3);
    s.mortgaged[1] = true;
    s.mortgaged[3] = true;
    s.players[0]!.cash = 0;
    s.players[0]!.pos = 2;
    s = roll(s, 1, 1); // -> 4, Dock Levy
    s = act(s, { type: 'bankrupt' });
    expect(s.phase.kind).toBe('over');
    expect(s.phase.kind === 'over' && s.phase.winner).toBe(1);
  });

  it('bankrupt to the bank with players left: the estate is auctioned', () => {
    let s = game(3);
    give(s, 0, 1);
    s.mortgaged[1] = true;
    s.players[0]!.cash = 0;
    s.players[0]!.pos = 2;
    s = roll(s, 1, 1);
    s = act(s, { type: 'bankrupt' });
    expect(s.owner[1]).toBeNull();
    expect(s.mortgaged[1]).toBe(false);
    expect(s.phase.kind).toBe('auction');
    expect(s.auction?.pos).toBe(1);
    expect(s.current).toBe(1);
  });
});

describe('cards in play', () => {
  const drawOn = (deck: 'signal' | 'salvage', id: string, from: number, a: number, b: number, setup?: (s: GameState) => void) => {
    let s = game();
    s.decks[deck] = [id, ...s.decks[deck].filter((c) => c !== id)];
    s.players[0]!.pos = from;
    setup?.(s);
    s = roll(s, a, b);
    return s;
  };

  it('advance cards move you and pay salary when they pass Launch', () => {
    const s = drawOn('signal', 's3', 33, 1, 2); // 36 -> Glowmere (11), passing Launch
    expect(s.players[0]!.pos).toBe(11);
    expect(s.players[0]!.cash).toBe(E.startingCash + E.salary);
  });

  it('a fly-to-Launch card pays the stipend even when landing on Launch pays nothing', () => {
    let s = game();
    s.decks.signal = ['s1', ...s.decks.signal.filter((c) => c !== 's1')];
    s.players[0]!.pos = 4;
    rig(s, 1, 2);
    const r = apply(s, 0, { type: 'roll' }, { ...DEFAULT_RULES, salaryOnLanding: false });
    expect(r.state?.players[0]!.pos).toBe(0);
    expect(r.state?.players[0]!.cash).toBe(E.startingCash + E.salary);
  });

  it('nearest gate: pay double the toll', () => {
    const s = drawOn('signal', 's5', 4, 1, 2, (st) => give(st, 1, 15)); // 7 -> Rift Gate (15)
    expect(s.players[0]!.pos).toBe(15);
    expect(s.players[1]!.cash).toBe(E.startingCash + E.gateRent * 2);
  });

  it('nearest works: roll and pay ten times the dice', () => {
    const s = drawOn('signal', 's4', 34, 1, 1, (st) => give(st, 1, 12)); // 36 -> Sail Works (12), passes Launch
    const [a, b] = s.lastRoll!;
    expect(s.players[1]!.cash).toBe(E.startingCash + (a + b) * 10);
  });

  it('move back three spaces', () => {
    const s = drawOn('signal', 's9', 4, 1, 2); // 7 -> 4 (Dock Levy)
    expect(s.players[0]!.pos).toBe(4);
    expect(s.players[0]!.cash).toBe(E.startingCash - E.taxHigh);
  });

  it('repairs charge per dome and per spire', () => {
    const s = drawOn('signal', 's11', 4, 1, 2, (st) => {
      give(st, 0, 37, 39);
      st.level[37] = 4;
      st.level[39] = 5;
    });
    expect(s.players[0]!.cash).toBe(E.startingCash - 4 * 30 - 120);
  });

  it('pay each player and collect from each player', () => {
    let s = drawOn('signal', 's15', 4, 1, 2);
    expect(s.players[0]!.cash).toBe(E.startingCash - 120);
    expect(s.players[2]!.cash).toBe(E.startingCash + 60);
    s = drawOn('salvage', 'v9', 0, 1, 1);
    expect(s.players[0]!.cash).toBe(E.startingCash + 24);
  });

  it('go to Quarantine, and the clearance pass is kept out of the deck', () => {
    let s = drawOn('signal', 's10', 4, 1, 2);
    expect(s.players[0]!.inQuarantine).toBe(true);
    s = drawOn('signal', 's8', 4, 1, 2);
    expect(s.players[0]!.passes).toEqual(['s8']);
    expect(s.decks.signal).not.toContain('s8');
  });
});

describe('determinism and bots', () => {
  it('the same seed and moves give the same game', () => {
    const run = () => {
      let s = newGame([0, 1, 2].map((i) => ({ name: `B${i}`, token: i, bot: true })), 77);
      for (let i = 0; i < 400 && s.phase.kind !== 'over'; i++) s = botStep(s);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it('bot-only games always finish with one winner', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = newGame([0, 1, 2, 3].map((i) => ({ name: `B${i}`, token: i, bot: true })), seed);
      for (let i = 0; i < 30_000 && s.phase.kind !== 'over'; i++) s = botStep(s);
      expect(s.phase.kind).toBe('over');
      expect(s.players.filter((p) => !p.bankrupt)).toHaveLength(1);
    }
  });

  it('bots refuse a trade that hands over a full group cheaply', () => {
    let s = game();
    give(s, 1, 6, 8);
    give(s, 2, 9);
    s.players[2]!.bot = true;
    s.current = 1;
    s = act(s, { type: 'propose', to: 2, give: { lots: [], cash: 50, passes: 0 }, get: { lots: [9], cash: 0, passes: 0 } }, 1);
    expect(judgeTrade(s, DEFAULT_RULES, 2)).toBe(false);
  });

  it('only the acting player may move', () => {
    expect(fails(game(), { type: 'roll' }, 1)).toMatch(/not your move/);
  });
});
