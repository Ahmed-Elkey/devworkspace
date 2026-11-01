/* Pricing single source of truth.
   Billing model: guests are always free; each plan has a flat monthly rate
   per planner. Yearly billing is exactly "2 months free": the yearly bill is
   ten times the monthly rate, paid once a year. Any per-month figure shown for
   yearly is that bill amortised across 12 months. The pricing page and the
   register page both read their numbers from this file, so keep every price
   here and nowhere else. */

export const PLANS = [
  {
    key: 'solo', max: 1, monthly: 9, pick: false,
    art: [['#d9a07a', 'S']], h2: 'Solo',
    forTxt: 'For one person keeping a few projects on schedule.',
    lis: [
      '1 planner',
      'Timeline calendar with tasks and teammates',
      'File uploads with annotations and approvals',
      'Public review links, no login needed'
    ]
  },
  {
    key: 'team', max: 15, monthly: 19, pick: true,
    art: [['#d9a07a', 'S'], ['#9aa6ff', 'A'], ['#8c7cf6', 'D']], h2: 'Team',
    forTxt: 'For a team that shares work with clients and vendors.',
    lis: [
      'Up to 15 planners',
      { inh: 1, t: 'Everything in Solo' },
      'Shift one task or the whole schedule at once',
      'Collaborative documents',
      'Client dashboard with private guest threads',
      'Unlimited free guests'
    ]
  },
  {
    key: 'studio', max: 999, monthly: 39, pick: false,
    art: [['#d9a07a', 'S'], ['#9aa6ff', 'A'], ['#8c7cf6', 'D'], ['#f1fd82', 'K'], ['more', '+']], h2: 'Studio',
    forTxt: 'For agencies running many projects under their own brand.',
    lis: [
      'Unlimited planners',
      { inh: 1, t: 'Everything in Team' },
      'Your branding on logins and email notifications',
      'Password protection and view tracking',
      'Pipeline view across all projects'
    ]
  }
]

export function planBy(key) {
  return PLANS.find(function (p) { return p.key === key })
}

/* Yearly bill per planner per year: the monthly rate paid for ten months. */
export function yearlyBilled(plan) {
  return plan.monthly * 10
}

/* Yearly "per planner / month" figure: the yearly bill over 12 months. */
export function yearlyPerMonth(plan) {
  return plan.monthly * 10 / 12
}

/* Money text: whole dollars stay whole ("$19"); fractions keep two decimals ("$15.83"). */
export function fmtMoney(n) {
  return Number.isInteger(n) ? '$' + n : '$' + n.toFixed(2)
}
