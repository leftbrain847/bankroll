/** How to play Bankroll, written for this game. Plain text sections; the UI renders them as text. */
import { ECONOMY as E } from '../game/economy';
import { money } from '../game/rules';

export const HELP: { title: string; body: string[] }[] = [
  {
    title: 'Goal',
    body: ['Buy property, build on it and charge rent. A player who owes more than they can pay is out. The last player left wins.'],
  },
  {
    title: 'Taking a turn',
    body: [
      'Roll two dice and move that many spaces clockwise. Roll doubles and you go again after this move is settled. Doubles three times in one turn sends you to Jail.',
      `Each time you pass or land on Start, you collect ${money(E.salary)}.`,
    ],
  },
  {
    title: 'Buying',
    body: [
      'Land on a street, subway line or utility nobody owns and you can buy it for the listed price. If you don’t, it is auctioned right away to everyone, you included. Bids go around the table; drop out when it gets too expensive. If no one bids, the bank keeps it.',
    ],
  },
  {
    title: 'Rent',
    body: [
      'Land on a property someone else owns and you pay them rent. Tap any space to see its rents. If one player owns every street in a colour set, rent on that set’s empty streets doubles.',
      `A subway line charges ${money(E.subwayRent)} when its owner has one line, and doubles for each extra line they own, up to eight times with all four.`,
      `A utility charges the dice you rolled times ${E.utilityMultiplierOne}, or times ${E.utilityMultiplierBoth} if the owner has both.`,
      'Mortgaged property charges no rent.',
    ],
  },
  {
    title: 'Houses and hotels',
    body: [
      'When you own a whole colour set, you can build houses on it during your turn. Build evenly: no street gets a second house until every street in the set has one, and so on. After four houses, a street can take a hotel, and its four houses go back to the bank.',
      `The bank has ${E.houses} houses and ${E.hotels} hotels. When they run out, no one can build until some come back. A hotel only breaks back into houses if the bank has the houses to give; otherwise sell the whole set down at once.`,
      'Buildings sell back to the bank for half what they cost.',
    ],
  },
  {
    title: 'Mortgages',
    body: [
      'Need cash? Mortgage a property to the bank for half its price. It charges no rent while mortgaged. To pay it off, repay the mortgage plus ten percent. Sell every building in a set before mortgaging any street in it.',
    ],
  },
  {
    title: 'News and Civic cards',
    body: ['Land on News or Civic and draw the top card of that pile. Do what it says, then it goes to the bottom. Keep a Jail pass until you use it or trade it.'],
  },
  {
    title: 'Jail',
    body: [
      'You go to Jail by landing on Arrested, by drawing a card that sends you there, or by rolling doubles three times in a turn. Go straight there and collect no salary. Landing on Jail by a normal roll means you are just passing by.',
      `To get out, at the start of your turn pay ${money(E.jailFine)}, use a Jail pass, or try for doubles. Doubles get you out and you move that roll, but you don’t roll again. After your third miss you must pay ${money(E.jailFine)} and move the roll you just made. You still collect rent, build and trade while in Jail.`,
    ],
  },
  {
    title: 'Trading',
    body: [
      'On your turn you can offer any player a deal of properties, cash and Jail passes, in any mix and in both directions. They accept or decline. Streets in a set with buildings can’t be traded until the buildings are sold. Whoever receives a mortgaged property pays the bank ten percent of the mortgage right away.',
    ],
  },
  {
    title: 'Running out of money',
    body: [
      'If you owe more cash than you have, raise it by selling buildings, mortgaging or trading, then pay. If you can’t raise enough even then, you’re out. If you owed a player, they get everything you have left. If you owed the bank, it auctions your properties.',
    ],
  },
  {
    title: 'Pass-and-play and bots',
    body: [
      'Everyone shares one device. The banner shows whose decision it is; an auction or a trade offer can briefly hand the device to someone else. Bots play their own turns, bid and answer trades. Your game saves on this device as you play.',
    ],
  },
];
