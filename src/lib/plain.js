// Plain-English summary of each offer type. Every number comes from the live math (evaluate), never typed in.
import { money } from './dealmath.js';

const months = (m) => (Number.isFinite(m) ? (m <= 0 ? 'right away' : m < 24 ? `about ${Math.ceil(m)} months in` : `about ${(m / 12).toFixed(1)} years in`) : 'never at this credit');

export function plain(structure, r) {
  const x = r.inputs;
  const cashUp = r.cashIn > 0 ? money(r.cashIn) : '$0';
  if (structure === 'master_lease') {
    const buyAt = x.optionPrice + x.sellerAdvances;
    return {
      owns: 'Seller, until we buy',
      payoff: `When we buy, ${months(r.extra[1][1])}`,
      cash: cashUp,
      risk: 'Seller still owns it and owes their loan until we buy',
      lines: [
        'We lease the whole building and run it. The seller keeps the deed and their loan, and we hold a locked price to buy it later.',
        `The seller gets ${money(x.payment)}/mo once it’s full${x.sellerAdvances ? `, fronts ${money(x.sellerAdvances)} for rent-ready work and lease-up, and gets that back in the price` : ''}. We buy for ${money(buyAt)}, ${months(r.extra[1][1])}, once a refi can cover it.`,
      ],
    };
  }
  if (structure === 'wrap') {
    return {
      owns: 'Us, from closing',
      payoff: 'When we refi or sell',
      cash: cashUp,
      risk: 'Seller’s lender could call their loan due when the deed moves',
      lines: [
        'We buy the building now. The seller finances it with a new note that wraps around their existing loan, which stays in place.',
        `We pay the seller ${money(r.sellerMonthly)}/mo and they keep paying their own loan from it. The note is paid off when we refi or sell, and no date is set yet.`,
      ],
    };
  }
  if (structure === 'partnership') {
    const gap = r.extra[1][1];
    return {
      owns: 'Both of us in an LLC, then us',
      payoff: `At the buyout, about ${x.monthsToBuyout} months in`,
      cash: cashUp,
      risk: gap > 0 ? `The refi comes up ${money(gap)} short of the buyout` : 'The refi has to cover the buyout',
      lines: [
        'The seller and we own it together in an LLC for a short time while we fill and fix it.',
        `The seller gets ${money(x.stepUp)}/mo once it’s full, then ${money(x.buyout + x.sellerAdvances)} when we buy them out with a refi, about ${x.monthsToBuyout} months in. If they owe more than that on their loan, they’d cover the difference.`,
      ],
    };
  }
  if (structure === 'cash') {
    return {
      owns: 'Us, from closing',
      payoff: 'At closing',
      cash: cashUp,
      risk: r.dscr < 1 ? 'Rent doesn’t cover the bank payment at this price' : r.dscr < 1.2 ? 'Rent barely covers the bank payment' : 'Needs a bank loan and cash down',
      lines: [
        'A normal sale. We get a bank loan, the seller is paid in full at closing and is done.',
        `We bring ${cashUp} up front for the down payment, closing and rent-ready work.`,
      ],
    };
  }
  return { owns: '—', payoff: '—', cash: cashUp, risk: '—', lines: [] };
}
