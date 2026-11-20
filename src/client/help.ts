/** How to play Moonhold, written for this game. Plain text sections; the UI renders them as text. */
import { ECONOMY as E } from '../game/economy';
import { money } from '../game/rules';

export const HELP: { title: string; body: string[] }[] = [
  {
    title: 'The idea',
    body: [
      'You are a moon trader. Fly around the orbit, claim moons, build domes on them, and collect docking fees from every rival who lands on your claims. When a rival cannot pay what they owe, they are out. The last trader still flying wins.',
    ],
  },
  {
    title: 'Your turn',
    body: [
      'Roll two dice and fly that many spaces clockwise. Rolled a pair? Take another turn after this one resolves. A third pair in one turn trips the contamination alarm and sends you straight to Quarantine.',
      `Every time you fly past or stop on Launch, the bank pays your ${money(E.salary)} stipend.`,
    ],
  },
  {
    title: 'Claiming moons, gates and works',
    body: [
      'Stop on an unclaimed moon, gate or works and you may buy it at its listed price. If you pass, it goes up for auction straight away, and everyone at the table can bid, you included. Bidding goes around the table; drop out when it gets too rich for you. If nobody bids, it stays with the bank.',
    ],
  },
  {
    title: 'Docking fees',
    body: [
      'Stop on someone else’s claim and you pay them its fee. A moon’s fee is printed on its details card. Hold every moon in a system (the moons that share a colour and mark) and the fee on its bare moons doubles.',
      `Gates charge ${money(E.gateRent)} if the owner holds one gate, and the fee doubles for each extra gate they hold, up to eight times for all four.`,
      `Works charge the dice you just rolled times ${E.worksMultiplierOne}, or times ${E.worksMultiplierBoth} if the owner holds both works.`,
      'A mortgaged claim charges nothing.',
    ],
  },
  {
    title: 'Domes and spires',
    body: [
      'Once you hold a whole system, you can build domes on its moons, on your turn, as many as you can afford. Build evenly: no moon may get a second dome before every moon in the system has one, and so on. After four domes, a moon can be upgraded to a spire, which hands its four domes back to the bank.',
      `The bank only has ${E.domes} domes and ${E.spires} spires. When they run out, nobody can build until some come back. A spire can only be broken back down into domes if the bank has the domes to give; otherwise sell the whole system down at once.`,
      'Selling a building back to the bank refunds half of what it cost.',
    ],
  },
  {
    title: 'Mortgages',
    body: [
      'Short on glints? Mortgage a claim to the bank for half its price. It charges no fee while mortgaged. To lift the mortgage, repay it plus ten percent. You must sell every building in a system before mortgaging any moon in it.',
    ],
  },
  {
    title: 'Signal and Salvage',
    body: [
      'Stop on a Signal or Salvage space and draw the top card of that deck. Do what it says, then it goes to the bottom of the deck. A Clearance Pass is the exception: keep it until you use it or trade it.',
    ],
  },
  {
    title: 'Quarantine',
    body: [
      'You end up in Quarantine by stopping on the Tractor Beam, by drawing a card that says so, or by rolling three pairs in one turn. You fly straight there and collect no stipend. Landing on Quarantine by an ordinary roll is just a visit.',
      `To get out, at the start of your turn either pay ${money(E.quarantineFee)}, use a Clearance Pass, or try to roll a pair. A pair frees you and you fly that roll, but you do not roll again. After your third failed try you must pay ${money(E.quarantineFee)} and fly the roll you just made. You can still collect fees, build and trade while inside.`,
    ],
  },
  {
    title: 'Trading',
    body: [
      'On your turn you can offer any other player a deal: claims, glints and Clearance Passes in any mix, both ways. They accept or decline. Moons in a system that has buildings can’t be traded until those buildings are sold. Whoever receives a mortgaged claim pays the bank ten percent of its mortgage right away.',
    ],
  },
  {
    title: 'Owing more than you have',
    body: [
      'If you owe more than you hold, raise the difference by selling buildings, mortgaging claims or making trades, then pay. If even all of that can’t cover it, you are out. When you owe another player, they take everything you have left. When you owe the bank, it takes your claims back and auctions each one.',
    ],
  },
  {
    title: 'Pass-and-play and bots',
    body: [
      'Everyone shares one device. The banner shows whose decision it is (an auction or a trade offer can briefly hand the device to another player). Bots play their own turns, bid at auctions and answer trade offers by themselves. Your game saves on this device as you play.',
    ],
  },
];
