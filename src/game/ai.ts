/**
 * Bot players. `botAction` always returns an action the engine accepts for the acting bot, so a game of bots
 * always moves forward. Tuning lives in BOT; nothing here reads the clock or Math.random.
 */
import { isOwnable, priceOf } from './board';
import { unmortgageCost } from './economy';
import {
  actorOf, alive, apply, canManage, DEFAULT_RULES, groupHasBuildings, groupOf, liquidationValue, MAX_LEVEL, ownsGroup, planLevels,
  type Action, type Bundle, type GameState, type RulesConfig,
} from './rules';

export interface BotConfig {
  /** Cash kept back as a share of starting cash, before buying or building. */
  reserveShare: number;
  /** Value boost for a lot that completes one of the bot's groups. */
  completeBoost: number;
  /** Value boost for a lot that would block an opponent's group. */
  blockBoost: number;
  /** Highest auction bid as a share of the lot's value to the bot. */
  auctionCeiling: number;
  /** Extra value the bot wants from a trade, as a share of what it gives. */
  tradeMargin: number;
  /** Cash offered for a missing lot, as a multiple of its price. */
  buyOutOffer: number;
  /** Turns before re-offering for the same lot. */
  reofferAfter: number;
  /** Unowned lots left on the board above which the bot pays to leave Jail early. */
  leaveEarlyWhileUnowned: number;
}

export const BOT: BotConfig = {
  reserveShare: 0.1,
  completeBoost: 2.5,
  blockBoost: 1.4,
  auctionCeiling: 1.05,
  tradeMargin: 0.15,
  buyOutOffer: 1.7,
  reofferAfter: 8,
  leaveEarlyWhileUnowned: 8,
};

const reserve = (rules: RulesConfig, bot: BotConfig): number => Math.round(rules.economy.startingCash * bot.reserveShare);

/** What a lot is worth to player p if p gains it. */
export function valueToGain(s: GameState, rules: RulesConfig, p: number, pos: number, bot: BotConfig = BOT): number {
  const sp = rules.board.spaces[pos];
  if (!sp || !isOwnable(sp)) return 0;
  let v = priceOf(sp);
  if (s.mortgaged[pos]) v -= Math.round(v * rules.economy.mortgageShare);
  const g = groupOf(rules, pos);
  if (g !== null) {
    const lots = rules.board.groups[g]!.lots;
    const mine = lots.filter((q) => s.owner[q] === p).length;
    const theirs = new Set(lots.map((q) => s.owner[q]).filter((o) => o !== null && o !== p));
    if (mine === lots.length - 1 && !lots.some((q) => q !== pos && s.owner[q] !== p)) v *= bot.completeBoost;
    else if (theirs.size === 1 && lots.filter((q) => s.owner[q] !== null && s.owner[q] !== p).length === lots.length - 1) v *= bot.blockBoost;
  } else if (sp.kind === 'subway') {
    const n = rules.board.subways.filter((q) => s.owner[q] === p).length;
    v *= 1 + 0.15 * n;
  }
  return Math.round(v);
}

/** What p loses by giving away pos, counting the gift of a full group to the receiver. */
function valueToGive(s: GameState, rules: RulesConfig, p: number, receiver: number, pos: number, bot: BotConfig): number {
  const sp = rules.board.spaces[pos];
  if (!sp || !isOwnable(sp)) return 0;
  let v = priceOf(sp);
  const g = groupOf(rules, pos);
  if (g !== null && ownsGroup(s, rules, p, g)) v *= bot.completeBoost;
  return Math.round(v + valueToGain(s, rules, receiver, pos, bot) - priceOf(sp));
}

function bundleValue(s: GameState, rules: RulesConfig, who: number, other: number, b: Bundle, gaining: boolean, bot: BotConfig): number {
  const lots = b.lots.reduce((t, pos) => t + (gaining ? valueToGain(s, rules, who, pos, bot) : valueToGive(s, rules, other, who, pos, bot)), 0);
  return lots + b.cash + b.passes * rules.economy.jailFine;
}

const ok = (s: GameState, p: number, a: Action, rules: RulesConfig): boolean => !apply(s, p, a, rules).error;

/** The cheapest way to raise cash: sell a building, else mortgage the least valuable lot. */
export function raiseCash(s: GameState, rules: RulesConfig, p: number): Action | null {
  // Sell from the group with the cheapest buildings first, one level at a time from the highest lot.
  const groups = rules.board.groups.map((g, gi) => ({ g, gi })).filter(({ gi }) => groupHasBuildings(s, rules, gi) && ownsGroup(s, rules, p, gi));
  groups.sort((a, b) => {
    const ca = rules.board.spaces[a.g.lots[0]!];
    const cb = rules.board.spaces[b.g.lots[0]!];
    return (ca?.kind === 'lot' ? ca.terms.buildCost : 0) - (cb?.kind === 'lot' ? cb.terms.buildCost : 0);
  });
  for (const { g, gi } of groups) {
    const top = [...g.lots].sort((a, b) => (s.level[b] ?? 0) - (s.level[a] ?? 0))[0]!;
    const sell: Action = { type: 'sell', pos: top };
    if (ok(s, p, sell, rules)) return sell;
    // A hotel can't break into houses during a shortage: sell the whole group down at once.
    const flat: Action = { type: 'setLevels', group: gi, levels: g.lots.map(() => 0) };
    if (ok(s, p, flat, rules)) return flat;
  }
  const mine = s.owner
    .map((o, pos) => ({ o, pos }))
    .filter(({ o, pos }) => o === p && !s.mortgaged[pos])
    .map(({ pos }) => pos)
    .sort((a, b) => valueToGain(s, rules, p, a) - valueToGain(s, rules, p, b));
  for (const pos of mine) {
    const m: Action = { type: 'mortgage', pos };
    if (ok(s, p, m, rules)) return m;
  }
  return null;
}

/** A building or unmortgage step worth taking now, if any. */
function improve(s: GameState, rules: RulesConfig, p: number, bot: BotConfig): Action | null {
  const cash = s.players[p]!.cash;
  const keep = reserve(rules, bot);
  // Lift mortgages on lots in groups the bot completes, then any others, while rich.
  for (const pos of s.owner.flatMap((o, i) => (o === p && s.mortgaged[i] ? [i] : []))) {
    const sp = rules.board.spaces[pos]!;
    const cost = unmortgageCost(rules.economy, Math.round(priceOf(sp) * rules.economy.mortgageShare));
    const g = groupOf(rules, pos);
    const key = g !== null && ownsGroup(s, rules, p, g);
    if (cash - cost >= keep * (key ? 1 : 3)) return { type: 'unmortgage', pos };
  }
  // Build evenly on full groups, dearest rent jump first.
  let best: { a: Action; gain: number } | null = null;
  rules.board.groups.forEach((g, gi) => {
    if (!ownsGroup(s, rules, p, gi)) return;
    const levels = g.lots.map((q) => s.level[q] ?? 0);
    const min = Math.min(...levels);
    if (min >= MAX_LEVEL) return;
    const pos = g.lots[levels.indexOf(min)]!;
    const sp = rules.board.spaces[pos];
    if (sp?.kind !== 'lot') return;
    if (cash - sp.terms.buildCost < keep) return;
    const next = levels.map((l, i) => (g.lots[i] === pos ? l + 1 : l));
    if ('error' in planLevels(s, rules, p, gi, next)) return;
    const gain = (sp.terms.rent[min + 1] ?? 0) - (sp.terms.rent[min] ?? 0);
    if (!best || gain > best.gain) best = { a: { type: 'build', pos }, gain };
  });
  return (best as { a: Action } | null)?.a ?? null;
}

/** One trade offer per turn at most: buy the last lot of a group from its owner. */
function proposeTrade(s: GameState, rules: RulesConfig, p: number, bot: BotConfig): Action | null {
  const cash = s.players[p]!.cash;
  for (const g of rules.board.groups) {
    const missing = g.lots.filter((q) => s.owner[q] !== p);
    if (missing.length !== 1) continue;
    const pos = missing[0]!;
    const owner = s.owner[pos];
    if (owner === null || owner === undefined || s.players[owner]?.bankrupt) continue;
    const key = `${p}:${pos}`;
    if (s.memo[key] !== undefined && s.turn - s.memo[key]! < bot.reofferAfter) continue;
    const offer = Math.round(priceOf(rules.board.spaces[pos]!) * bot.buyOutOffer);
    if (cash - offer < reserve(rules, bot)) continue;
    const a: Action = { type: 'propose', to: owner, give: { lots: [], cash: offer, passes: 0 }, get: { lots: [pos], cash: 0, passes: 0 } };
    if (ok(s, p, a, rules)) return a;
  }
  return null;
}

/** Note that p offered for a lot this turn (bots don't nag). Call after a bot's propose is applied. */
export function rememberOffer(s: GameState, a: Action, p: number): void {
  if (a.type !== 'propose') return;
  for (const pos of a.get.lots) s.memo[`${p}:${pos}`] = s.turn;
}

/** Whether bot p accepts the pending trade. */
export function judgeTrade(s: GameState, rules: RulesConfig, p: number, bot: BotConfig = BOT): boolean {
  const t = s.trade;
  if (!t || t.to !== p) return false;
  const gain = bundleValue(s, rules, p, t.from, t.give, true, bot);
  const loss = bundleValue(s, rules, p, t.from, t.get, false, bot);
  return gain >= loss * (1 + bot.tradeMargin) + 10;
}

export function botAction(s: GameState, rules: RulesConfig = DEFAULT_RULES, bot: BotConfig = BOT): Action {
  const p = actorOf(s);
  const me = s.players[p];
  if (!me) return { type: 'endTurn' };

  if (s.trade && s.trade.to === p) return judgeTrade(s, rules, p, bot) ? { type: 'accept' } : { type: 'reject' };

  const debt = s.debts[0];
  if (debt && debt.debtor === p) {
    if (me.cash >= debt.amount) return { type: 'payDebt' };
    if (liquidationValue(s, rules, p) < debt.amount) return { type: 'bankrupt' };
    return raiseCash(s, rules, p) ?? { type: 'bankrupt' };
  }

  const ph = s.phase;
  if (ph.kind === 'auction' && s.auction) {
    const a = s.auction;
    const ceiling = Math.min(me.cash - Math.round(reserve(rules, bot) / 2), Math.round(valueToGain(s, rules, p, a.pos, bot) * bot.auctionCeiling));
    const min = a.high + rules.economy.minBidStep;
    if (min <= ceiling) {
      // Open near half value so auctions finish quickly, then raise in small steps.
      const open = a.high === 0 ? Math.max(min, Math.round(ceiling / 2 / 5) * 5) : min;
      return { type: 'bid', amount: Math.min(open, ceiling) };
    }
    return { type: 'passBid' };
  }

  if (ph.kind === 'buy') {
    const price = priceOf(rules.board.spaces[ph.pos]!);
    const worth = valueToGain(s, rules, p, ph.pos, bot);
    if (me.cash >= price && (me.cash - price >= reserve(rules, bot) || worth > price * 1.5)) return { type: 'buy' };
    return { type: 'decline' };
  }

  if (ph.kind === 'roll' || ph.kind === 'end') {
    if (canManage(s, p)) {
      const step = improve(s, rules, p, bot);
      if (step && ok(s, p, step, rules)) return step;
    }
    if (ph.kind === 'roll') {
      if (me.inJail) {
        const unowned = s.owner.filter((o, i) => o === null && isOwnable(rules.board.spaces[i]!)).length;
        const early = unowned >= bot.leaveEarlyWhileUnowned;
        if (early && me.passes.length) return { type: 'usePass' };
        if (early && me.cash - rules.economy.jailFine >= reserve(rules, bot)) return { type: 'payFine' };
      }
      return { type: 'roll' };
    }
    if (canManage(s, p) && alive(s).length > 1) {
      const offer = proposeTrade(s, rules, p, bot);
      if (offer) return offer;
    }
    return { type: 'endTurn' };
  }
  return { type: 'endTurn' };
}

/** Apply bot p's chosen action (with its offer memory). Exposed for the UI and tests. */
export function botStep(s: GameState, rules: RulesConfig = DEFAULT_RULES, bot: BotConfig = BOT): GameState {
  const p = actorOf(s);
  const a = botAction(s, rules, bot);
  const r = apply(s, p, a, rules);
  if (!r.state) {
    // Should not happen; fall back to the safest legal move so the game never stalls.
    for (const f of [{ type: 'passBid' }, { type: 'reject' }, { type: 'decline' }, { type: 'endTurn' }, { type: 'roll' }, { type: 'bankrupt' }] as Action[]) {
      const rf = apply(s, p, f, rules);
      if (rf.state) return rf.state;
    }
    throw new Error(`bot ${p} is stuck: ${r.error} (${JSON.stringify(a)})`);
  }
  const next = r.state;
  rememberOffer(next, a, p);
  return next;
}

