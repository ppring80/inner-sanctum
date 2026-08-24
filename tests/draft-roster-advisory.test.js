const {
  buildRosterAdvisory,
  findUnmetPositions,
  countRemainingAtPosition,
  representativeNames,
  classifyDepth,
  buildMessage,
  CLASSIFICATION_LABELS
} = require(
  '../netlify/functions/draft-roster-advisory'
)._test;

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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Helpers ────────────────────────────────────────────────────────

function tePool(count, startAdp) {
  const pool = [];
  const base = startAdp || 100;
  for (let i = 0; i < count; i++) {
    pool.push({ name: 'TE ' + i, pos: 'TE', adp: base + i });
  }
  return pool;
}

// ─── 1. No rosterContext ────────────────────────────────────────────

check(
  'buildRosterAdvisory with no rosterContext returns []',
  deepEqual(
    buildRosterAdvisory({ currentPool: [] }),
    []
  )
);

check(
  'buildRosterAdvisory with rosterContext but no remainingDedicated returns []',
  deepEqual(
    buildRosterAdvisory({ rosterContext: {}, currentPool: [] }),
    []
  )
);

check(
  'buildRosterAdvisory with non-object rosterContext returns []',
  deepEqual(
    buildRosterAdvisory({ rosterContext: 'not-an-object', currentPool: [] }),
    []
  )
);

// ─── 2. All starting positions filled ───────────────────────────────

check(
  'buildRosterAdvisory with every position satisfied returns []',
  deepEqual(
    buildRosterAdvisory({
      rosterContext: {
        remainingDedicated: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
        numTeams: 10
      },
      currentPool: []
    }),
    []
  )
);

// ─── 3. One open position, abundant depth ───────────────────────────

const abundant = buildRosterAdvisory({
  rosterContext: {
    remainingDedicated: { QB: 0, RB: 0, WR: 0, TE: 1, K: 0, DEF: 0 },
    numTeams: 10
  },
  currentPool: tePool(20)
});

check(
  'abundant TE depth (10-team) classifies SAFE_TO_WAIT',
  abundant.length === 1 &&
    abundant[0].pos === 'TE' &&
    abundant[0].classification === 'SAFE_TO_WAIT'
);

check(
  'SAFE_TO_WAIT entry uses the "Options Still Available" consumer label',
  abundant[0].label === CLASSIFICATION_LABELS.SAFE_TO_WAIT &&
    abundant[0].label === 'Options Still Available'
);

// ─── 4. Thinning depth ───────────────────────────────────────────────

const thinning = buildRosterAdvisory({
  rosterContext: {
    remainingDedicated: { QB: 0, RB: 0, WR: 0, TE: 1, K: 0, DEF: 0 },
    numTeams: 10
  },
  currentPool: tePool(10)
});

check(
  'thinning TE depth (10-team) classifies MONITOR',
  thinning.length === 1 &&
    thinning[0].classification === 'MONITOR' &&
    thinning[0].label === 'Keep Monitoring'
);

// ─── 5. Near-exhausted depth ──────────────────────────────────────────

const exhausted = buildRosterAdvisory({
  rosterContext: {
    remainingDedicated: { QB: 0, RB: 0, WR: 0, TE: 1, K: 0, DEF: 0 },
    numTeams: 10
  },
  currentPool: tePool(3)
});

check(
  'near-exhausted TE depth (10-team) classifies PRIORITY_NOW',
  exhausted.length === 1 &&
    exhausted[0].classification === 'PRIORITY_NOW' &&
    exhausted[0].label === 'Consider Addressing Soon'
);

// ─── 6. Multiple positions open ──────────────────────────────────────

const multi = buildRosterAdvisory({
  rosterContext: {
    remainingDedicated: { QB: 0, RB: 1, WR: 0, TE: 1, K: 0, DEF: 0 },
    numTeams: 10
  },
  currentPool: tePool(20).concat([
    { name: 'RB1', pos: 'RB', adp: 50 },
    { name: 'RB2', pos: 'RB', adp: 51 }
  ])
});

check(
  'multiple unmet positions produce one entry each, not just the first in fixed order',
  deepEqual(
    multi.map((entry) => entry.pos),
    ['RB', 'TE']
  )
);

// ─── 7. K/DEF suppression while core offensive positions remain open ─

const kdefSuppressed = buildRosterAdvisory({
  rosterContext: {
    remainingDedicated: { QB: 0, RB: 0, WR: 0, TE: 1, K: 1, DEF: 1 },
    numTeams: 10
  },
  currentPool: tePool(20)
});

check(
  'K/DEF are suppressed while a core offensive position (TE) is still open',
  deepEqual(
    kdefSuppressed.map((entry) => entry.pos),
    ['TE']
  )
);

const kdefNormal = buildRosterAdvisory({
  rosterContext: {
    remainingDedicated: { QB: 0, RB: 0, WR: 0, TE: 0, K: 1, DEF: 1 },
    numTeams: 10
  },
  currentPool: [
    { name: 'K1', pos: 'K', adp: 200 },
    { name: 'DEF1', pos: 'DEF', adp: 205 }
  ]
});

check(
  'K/DEF appear normally once every core offensive position is satisfied',
  deepEqual(
    kdefNormal.map((entry) => entry.pos).sort(),
    ['DEF', 'K']
  )
);

// ─── 8. Malformed currentPool degrades safely ────────────────────────

let malformedThrew = false;
let malformedResult = null;

try {
  malformedResult = buildRosterAdvisory({
    rosterContext: {
      remainingDedicated: { TE: 1 },
      numTeams: 10
    },
    currentPool: 'not-an-array'
  });
} catch (e) {
  malformedThrew = true;
}

check(
  'malformed currentPool never throws',
  malformedThrew === false
);

check(
  'malformed currentPool is treated as zero depth (PRIORITY_NOW), never fabricated',
  malformedResult &&
    malformedResult.length === 1 &&
    malformedResult[0].classification === 'PRIORITY_NOW'
);

// ─── 9. Exact flagship customer scenario ─────────────────────────────
// 10-team league, Round 13ish (pick 129), QB1/RB5/WR5/TE0/K0/DEF0.
// No TE anywhere in the narrow candidates/evaluated slice used for
// ranking -- only in the broader currentPool. This is the exact
// condition that exposed Phase 1's limitation.

const flagshipRosterContext = {
  configured: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, FLEX: 1 },
  filled: { QB: 1, RB: 5, WR: 5, TE: 0, K: 0, DEF: 0 },
  remainingDedicated: { QB: 0, RB: 0, WR: 0, TE: 1, K: 1, DEF: 1 },
  numTeams: 10
};

// currentPool intentionally contains NO QB/RB/WR entries at all here --
// isolating that the TE advisory fires purely from currentPool, with
// zero dependency on the narrow candidates slice this scenario exposed
// as the actual bug.
const flagshipCurrentPool = [
  { name: 'Juwan Johnson', pos: 'TE', adp: 136 },
  { name: 'Brenton Strange', pos: 'TE', adp: 144 },
  { name: 'Hunter Henry', pos: 'TE', adp: 152 },
  { name: 'Chig Okonkwo', pos: 'TE', adp: 160 },
  { name: 'Dalton Schultz', pos: 'TE', adp: 168 }
].concat(tePool(15, 180));

const flagship = buildRosterAdvisory({
  rosterContext: flagshipRosterContext,
  currentPool: flagshipCurrentPool
});

check(
  'flagship scenario: TE advisory fires even with zero TE in the ranking slice',
  flagship.length === 1 &&
    flagship[0].pos === 'TE'
);

check(
  'flagship scenario: classifies SAFE_TO_WAIT given real currentPool depth',
  flagship[0].classification === 'SAFE_TO_WAIT'
);

check(
  'flagship scenario: representative options name the real top-ADP TEs',
  deepEqual(
    flagship[0].representativeOptions,
    ['Juwan Johnson', 'Brenton Strange', 'Hunter Henry']
  )
);

check(
  'flagship scenario: message explains waiting is reasonable, mentions TE, and names representative players without implying equal-quality/comparable options',
  flagship[0].message.indexOf('TE') !== -1 &&
    flagship[0].message.indexOf('Juwan Johnson') !== -1 &&
    flagship[0].message.indexOf('comparable') === -1
);

// K/DEF must not appear in the flagship scenario either, since TE (core
// offensive) is still open.
check(
  'flagship scenario: K/DEF do not appear alongside the open TE need',
  flagship.every((entry) => entry.pos !== 'K' && entry.pos !== 'DEF')
);

// ─── 10. Messaging rules -- explicit wording constraints ─────────────
// Do not claim: a head-to-head comparison happened; a player will
// definitely be available later; roster context changed the
// recommendation; the user must fill the position.

['SAFE_TO_WAIT', 'MONITOR', 'PRIORITY_NOW'].forEach((classification) => {
  const message = buildMessage(classification, 'TE');

  check(
    classification + ' message does not claim a head-to-head comparison',
    !/compared|versus|vs\.?\s|head-to-head/i.test(message)
  );

  check(
    classification + ' message does not guarantee future availability',
    !/will (remain|still be|be there)|guarantee/i.test(message)
  );

  check(
    classification +
      ' message does not claim roster context changed the recommendation',
    !/(changed|altered).*(recommendation|ranking)/i.test(message)
  );

  check(
    classification + ' message does not phrase this as mandatory',
    !/\byou must\b/i.test(message)
  );
});

// ─── 11. Internal helpers, directly ──────────────────────────────────

check(
  'findUnmetPositions returns canonical-order positions with remainingDedicated > 0',
  deepEqual(
    findUnmetPositions({ QB: 0, RB: 1, WR: 0, TE: 1, K: 0, DEF: 0 }),
    ['RB', 'TE']
  )
);

check(
  'findUnmetPositions ignores non-finite/undefined entries rather than guessing',
  deepEqual(
    findUnmetPositions({ QB: 0, TE: 1 }),
    ['TE']
  )
);

check(
  'countRemainingAtPosition counts only matching, case-insensitive position',
  countRemainingAtPosition(
    [
      { name: 'A', pos: 'te' },
      { name: 'B', pos: 'TE' },
      { name: 'C', pos: 'WR' }
    ],
    'TE'
  ) === 2
);

check(
  'classifyDepth: exactly at the safe threshold classifies SAFE_TO_WAIT',
  classifyDepth(15, 10) === 'SAFE_TO_WAIT'
);

check(
  'classifyDepth: exactly at the monitor threshold classifies MONITOR',
  classifyDepth(8, 10) === 'MONITOR'
);

check(
  'classifyDepth: zero remaining classifies PRIORITY_NOW',
  classifyDepth(0, 10) === 'PRIORITY_NOW'
);

check(
  'representativeNames caps at 3 and sorts by ascending ADP',
  deepEqual(
    representativeNames(
      [
        { name: 'High ADP', pos: 'TE', adp: 200 },
        { name: 'Low ADP', pos: 'TE', adp: 140 },
        { name: 'Mid ADP', pos: 'TE', adp: 160 },
        { name: 'Excluded', pos: 'TE', adp: 210 }
      ],
      'TE'
    ),
    ['Low ADP', 'Mid ADP', 'High ADP']
  )
);

// ─── Summary ──────────────────────────────────────────────────────────

console.log(
  `draft-roster-advisory.test.js: ${passed}/${passed + failed} passed`
);

if (failures.length) {
  failures.forEach(
    (failure) =>
      console.error(
        'FAIL:',
        failure
      )
  );

  process.exit(1);
}
