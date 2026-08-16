const {
  volumeRank,
  isComparable,
  buildDepth,
  buildDraftScarcityProfile
} = require(
  '../netlify/functions/draft-scarcity-profile'
);

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

function eq(
  name,
  actual,
  expected
) {
  check(
    name +
      ` (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    actual === expected
  );
}

function rec(
  name,
  pos,
  adp,
  tier,
  trend = 'stable',
  role = 'rushing-dominant',
  sample = 'adequate',
  avg = 10
) {
  const signals = [];

  if (tier) {
    signals.push({
      type: 'volumeTier',
      value: tier
    });
  }

  if (trend) {
    signals.push({
      type: 'trendClassification',
      value: trend
    });
  }

  if (role) {
    signals.push({
      type: 'roleComposition',
      value: role
    });
  }

  if (sample) {
    signals.push({
      type: 'sampleSize',
      value: sample
    });
  }

  return {
    longName: name,
    pos,
    adp,

    opportunities: {
      avgLast3: avg,
      seasonAvg: avg
    },

    signals
  };
}

const chase = rec(
  'Chase Brown',
  'RB',
  17.4,
  'high-volume',
  'stable',
  'rushing-dominant',
  'adequate',
  20
);

const henry = rec(
  'Derrick Henry',
  'RB',
  38.6,
  'high-volume',
  'expanding',
  'rushing-dominant',
  'adequate',
  25
);

const breece = rec(
  'Breece Hall',
  'RB',
  40.2,
  'moderate-volume',
  'stable',
  'rushing-dominant',
  'adequate',
  16.67
);

const aj = rec(
  'A.J. Brown',
  'WR',
  14.5,
  'moderate-volume',
  'declining',
  'receiving-dominant',
  'adequate',
  7
);

const tee = rec(
  'Tee Higgins',
  'WR',
  35.1,
  'moderate-volume',
  'stable',
  'receiving-dominant',
  'adequate',
  5.67
);

const waddle = rec(
  'Jaylen Waddle',
  'WR',
  36.8,
  'moderate-volume',
  'stable',
  'receiving-dominant',
  'adequate',
  5
);

const egbuka = rec(
  'Emeka Egbuka',
  'WR',
  37.1,
  'role-player',
  'declining',
  'receiving-dominant',
  'adequate',
  3.33
);

const unknownRookie = {
  longName:
    'Jeremiah Love',

  pos:
    'RB',

  adp:
    39.1,

  opportunities:
    null,

  signals:
    []
};

eq(
  'high-volume rank',
  volumeRank(chase),
  3
);

eq(
  'moderate rank',
  volumeRank(breece),
  2
);

eq(
  'role-player rank',
  volumeRank(egbuka),
  1
);

check(
  'Henry comparable to Chase',
  isComparable(
    chase,
    henry
  )
);

check(
  'Breece not comparable to high-volume Chase',
  !isComparable(
    chase,
    breece
  )
);

check(
  'WR never comparable to RB',
  !isComparable(
    chase,
    tee
  )
);

let d =
  buildDepth(
    chase,
    [
      henry,
      breece,
      unknownRookie
    ]
  );

eq(
  'RB next pool known count',
  d.knownOptions,
  2
);

eq(
  'RB next pool unknown count',
  d.unknownOptions,
  1
);

eq(
  'RB next pool comparable count',
  d.comparableOptions,
  1
);

eq(
  'RB next pool label',
  d.label,
  'One Comparable Option'
);

eq(
  'RB comparable is Henry',
  d.comparablePlayers[0].longName,
  'Derrick Henry'
);

let p =
  buildDraftScarcityProfile({
    candidate:
      chase,

    currentPool:
      [chase],

    nextTurnPool:
      [
        henry,
        breece
      ]
  });

eq(
  'Chase cost with Henry later is Moderate',
  p.costOfWaiting.label,
  'Moderate'
);

check(
  'Chase explanation says one comparable',
  /Only one player/.test(
    p.costOfWaiting.explanation
  )
);

p =
  buildDraftScarcityProfile({
    candidate:
      aj,

    currentPool:
      [aj],

    nextTurnPool:
      [
        tee,
        waddle,
        egbuka
      ]
  });

eq(
  'AJ cost with Tee and Waddle later is Low',
  p.costOfWaiting.label,
  'Low'
);

eq(
  'AJ has two comparable WRs later',
  p.depthNextTurn.comparableOptions,
  2
);

p =
  buildDraftScarcityProfile({
    candidate:
      chase,

    currentPool:
      [chase],

    nextTurnPool:
      [breece]
  });

eq(
  'No comparable known RB later => High',
  p.costOfWaiting.label,
  'High'
);

p =
  buildDraftScarcityProfile({
    candidate:
      chase,

    currentPool:
      [chase],

    nextTurnPool:
      [
        breece,
        unknownRookie
      ]
  });

eq(
  'Missing-data RB prevents false High call',
  p.costOfWaiting.label,
  'Uncertain'
);

const moderateRB =
  rec(
    'Moderate RB',
    'RB',
    20,
    'moderate-volume'
  );

p =
  buildDraftScarcityProfile({
    candidate:
      moderateRB,

    currentPool:
      [moderateRB],

    nextTurnPool:
      [
        henry,
        breece
      ]
  });

eq(
  'Two same-or-better later => Low',
  p.costOfWaiting.label,
  'Low'
);

const highWR =
  rec(
    'High WR',
    'WR',
    18,
    'high-volume',
    'stable',
    'receiving-dominant',
    'adequate',
    10
  );

p =
  buildDraftScarcityProfile({
    candidate:
      highWR,

    currentPool:
      [highWR],

    nextTurnPool:
      [
        tee,
        waddle,
        egbuka
      ]
  });

eq(
  'WR can be High scarcity too',
  p.costOfWaiting.label,
  'High'
);

p =
  buildDraftScarcityProfile({
    candidate:
      null,

    currentPool:
      [],

    nextTurnPool:
      []
  });

eq(
  'Missing candidate => Unknown',
  p.costOfWaiting.label,
  'Unknown'
);

const noIntel = {
  longName:
    'No Intel',

  pos:
    'RB',

  adp:
    25,

  signals:
    []
};

p =
  buildDraftScarcityProfile({
    candidate:
      noIntel,

    currentPool:
      [noIntel],

    nextTurnPool:
      [henry]
  });

eq(
  'Candidate without Step 2 => Unknown',
  p.costOfWaiting.label,
  'Unknown'
);

const before =
  JSON.stringify(
    [
      chase,
      henry,
      breece,
      tee,
      waddle
    ]
  );

buildDraftScarcityProfile({
  candidate:
    chase,

  currentPool:
    [
      chase,
      henry
    ],

  nextTurnPool:
    [
      henry,
      breece
    ]
});

eq(
  'Pure/non-mutating',
  JSON.stringify(
    [
      chase,
      henry,
      breece,
      tee,
      waddle
    ]
  ),
  before
);

// Current-pool depth is descriptive only.
// It does not alter Cost of Waiting.

p =
  buildDraftScarcityProfile({
    candidate:
      aj,

    currentPool:
      [
        aj,
        tee,
        waddle
      ],

    nextTurnPool:
      [
        tee,
        waddle
      ]
  });

eq(
  'Depth Now reports multiple comparable',
  p.depthNow.label,
  'Multiple Comparable Options'
);

eq(
  'Cost still driven by next-turn pool',
  p.costOfWaiting.label,
  'Low'
);

console.log(
  `draft-scarcity-profile.test.js: ${passed}/${passed + failed} passed`
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
