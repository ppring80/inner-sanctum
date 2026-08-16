// draft-market-profile.test.js
// Node-only regression tests for SAGE Step 3 Market Value.

const {
  normalizeAdpToPick,
  buildMarketValue,
  buildReturnOutlook,
  buildDraftMarketProfile
} = require('../netlify/functions/draft-market-profile');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name);
  }
}

function eq(name, actual, expected) {
  check(
    name +
      ` (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    actual === expected
  );
}

// ADP normalization: nearest actual draft slot,
// not an invented tolerance band.
eq(
  'ADP 37.4 -> market pick 37',
  normalizeAdpToPick(37.4),
  37
);

eq(
  'ADP 37.5 -> market pick 38',
  normalizeAdpToPick(37.5),
  38
);

eq(
  'invalid ADP -> null',
  normalizeAdpToPick(null),
  null
);

eq(
  'fallback sentinel ADP -> null',
  normalizeAdpToPick(999),
  null
);

// Market Value — discount.
let r = buildMarketValue(20.2, 30);

eq(
  'discount label',
  r.label,
  'Discount'
);

eq(
  'discount delta positive',
  r.picksVsMarket,
  10
);

check(
  'discount explanation plain English',
  r.explanation.includes('10 picks later')
);

// Market Value — ahead of market.
r = buildMarketValue(37.2, 30);

eq(
  'ahead label',
  r.label,
  'Ahead of Market'
);

eq(
  'ahead delta negative',
  r.picksVsMarket,
  -7
);

check(
  'ahead explanation plain English',
  r.explanation.includes('7 picks ahead')
);

// Market Value — exact rounded slot.
r = buildMarketValue(29.6, 30);

eq(
  'rounded same slot is At Market',
  r.label,
  'At Market'
);

eq(
  'at-market delta zero',
  r.picksVsMarket,
  0
);

// No usable market data.
r = buildMarketValue(999, 30);

eq(
  'unknown market label',
  r.label,
  'Market Value Unknown'
);

eq(
  'unknown market delta',
  r.picksVsMarket,
  null
);

// Return outlook:
// ADP before next pick => market risk.
r = buildReturnOutlook(37.2, 30, 43);

eq(
  'return-risk label',
  r.label,
  'Market Leans Gone'
);

eq(
  'next-turn distance',
  r.picksUntilNextTurn,
  13
);

eq(
  'market cushion positive when ADP before next pick',
  r.marketCushion,
  6
);

// Return outlook:
// ADP at next pick => market gives room to wait.
r = buildReturnOutlook(43.2, 30, 43);

eq(
  'ADP rounds to next pick => may return',
  r.label,
  'Market Says He May Return'
);

eq(
  'market cushion zero at next pick',
  r.marketCushion,
  0
);

// Return outlook:
// ADP after next pick.
r = buildReturnOutlook(49.1, 30, 43);

eq(
  'ADP after next pick => may return',
  r.label,
  'Market Says He May Return'
);

eq(
  'market cushion negative when ADP after next pick',
  r.marketCushion,
  -6
);

// Manual / unknown next pick.
r = buildReturnOutlook(37.2, 30, null);

eq(
  'manual/unknown next pick is explicit',
  r.label,
  'No Next-Pick Read'
);

eq(
  'manual/unknown cushion null',
  r.marketCushion,
  null
);

// End-of-draft / malformed next pick.
r = buildReturnOutlook(37.2, 30, 30);

eq(
  'same current and next pick is no next-pick read',
  r.label,
  'No Next-Pick Read'
);

// Full profile — the key draft-day tension case.
r = buildDraftMarketProfile({
  adp: 37.2,
  currentPick: 30,
  nextUserPick: 43,
  adpSource: 'live'
});

eq(
  'tension case: ahead of market',
  r.marketValue.label,
  'Ahead of Market'
);

eq(
  'tension case: market leans gone',
  r.returnOutlook.label,
  'Market Leans Gone'
);

eq(
  'source preserved',
  r.context.adpSource,
  'live'
);

// Full profile — obvious discount.
r = buildDraftMarketProfile({
  adp: 20.2,
  currentPick: 30,
  nextUserPick: 43,
  adpSource: 'live'
});

eq(
  'discount case: discount',
  r.marketValue.label,
  'Discount'
);

eq(
  'discount case: market leans gone',
  r.returnOutlook.label,
  'Market Leans Gone'
);

// Full profile — wait case.
r = buildDraftMarketProfile({
  adp: 50.2,
  currentPick: 30,
  nextUserPick: 43,
  adpSource: 'fallback'
});

eq(
  'wait case: ahead of market',
  r.marketValue.label,
  'Ahead of Market'
);

eq(
  'wait case: may return',
  r.returnOutlook.label,
  'Market Says He May Return'
);

eq(
  'fallback source preserved without pretending it is live',
  r.context.adpSource,
  'fallback'
);

// Pure/non-mutating.
const input = {
  adp: 37.2,
  currentPick: 30,
  nextUserPick: 43,
  adpSource: 'live'
};

const before = JSON.stringify(input);

buildDraftMarketProfile(input);

eq(
  'input is not mutated',
  JSON.stringify(input),
  before
);

// No raw probability claims in consumer labels.
[
  buildDraftMarketProfile({
    adp: 37.2,
    currentPick: 30,
    nextUserPick: 43
  }),
  buildDraftMarketProfile({
    adp: 50.2,
    currentPick: 30,
    nextUserPick: 43
  })
].forEach((p, i) => {
  check(
    `profile ${i + 1} makes no percentage/probability claim`,
    !/%|probab|guarantee|certain/i.test(
      p.marketValue.label +
        ' ' +
        p.marketValue.explanation +
        ' ' +
        p.returnOutlook.label +
        ' ' +
        p.returnOutlook.explanation
    )
  );
});

console.log(
  `draft-market-profile.test.js: ${passed}/${passed + failed} passed`
);

if (failures.length) {
  failures.forEach(f => console.error('FAIL:', f));
  process.exit(1);
}
