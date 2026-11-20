/**
 * The two draw decks, 16 cards each. Card effects use the standard mix of effect types; every title and line of
 * text is Moonhold's own. Amounts are in glints (✦) and sit on the same scale as ECONOMY.
 */
import type { DeckId } from './board';

export type CardEffect =
  | { type: 'advance'; to: number }
  | { type: 'nearest'; kind: 'gate' | 'works' }
  | { type: 'collect'; amount: number }
  | { type: 'pay'; amount: number }
  | { type: 'payEach'; amount: number }
  | { type: 'collectEach'; amount: number }
  | { type: 'repairs'; perDome: number; perSpire: number }
  | { type: 'toQuarantine' }
  | { type: 'pass' }
  | { type: 'back'; steps: number };

export interface Card {
  id: string;
  deck: DeckId;
  title: string;
  text: string;
  effect: CardEffect;
}

const signal: Omit<Card, 'deck'>[] = [
  { id: 's1', title: 'Clear window', text: 'Mission control opens a clean launch window. Fly to Launch and collect your stipend.', effect: { type: 'advance', to: 0 } },
  { id: 's2', title: 'Ice survey', text: 'A survey drone needs an escort. Fly to Glacier Eye. Passing Launch pays your stipend.', effect: { type: 'advance', to: 24 } },
  { id: 's3', title: 'Night market', text: 'The lantern market on Glowmere is open late. Fly there. Passing Launch pays your stipend.', effect: { type: 'advance', to: 11 } },
  { id: 's4', title: 'Power surge', text: 'Fly to the nearest works. If someone owns it, roll the dice and pay them ten times the roll.', effect: { type: 'nearest', kind: 'works' } },
  { id: 's5', title: 'Gate rush', text: 'Fly to the nearest gate. If someone owns it, pay them double the usual toll.', effect: { type: 'nearest', kind: 'gate' } },
  { id: 's6', title: 'Express lane', text: 'Fly to the nearest gate. If someone owns it, pay them double the usual toll.', effect: { type: 'nearest', kind: 'gate' } },
  { id: 's7', title: 'Mining royalty', text: 'The belt mines send your royalty. Collect ✦60.', effect: { type: 'collect', amount: 60 } },
  { id: 's8', title: 'Clearance pass', text: 'Hold on to this. It lets you out of Quarantine for free. You may also sell or swap it.', effect: { type: 'pass' } },
  { id: 's9', title: 'Thruster stall', text: 'Your thrusters cough. Drift back three spaces.', effect: { type: 'back', steps: 3 } },
  { id: 's10', title: 'Contamination alert', text: 'A sensor flags your hull. Fly directly to Quarantine, with no stipend on the way.', effect: { type: 'toQuarantine' } },
  { id: 's11', title: 'Seal inspection', text: 'Every dome needs new seals. Pay ✦30 per dome and ✦120 per spire.', effect: { type: 'repairs', perDome: 30, perSpire: 120 } },
  { id: 's12', title: 'Docking ticket', text: 'You parked across two berths. Pay ✦20.', effect: { type: 'pay', amount: 20 } },
  { id: 's13', title: 'Halo run', text: 'Take a ride through Halo Gate. Passing Launch pays your stipend.', effect: { type: 'advance', to: 5 } },
  { id: 's14', title: 'Summit invite', text: 'You are summoned to Zenith Throne. Fly there.', effect: { type: 'advance', to: 39 } },
  { id: 's15', title: 'Docking scrape', text: 'You dented every hull in the bay while parking. Pay every other player ✦60.', effect: { type: 'payEach', amount: 60 } },
  { id: 's16', title: 'Long-haul payout', text: 'A long freight run finally clears customs. Collect ✦180.', effect: { type: 'collect', amount: 180 } },
];

const salvage: Omit<Card, 'deck'>[] = [
  { id: 'v1', title: 'Tow home', text: 'A friendly tug hauls you to Launch. Collect your stipend.', effect: { type: 'advance', to: 0 } },
  { id: 'v2', title: 'Lost drone found', text: 'A survey drone you lost years ago turns up full of ore. Collect ✦240.', effect: { type: 'collect', amount: 240 } },
  { id: 'v3', title: 'Booster shots', text: 'Your crew is due for vaccine boosters. Pay ✦60.', effect: { type: 'pay', amount: 60 } },
  { id: 'v4', title: 'Scrap sale', text: 'You sell a crate of old circuit boards. Collect ✦60.', effect: { type: 'collect', amount: 60 } },
  { id: 'v5', title: 'Clearance pass', text: 'Hold on to this. It lets you out of Quarantine for free. You may also sell or swap it.', effect: { type: 'pass' } },
  { id: 'v6', title: 'Stowaway found', text: 'Someone hid in your cargo hold. Fly directly to Quarantine, with no stipend on the way.', effect: { type: 'toQuarantine' } },
  { id: 'v7', title: 'Festival purse', text: 'The solstice festival shares its takings. Collect ✦120.', effect: { type: 'collect', amount: 120 } },
  { id: 'v8', title: 'Fuel rebate', text: 'You overpaid for fuel last cycle. Collect ✦25.', effect: { type: 'collect', amount: 25 } },
  { id: 'v9', title: 'Fuel share', text: 'You lent everyone fuel last cycle. Every other player pays you back ✦12.', effect: { type: 'collectEach', amount: 12 } },
  { id: 'v10', title: 'Beacon reward', text: 'You return a lost beacon to its owner. Collect ✦120.', effect: { type: 'collect', amount: 120 } },
  { id: 'v11', title: 'Airlock jam', text: 'A stuck airlock needs a specialist. Pay ✦120.', effect: { type: 'pay', amount: 120 } },
  { id: 'v12', title: 'Chart update', text: 'Your navigation charts have expired. Pay ✦60 for new ones.', effect: { type: 'pay', amount: 60 } },
  { id: 'v13', title: 'Pilot for hire', text: 'You fly a cargo run for a neighbour. Collect ✦30.', effect: { type: 'collect', amount: 30 } },
  { id: 'v14', title: 'Meteor shower', text: 'Pebbles pit every roof you own. Pay ✦50 per dome and ✦140 per spire.', effect: { type: 'repairs', perDome: 50, perSpire: 140 } },
  { id: 'v15', title: 'Lucky coin', text: 'You find an old coin wedged in the cargo rails. Collect ✦12.', effect: { type: 'collect', amount: 12 } },
  { id: 'v16', title: 'Comet ice sale', text: 'You sell a block of clean comet ice. Collect ✦120.', effect: { type: 'collect', amount: 120 } },
];

export const DECKS: Record<DeckId, Card[]> = {
  signal: signal.map((c) => ({ ...c, deck: 'signal' as const })),
  salvage: salvage.map((c) => ({ ...c, deck: 'salvage' as const })),
};

export const DECK_NAMES: Record<DeckId, string> = { signal: 'Signal', salvage: 'Salvage' };

export const cardById = (id: string): Card => {
  const c = DECKS.signal.find((x) => x.id === id) ?? DECKS.salvage.find((x) => x.id === id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
};
