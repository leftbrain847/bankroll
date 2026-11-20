/**
 * The two draw decks, 16 cards each: News and Civic. Each deck holds the required mix of effect types (move to a
 * space, move to the nearest subway line or utility, collect, pay, pay or collect from every player, building
 * repairs, Jail, the Jail-release card, move back three). Titles, situations, destinations and amounts are
 * Bankroll's own. Amounts are in dollars on the ECONOMY scale.
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
  { id: 'n12', title: 'Patent sold', text: 'A company buys your kitchen-gadget patent. Collect $160.', effect: { type: 'collect', amount: 160 } },
  { id: 'n7', title: 'Food truck review', text: 'Your taco truck review goes viral. Collect $75.', effect: { type: 'collect', amount: 75 } },
  { id: 'n5', title: 'Express service', text: 'Ride ahead to the next subway line. If someone owns it, they charge you double rent.', effect: { type: 'nearest', kind: 'subway' } },
  { id: 'n11', title: 'Fire code update', text: 'New sprinkler rules: $35 for every house you own and $115 for every hotel.', effect: { type: 'repairs', perHouse: 35, perHotel: 115 } },
  { id: 'n3', title: 'Farmers market', text: 'Spend the morning on Elm Terrace. Move there, and pick up your salary if you pass Start.', effect: { type: 'advance', to: 16 } },
  { id: 'n10', title: 'Jaywalking sting', text: 'You are arrested. Move to Jail; your turn ends.', effect: { type: 'toJail' } },
  { id: 'n14', title: 'Library fines', text: 'Those overdue books add up. Pay $35.', effect: { type: 'pay', amount: 35 } },
  { id: 'n1', title: 'Early paycheck', text: 'Your boss pays a day early. Move to Start and collect your salary.', effect: { type: 'advance', to: 0 } },
  { id: 'n9', title: 'Road closure', text: 'A detour sends you three spaces backward.', effect: { type: 'back', steps: 3 } },
  { id: 'n16', title: 'Rooftop party', text: 'You are on the guest list at Summit Heights. Move there.', effect: { type: 'advance', to: 37 } },
  { id: 'n4', title: 'Heat wave', text: 'Move ahead to the next utility. If someone owns it, roll the dice and pay them ten times the roll.', effect: { type: 'nearest', kind: 'utility' } },
  { id: 'n15', title: 'Office party', text: 'You cover the cake. Pay each other player $45.', effect: { type: 'payEach', amount: 45 } },
  { id: 'n8', title: 'Good lawyer', text: 'Keep this card. Play it while in Jail to leave without paying. It can be traded.', effect: { type: 'pass' } },
  { id: 'n13', title: 'Night shift', text: 'Catch the Uptown Line. Pick up your salary if you pass Start.', effect: { type: 'advance', to: 25 } },
  { id: 'n6', title: 'Missed your stop', text: 'Ride ahead to the next subway line. If someone owns it, they charge you double rent.', effect: { type: 'nearest', kind: 'subway' } },
  { id: 'n2', title: 'Guest lecture', text: 'You are speaking on College Street. Move there, and pick up your salary if you pass Start.', effect: { type: 'advance', to: 21 } },
];

const civic: Omit<Card, 'deck'>[] = [
  { id: 'c7', title: 'Jury duty', text: 'Take the Midtown Line to the courthouse. Pick up your salary if you pass Start.', effect: { type: 'advance', to: 15 } },
  { id: 'c12', title: 'Census work', text: 'You count heads for the city. Collect $110.', effect: { type: 'collect', amount: 110 } },
  { id: 'c3', title: 'Zoning permit', text: 'Your fence needs a permit. Pay $75.', effect: { type: 'pay', amount: 75 } },
  { id: 'c9', title: 'Carpool fund', text: 'Everyone owes you gas money. Collect $15 from each other player.', effect: { type: 'collectEach', amount: 15 } },
  { id: 'c16', title: 'Street fair booth', text: 'Your lemonade stand sells out. Collect $65.', effect: { type: 'collect', amount: 65 } },
  { id: 'c11', title: 'Old warrant', text: 'A pile of unpaid tickets catches up with you. You are arrested. Move to Jail; your turn ends.', effect: { type: 'toJail' } },
  { id: 'c1', title: 'Mural grant', text: 'The arts council funds your mural. Collect $90.', effect: { type: 'collect', amount: 90 } },
  { id: 'c14', title: 'Coupon day', text: 'Collect $20.', effect: { type: 'collect', amount: 20 } },
  { id: 'c2', title: 'Sidewalk assessment', text: 'The city bills owners for new sidewalks: $45 for every house and $125 for every hotel.', effect: { type: 'repairs', perHouse: 45, perHotel: 125 } },
  { id: 'c8', title: 'Scratch ticket', text: 'Lucky scratch. Collect $200.', effect: { type: 'collect', amount: 200 } },
  { id: 'c5', title: 'Lost paperwork', text: 'Keep this card. Play it while in Jail to leave without paying. It can be traded.', effect: { type: 'pass' } },
  { id: 'c13', title: 'Water bill', text: 'Pay $50.', effect: { type: 'pay', amount: 50 } },
  { id: 'c10', title: 'Lost and found', text: 'You return a wallet and get a reward. Collect $45.', effect: { type: 'collect', amount: 45 } },
  { id: 'c4', title: 'Towed', text: 'You parked in a loading zone. Pay $100 to get your car back.', effect: { type: 'pay', amount: 100 } },
  { id: 'c15', title: 'Small business award', text: 'Collect $140.', effect: { type: 'collect', amount: 140 } },
  { id: 'c6', title: 'Bottle deposits', text: 'Collect $30.', effect: { type: 'collect', amount: 30 } },
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
