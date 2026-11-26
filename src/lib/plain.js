// Plain-English summary of each offer type. Every number comes from the live math (evaluate), never typed in.
import { money } from './dealmath.js';

const months = (m) => (Number.isFinite(m) ? (m <= 0 ? 'right away' : m < 24 ? `${Math.ceil(m)} months in` : `${(m / 12).toFixed(1)} years in`) : 'never at this credit');

export function plain(structure, r) {
  const x = r.inputs;
  const cashUp = r.cashIn > 0 ? money(r.cashIn) : '$0';
  if (structure === 'master_lease') {
    const buyAt = x.optionPrice + x.sellerAdvances;
    return {
      glance: 'We run the whole building now and buy it later at a price locked in today.',
      owns: 'Seller, until we buy',
      payoff: 'Once all 10 units are rented',
      cash: cashUp,
      risk: 'The seller keeps the building and their loan until we buy',
      lines: [
        'We lease the whole building and run it. The seller keeps the deed and their loan, and we hold a locked price to buy it later.',
        `The seller gets ${money(x.payment)}/mo once it’s full${x.sellerAdvances ? `, fronts ${money(x.sellerAdvances)} for rent-ready work and lease-up, and gets that back in the price` : ''}. We buy for ${money(buyAt)} once all 10 units are rented and a bank refinance can cover it.`,
      ],
    };
  }
  if (structure === 'wrap') {
    return {
      glance: 'We buy now and pay the seller every month. Their loan stays in place.',
      owns: 'We do, from closing',
      payoff: 'Once all 10 units are rented',
      cash: cashUp,
      risk: 'The seller’s bank could ask for its loan back when the building changes hands',
      lines: [
        'We buy the building now and pay the seller every month instead of paying a bank. The seller’s own loan stays where it is.',
        `We pay the seller ${money(r.sellerMonthly)}/mo and they keep paying their own loan from it. We pay off the note when all 10 units are rented and we refinance.`,
      ],
    };
  }
  if (structure === 'partnership') {
    const gap = r.extra[1][1];
    return {
      glance: 'We own it together for a short time, then we buy the seller out.',
      owns: 'Both of us in one company, then us',
      payoff: `At the buyout, ${x.monthsToBuyout} months in`,
      cash: cashUp,
      risk: gap > 0 ? `The bank refinance comes up ${money(gap)} short of the buyout` : 'The bank refinance has to cover the buyout',
      lines: [
        'The seller and we own it together in one company for a short time while we fix it and fill it.',
        `The seller gets ${money(x.stepUp)}/mo once it’s full, then ${money(x.buyout + x.sellerAdvances)} when we buy them out with a bank refinance, ${x.monthsToBuyout} months in. If they owe more than that on their loan, they’d cover the difference.`,
      ],
    };
  }
  if (structure === 'cash') {
    return {
      glance: 'A normal sale. The seller is paid in full at closing.',
      owns: 'We do, from closing',
      payoff: 'At closing',
      cash: cashUp,
      risk: r.dscr < 1 ? 'Rent doesn’t cover the bank payment at this price' : r.dscr < 1.2 ? 'Rent barely covers the bank payment' : 'Needs a bank loan and cash down',
      lines: [
        'A normal sale. We get a bank loan, the seller is paid in full at closing and is done.',
        `We bring ${cashUp} up front for the down payment, closing and rent-ready work.`,
      ],
    };
  }
  if (structure === 'seller_rehab') {
    return {
      glance: 'The seller fronts part of the rehab and shares rent until a refinance pays off their loan.',
      owns: 'Seller until refinance, then us',
      payoff: `At refinance, month ${x.refiMonth}`,
      cash: cashUp,
      risk: 'His rehab money is only paid back through his share of the rent unless added to the buyout',
      lines: [
        `The seller puts ${money(x.sellerFund)} toward rehab while we run the building. Until ${x.fillTarget} units are filled, the seller gets the extra rent; after that, we split ${x.buyerSplitPct}% / ${100 - x.buyerSplitPct}%.`,
        `At month ${x.refiMonth}, a bank refinance pays off the seller’s loan${x.addFundToBuyout ? ` plus ${money(x.sellerFund)}` : ''}.`,
      ],
    };
  }
  return { glance: '—', owns: '—', payoff: '—', cash: cashUp, risk: '—', lines: [] };
}
