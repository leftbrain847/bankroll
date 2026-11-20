/**
 * The whole Bankroll economy in one place. Prices, rents, building costs, salary, taxes, fines and starting cash
 * are all generated from the constants below; nothing else in the game hard-codes a money value.
 *
 * Shape of the curve (tune the constants, keep the shape):
 *  - Lot prices rise steadily around the loop: each group's opening price follows a gentle quadratic in the group
 *    index, and the last lot of every group carries a small premium.
 *  - Base rent is a share of the lot price that grows with the group index, so later lots earn more per credit.
 *  - Each lot's rent ladder multiplies its base rent: about 5x, 15x, 40-45x, 50-55x and 60-70x for 1-4 domes and a
 *    spire, with the steep jump at the third dome. The multipliers ease slightly from the cheap end to the dear end.
 *  - Building cost is one of four tiers, one per side of the loop.
 */

export interface EconomyConfig {
  /** Rounding step for prices, building costs and fees. */
  priceStep: number;
  /** Opening price of group g = groupPriceA + groupPriceB*g + groupPriceC*g^2, rounded to priceStep. */
  groupPriceA: number;
  groupPriceB: number;
  groupPriceC: number;
  /** The last lot in each group costs this much more (0.12 = +12%). */
  lastLotPremium: number;
  /** Base rent = price * (rentRateA + rentRateB*g + rentRateC*g^2), the last lot's share raised by lastLotRentBoost. */
  rentRateA: number;
  rentRateB: number;
  rentRateC: number;
  lastLotRentBoost: number;
  /** Rent multipliers of base rent for 1, 2, 3, 4 domes and a spire, at the cheapest group and at the dearest. */
  ladderCheap: [number, number, number, number, number];
  ladderDear: [number, number, number, number, number];
  /** Rents on the ladder round to this step once they pass ladderStepFrom. */
  ladderStep: number;
  ladderStepFrom: number;
  /** A complete, unimproved group charges base rent times this. */
  fullGroupMultiplier: number;
  /** Building (dome) cost for side 0..3 = buildCostA + buildCostB*side. A spire costs the same as a dome. */
  buildCostA: number;
  buildCostB: number;
  /** Selling a building back to the bank refunds this share of its cost. */
  buildingRefund: number;
  /** Mortgage pays this share of the lot price; lifting it costs the mortgage plus mortgageInterest. */
  mortgageShare: number;
  mortgageInterest: number;
  /** Gates (transit): price, and rent with one gate owned. Each further gate doubles it. */
  gatePrice: number;
  gateRent: number;
  /** Works (utilities): price, and rent as dice total times these (one owned, both owned). */
  worksPrice: number;
  worksMultiplierOne: number;
  worksMultiplierBoth: number;
  /** Money in and out. */
  startingCash: number;
  salary: number;
  taxHigh: number;
  taxLow: number;
  quarantineFee: number;
  /** Bank building supply. */
  domes: number;
  spires: number;
  /** Smallest raise at an auction. */
  minBidStep: number;
}

export const ECONOMY: EconomyConfig = {
  priceStep: 5,
  groupPriceA: 72,
  groupPriceB: 46,
  groupPriceC: 0.7,
  lastLotPremium: 0.12,
  rentRateA: 0.05,
  rentRateB: 0.004,
  rentRateC: 0.00045,
  lastLotRentBoost: 1.15,
  ladderCheap: [5, 15, 42, 52, 66],
  ladderDear: [4.6, 13.5, 40, 50, 60],
  ladderStep: 5,
  ladderStepFrom: 50,
  fullGroupMultiplier: 2,
  buildCostA: 55,
  buildCostB: 60,
  buildingRefund: 0.5,
  mortgageShare: 0.5,
  mortgageInterest: 0.1,
  gatePrice: 230,
  gateRent: 30,
  worksPrice: 175,
  worksMultiplierOne: 4,
  worksMultiplierBoth: 10,
  startingCash: 1800,
  salary: 240,
  taxHigh: 240,
  taxLow: 115,
  quarantineFee: 60,
  domes: 32,
  spires: 12,
  minBidStep: 5,
};

/** Generated terms for one lot. */
export interface LotTerms {
  price: number;
  /** [base, 1 dome, 2, 3, 4 domes, spire] */
  rent: [number, number, number, number, number, number];
  buildCost: number;
  mortgage: number;
}

const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

export function groupOpeningPrice(e: EconomyConfig, g: number): number {
  return roundTo(e.groupPriceA + e.groupPriceB * g + e.groupPriceC * g * g, e.priceStep);
}

/** Terms for lot `index` (0-based) of `size` lots in group g (0..groups-1), on board side `side` (0..3). */
export function lotTerms(e: EconomyConfig, g: number, groups: number, index: number, size: number, side: number): LotTerms {
  const last = index === size - 1;
  const opening = groupOpeningPrice(e, g);
  const price = last ? roundTo(opening * (1 + e.lastLotPremium), e.priceStep) : opening;
  const rate = (e.rentRateA + e.rentRateB * g + e.rentRateC * g * g) * (last ? e.lastLotRentBoost : 1);
  const base = Math.max(1, Math.round(price * rate));
  const t = groups > 1 ? g / (groups - 1) : 0;
  const ladder = e.ladderCheap.map((cheap, i) => cheap + ((e.ladderDear[i] ?? cheap) - cheap) * t);
  const step = (v: number): number => (v >= e.ladderStepFrom ? roundTo(v, e.ladderStep) : Math.round(v));
  const rent = [base, ...ladder.map((m) => step(base * m))] as LotTerms['rent'];
  return {
    price,
    rent,
    buildCost: roundTo(e.buildCostA + e.buildCostB * side, e.priceStep),
    mortgage: Math.round(price * e.mortgageShare),
  };
}

export const mortgageOf = (e: EconomyConfig, price: number): number => Math.round(price * e.mortgageShare);
/** Cost to lift a mortgage: the mortgage plus interest, rounded up. */
export const unmortgageCost = (e: EconomyConfig, mortgage: number): number => Math.ceil(mortgage * (1 + e.mortgageInterest));
/** Fee paid when a mortgaged lot changes hands (interest only). */
export const transferFee = (e: EconomyConfig, mortgage: number): number => Math.ceil(mortgage * e.mortgageInterest);
export const gateRent = (e: EconomyConfig, owned: number): number => (owned <= 0 ? 0 : e.gateRent * 2 ** (owned - 1));
export const worksRent = (e: EconomyConfig, owned: number, dice: number): number =>
  owned <= 0 ? 0 : dice * (owned >= 2 ? e.worksMultiplierBoth : e.worksMultiplierOne);
