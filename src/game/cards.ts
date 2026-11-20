/**
 * The two draw decks, 16 cards each: News and Civic. Card effects use the standard mix of effect types; every
 * title and line of text is Bankroll's own. Amounts are in dollars and sit on the same scale as ECONOMY.
 */
import type { DeckId } from './board';

export type CardEffect =
  | { type: 'advance'; to: number }
  | { type: 'nearest'; kind: 'subway' | 'utility' }
  | { type: 'collect'; amount: number }
  | { type: 'pay'; amount: number }
  | { type: 'payEach'; amount: number }
  | { type: 'collectEach'; amount: number }
  | { type: 'repairs'; perHouse: number; perHotel: number }
  | { type: 'toJail' }
  | { type: 'pass' }
  | { type: 'back'; steps: number };

export interface Card {
  id: string;
  deck: DeckId;
  title: string;
  text: string;
  effect: CardEffect;
}

const news: Omit<Card, 'deck'>[] = [
  { id: 'n1', title: 'Fresh start', text: 'Head back to Start and collect your salary.', effect: { type: 'advance', to: 0 } },
  { id: 'n2', title: 'Campus tour', text: 'Take a tour at Belltower Place. Passing Start on the way pays your salary.', effect: { type: 'advance', to: 24 } },
  { id: 'n3', title: 'Gallery opening', text: 'Stop by Gallery Walk. Passing Start on the way pays your salary.', effect: { type: 'advance', to: 11 } },
  { id: 'n4', title: 'Blackout', text: 'Go to the nearest utility. If someone owns it, roll the dice and pay them ten times the roll.', effect: { type: 'nearest', kind: 'utility' } },
  { id: 'n5', title: 'Rush hour', text: 'Go to the nearest subway line. If someone owns it, pay them twice the usual rent.', effect: { type: 'nearest', kind: 'subway' } },
  { id: 'n6', title: 'Express train', text: 'Go to the nearest subway line. If someone owns it, pay them twice the usual rent.', effect: { type: 'nearest', kind: 'subway' } },
  { id: 'n7', title: 'Stock tip pays off', text: 'Collect $60.', effect: { type: 'collect', amount: 60 } },
  { id: 'n8', title: 'Jail pass', text: 'Use this to walk out of Jail for free whenever you need to. You can also sell or trade it.', effect: { type: 'pass' } },
  { id: 'n9', title: 'Wrong turn', text: 'Back up three spaces.', effect: { type: 'back', steps: 3 } },
  { id: 'n10', title: 'Arrested', text: 'Straight to Jail, with no salary on the way.', effect: { type: 'toJail' } },
  { id: 'n11', title: 'Building inspection', text: 'Every building you own needs work: $30 a house, $120 a hotel.', effect: { type: 'repairs', perHouse: 30, perHotel: 120 } },
  { id: 'n12', title: 'Parking ticket', text: 'Pay $20.', effect: { type: 'pay', amount: 20 } },
  { id: 'n13', title: 'Harbor trip', text: 'Ride out to the Harbor Line. Passing Start on the way pays your salary.', effect: { type: 'advance', to: 5 } },
  { id: 'n14', title: 'Penthouse viewing', text: 'Head up to Crown Tower.', effect: { type: 'advance', to: 39 } },
  { id: 'n15', title: 'Round on you', text: 'You buy dinner for the table. Pay every other player $60.', effect: { type: 'payEach', amount: 60 } },
  { id: 'n16', title: 'Big contract', text: 'A client pays early. Collect $180.', effect: { type: 'collect', amount: 180 } },
];

const civic: Omit<Card, 'deck'>[] = [
  { id: 'c1', title: 'City payroll', text: 'Payroll comes early. Move to Start and collect your salary.', effect: { type: 'advance', to: 0 } },
  { id: 'c2', title: 'Tax overpayment', text: 'The city owes you money. Collect $240.', effect: { type: 'collect', amount: 240 } },
  { id: 'c3', title: 'Dentist', text: 'Pay $60.', effect: { type: 'pay', amount: 60 } },
  { id: 'c4', title: 'Yard sale', text: 'Collect $60.', effect: { type: 'collect', amount: 60 } },
  { id: 'c5', title: 'Jail pass', text: 'Use this to walk out of Jail for free whenever you need to. You can also sell or trade it.', effect: { type: 'pass' } },
  { id: 'c6', title: 'Arrested', text: 'Straight to Jail, with no salary on the way.', effect: { type: 'toJail' } },
  { id: 'c7', title: 'Block party', text: 'Your neighbors chip in. Collect $120.', effect: { type: 'collect', amount: 120 } },
  { id: 'c8', title: 'Rebate', text: 'Collect $25.', effect: { type: 'collect', amount: 25 } },
  { id: 'c9', title: 'Housewarming', text: 'Every other player gives you $12.', effect: { type: 'collectEach', amount: 12 } },
  { id: 'c10', title: 'Savings bond', text: 'Collect $120.', effect: { type: 'collect', amount: 120 } },
  { id: 'c11', title: 'Plumber', text: 'A pipe burst. Pay $120.', effect: { type: 'pay', amount: 120 } },
  { id: 'c12', title: 'Tuition', text: 'Pay $60.', effect: { type: 'pay', amount: 60 } },
  { id: 'c13', title: 'Side job', text: 'Collect $30.', effect: { type: 'collect', amount: 30 } },
  { id: 'c14', title: 'Street repairs', text: 'The city bills owners for the potholes: $50 a house, $140 a hotel.', effect: { type: 'repairs', perHouse: 50, perHotel: 140 } },
  { id: 'c15', title: 'Raffle win', text: 'Collect $12.', effect: { type: 'collect', amount: 12 } },
  { id: 'c16', title: 'Found money', text: 'Collect $120.', effect: { type: 'collect', amount: 120 } },
];

export const DECKS: Record<DeckId, Card[]> = {
  news: news.map((c) => ({ ...c, deck: 'news' as const })),
  civic: civic.map((c) => ({ ...c, deck: 'civic' as const })),
};

export const DECK_NAMES: Record<DeckId, string> = { news: 'News', civic: 'Civic' };

export const cardById = (id: string): Card => {
  const c = DECKS.news.find((x) => x.id === id) ?? DECKS.civic.find((x) => x.id === id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
};
