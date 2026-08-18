// draft-opportunity-profile.test.js
//
// Regression suite for the NEW draftOpportunityProfile layer only.
// Runs the real, unmodified buildOpportunityIntelligence() from the
// actual repo (netlify/functions/refresh-opportunity-intel.js) on
// fixture game logs, then exercises buildDraftOpportunityProfile() on
// the result -- so this is validating against production calculation
// code, not a reimplementation of it.
//
// Run: node tests/draft-opportunity-profile.test.js

const oi = require('../netlify/functions/refresh-opportunity-intel');
const profileLib = require('../netlify/functions/draft-opportunity-profile');
const assert = require('assert');

function games(weeks, carriesArr, targetsArr) {
  return weeks.map((week, i) => ({
    week,
    gameID: `2026_WK${week}`,
    carries: carriesArr[i],
    targets: targetsArr[i],
    opportunities: carriesArr[i] + targetsArr[i],
  }));
}

const WEEKS_10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const fixtures = {
  'Bijan Robinson': {
    pos: 'RB',
    games: games(
      WEEKS_10,
      [14, 16, 15, 18, 17, 19, 20, 18, 21, 19],
      [3, 4, 3, 5, 4, 6, 5, 6, 7, 6]
    ),
  },

  'Jahmyr Gibbs': {
    pos: 'RB',
    games: games(
      WEEKS_10,
      [11, 13, 12, 14, 13, 15, 16, 14, 17, 15],
      [4, 5, 4, 6, 5, 7, 6, 7, 8, 7]
    ),
  },

  'Christian McCaffrey': {
    pos: 'RB',
    games: games(
      WEEKS_10,
      [18, 20, 19, 21, 20, 22, 23, 21, 24, 22],
      [6, 7, 6, 8, 7, 8, 7, 8, 9, 8]
    ),
  },

  'Derrick Henry': {
    pos: 'RB',
    games: games(
      WEEKS_10,
      [20, 22, 21, 23, 22, 24, 25, 23, 26, 24],
      [0, 1, 0, 1, 0, 1, 0, 1, 1, 0]
    ),
  },

  "Ja'Marr Chase": {
    pos: 'WR',
    games: games(
      WEEKS_10,
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [9, 10, 9, 11, 10, 12, 11, 10, 13, 11]
    ),
  },

  'Travis Kelce': {
    pos: 'TE',
    games: games(
      WEEKS_10,
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [8, 9, 8, 7, 7, 6, 6, 5, 5, 4]
    ),
  },

  'Committee Back': {
    pos: 'RB',
    games: games(
      WEEKS_10,
      [4, 5, 3, 4, 5, 4, 6, 5, 4, 5],
      [1, 2, 1, 1, 2, 1, 2, 1, 1, 2]
    ),
  },

  'Recently Returned WR': {
    pos: 'WR',
    games: games(
      [9, 10],
      [0, 0],
      [5, 7]
    ),
  },

  'Undrafted Rookie WR': {
    pos: 'WR',
    games: [],
  },
};

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push(name + ' :: ' + e.message);
  }
}

function recordFor(name) {
  const { pos, games } = fixtures[name];
  return oi.buildOpportunityIntelligence(games, pos);
}

function profileFor(name) {
  return profileLib.buildDraftOpportunityProfile(recordFor(name));
}

// ─────────────────────────────────────────────────────────
// 1. NO SCORE
// ─────────────────────────────────────────────────────────

Object.keys(fixtures).forEach((name) => {
  test('no score field exists anywhere in the profile for ' + name, () => {
    const p = profileFor(name);
    const json = JSON.stringify(p);

    assert.ok(!('score' in p));
    assert.ok(
      !/\"score\"/i.test(json),
      'no key named "score" anywhere in the serialized profile'
    );

    assert.strictEqual(
      Object.keys(p).sort().join(','),
      'evidence,roleDirection,roleStyle,workload'
    );
  });
});

test('no combined/weighted numeric field exists across the four parts', () => {
  const p = profileFor('Bijan Robinson');

  assert.ok(typeof p.workload.level === 'string');
  assert.ok(typeof p.roleDirection.label === 'string');
  assert.ok(typeof p.roleStyle.label === 'string');
  assert.ok(typeof p.evidence.level === 'string');
});

// ─────────────────────────────────────────────────────────
// 2. DO NOT MANUFACTURE CERTAINTY
// ─────────────────────────────────────────────────────────

test('rookie workload values stay null, never fabricated as 0', () => {
  const p = profileFor('Undrafted Rookie WR');

  assert.strictEqual(p.workload.seasonAvg, null);
  assert.strictEqual(p.workload.recentAvg, null);
  assert.notStrictEqual(p.workload.seasonAvg, 0);
});

test('limited-sample player explicitly says Not Enough Data Yet', () => {
  const p = profileFor('Recently Returned WR');

  assert.strictEqual(
    p.roleDirection.label,
    'Not Enough Data Yet'
  );
});

test('fewer than 6 games never gets an Increasing/Decreasing label', () => {
  const p = profileFor('Recently Returned WR');

  assert.ok(
    ![
      'Increasing Role',
      'Decreasing Role',
      'Sustained Decline',
    ].includes(p.roleDirection.label)
  );
});

// ─────────────────────────────────────────────────────────
// 3. ROOKIES VS POOR OPPORTUNITY
// ─────────────────────────────────────────────────────────

test('rookie gets No NFL History across all four profile parts', () => {
  const p = profileFor('Undrafted Rookie WR');

  assert.strictEqual(p.workload.level, 'No NFL History');
  assert.strictEqual(p.roleDirection.label, 'No NFL History');
  assert.strictEqual(p.roleStyle.label, 'No NFL History');
  assert.strictEqual(p.evidence.level, 'No NFL History');
});

test('low-volume veteran remains distinct from No NFL History', () => {
  const p = profileFor('Committee Back');

  assert.notStrictEqual(
    p.workload.level,
    'No NFL History'
  );

  assert.strictEqual(
    p.workload.level,
    'Role Player'
  );

  assert.notStrictEqual(
    p.roleStyle.label,
    'No NFL History'
  );
});

test('rookie explanation says missing history is not an opportunity judgment', () => {
  const p = profileFor('Undrafted Rookie WR');

  assert.ok(
    p.evidence.explanation
      .toLowerCase()
      .includes('not a judgment')
  );
});

// ─────────────────────────────────────────────────────────
// 4. SAMPLE SIZE
// ─────────────────────────────────────────────────────────

test('2-game player is Limited Sample; 10-game player is Established Sample', () => {
  const limited = profileFor('Recently Returned WR');
  const established = profileFor('Bijan Robinson');

  assert.strictEqual(
    limited.evidence.level,
    'Limited Sample'
  );

  assert.strictEqual(
    established.evidence.level,
    'Established Sample'
  );
});

test('evidence gamesSampled remains the real raw count', () => {
  assert.strictEqual(
    profileFor('Recently Returned WR').evidence.gamesSampled,
    2
  );

  assert.strictEqual(
    profileFor('Bijan Robinson').evidence.gamesSampled,
    10
  );

  assert.strictEqual(
    profileFor('Undrafted Rookie WR').evidence.gamesSampled,
    0
  );
});

test('limited sample can still have a real workload and role-style reading', () => {
  const p = profileFor('Recently Returned WR');

  assert.notStrictEqual(
    p.workload.level,
    null
  );

  assert.notStrictEqual(
    p.roleStyle.label,
    'No NFL History'
  );
});

// ─────────────────────────────────────────────────────────
// 5. BASELINE / ROLE-DIRECTION PRESERVATION
// ─────────────────────────────────────────────────────────

test('recentRoleVsBaseline remains unclassified', () => {
  Object.keys(fixtures).forEach((name) => {
    const record = recordFor(name);

    const sig =
      (record.signals || []).find(
        (s) => s.type === 'recentRoleVsBaseline'
      );

    if (sig) {
      assert.strictEqual(
        sig.value,
        'unclassified',
        name
      );
    }
  });
});

test('persistence refines only an already-declining trend; stable trend stays Stable Role', () => {
  const p = profileFor('Travis Kelce');

  assert.strictEqual(
    p.roleDirection.label,
    'Stable Role'
  );
});

test('large recent increase reads as above season norm', () => {
  const syntheticGames = [
    { week: 1, carries: 8, targets: 0, opportunities: 8 },
    { week: 2, carries: 8, targets: 0, opportunities: 8 },
    { week: 3, carries: 8, targets: 0, opportunities: 8 },
    { week: 4, carries: 8, targets: 0, opportunities: 8 },
    { week: 5, carries: 25, targets: 0, opportunities: 25 },
    { week: 6, carries: 25, targets: 0, opportunities: 25 },
    { week: 7, carries: 25, targets: 0, opportunities: 25 },
  ];

  const record =
    oi.buildOpportunityIntelligence(
      syntheticGames,
      'RB'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.ok(
    p.roleDirection.explanation.includes(
      'above his season norm'
    )
  );
});

test('roleDirection explanations never expose raw percent numbers', () => {
  Object.keys(fixtures).forEach((name) => {
    const p = profileFor(name);

    assert.ok(
      !/%/.test(
        p.roleDirection.explanation
      ),
      name
    );

    assert.ok(
      !/\d+\.\d/.test(
        p.roleDirection.explanation
      ),
      name
    );
  });
});

test('roleDirection uses only approved season-norm phrases', () => {
  const APPROVED = [
    'above his season norm',
    'below his season norm',
    'near his season norm',
  ];

  Object.keys(fixtures).forEach((name) => {
    const p = profileFor(name);

    const hasBaselineNote =
      p.roleDirection.explanation.includes(
        'season norm'
      );

    if (hasBaselineNote) {
      assert.ok(
        APPROVED.some((phrase) =>
          p.roleDirection.explanation.includes(
            phrase
          )
        ),
        name
      );
    }
  });
});

test('small absolute low-volume change remains near season norm despite large percentage', () => {
  const syntheticGames = [
    { week: 1, carries: 1, targets: 1, opportunities: 2 },
    { week: 2, carries: 1, targets: 1, opportunities: 2 },
    { week: 3, carries: 2, targets: 1, opportunities: 3 },
    { week: 4, carries: 1, targets: 0, opportunities: 1 },
    { week: 5, carries: 1, targets: 1, opportunities: 2 },
    { week: 6, carries: 1, targets: 0, opportunities: 1 },
    { week: 7, carries: 1, targets: 1, opportunities: 2 },
  ];

  const record =
    oi.buildOpportunityIntelligence(
      syntheticGames,
      'RB'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.ok(
    p.roleDirection.explanation.includes(
      'near his season norm'
    )
  );
});

test('describeRecentVsBaseline returns null when percentDelta is unavailable', () => {
  assert.strictEqual(
    profileLib.describeRecentVsBaseline({
      detail: {
        percentDelta: null,
        absoluteDelta: 0,
      },
    }),
    null
  );

  assert.strictEqual(
    profileLib.describeRecentVsBaseline(null),
    null
  );
});

// ─────────────────────────────────────────────────────────
// 6. ROLE STYLE
// ─────────────────────────────────────────────────────────

test('highValue remains empty', () => {
  const record = recordFor('Bijan Robinson');

  assert.deepStrictEqual(
    record.highValue,
    {}
  );
});

test('roleStyle depends on roleComposition, not volume', () => {
  const bijan =
    profileFor('Bijan Robinson');

  const lowVolRushing =
    oi.buildOpportunityIntelligence(
      [
        { week: 1, carries: 3, targets: 1, opportunities: 4 },
        { week: 2, carries: 3, targets: 1, opportunities: 4 },
        { week: 3, carries: 3, targets: 1, opportunities: 4 },
      ],
      'RB'
    );

  const lowVolProfile =
    profileLib.buildDraftOpportunityProfile(
      lowVolRushing
    );

  assert.strictEqual(
    bijan.roleStyle.label,
    'Rush-Heavy'
  );

  assert.strictEqual(
    lowVolProfile.roleStyle.label,
    'Rush-Heavy'
  );
});

test('roleStyle uses the three simplified role-composition labels', () => {
  assert.strictEqual(
    profileFor('Bijan Robinson').roleStyle.label,
    'Rush-Heavy'
  );

  assert.strictEqual(
    profileFor("Ja'Marr Chase").roleStyle.label,
    'Receiving-Driven'
  );

  assert.strictEqual(
    profileFor('Jahmyr Gibbs').roleStyle.label,
    'Balanced'
  );
});

test('roleStyle never leaks volume language into the label', () => {
  Object.keys(fixtures).forEach((name) => {
    const p = profileFor(name);

    assert.ok(
      !p.roleStyle.label.includes('/')
    );

    assert.ok(
      !/volume|role player/i.test(
        p.roleStyle.label
      )
    );
  });
});

test('real games with zero offensive opportunities remain distinct from rookie history', () => {
  const syntheticGames = [
    { week: 1, carries: 0, targets: 0, opportunities: 0 },
    { week: 2, carries: 0, targets: 0, opportunities: 0 },
    { week: 3, carries: 0, targets: 0, opportunities: 0 },
    { week: 4, carries: 0, targets: 0, opportunities: 0 },
  ];

  const record =
    oi.buildOpportunityIntelligence(
      syntheticGames,
      'WR'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.strictEqual(
    p.roleStyle.label,
    'No Recorded Offensive Touches'
  );

  assert.notStrictEqual(
    p.roleStyle.label,
    'No NFL History'
  );

  assert.strictEqual(
    p.evidence.gamesSampled,
    4
  );
});

// ─────────────────────────────────────────────────────────
// 7. 3 / 6 / 10 PERSISTENCE
// ─────────────────────────────────────────────────────────

function oppGames(values) {
  return values.map((opportunities, i) => ({
    week: i + 1,
    gameID: `PERSIST_${i + 1}`,
    carries: 0,
    targets: opportunities,
    opportunities,
  }));
}

test('persistence horizons require a complete window plus 3 prior baseline games', () => {
  const five =
    oi.buildOpportunityIntelligence(
      oppGames([10, 10, 10, 10, 10]),
      'WR'
    );

  assert.strictEqual(
    five.persistence.last3,
    null
  );

  assert.strictEqual(
    five.persistence.last6,
    null
  );

  assert.strictEqual(
    five.persistence.last10,
    null
  );

  const six =
    oi.buildOpportunityIntelligence(
      oppGames([10, 10, 10, 10, 10, 10]),
      'WR'
    );

  assert.ok(
    six.persistence.last3
  );

  assert.strictEqual(
    six.persistence.last6,
    null
  );

  const nine =
    oi.buildOpportunityIntelligence(
      oppGames([
        10, 10, 10,
        10, 10, 10,
        10, 10, 10,
      ]),
      'WR'
    );

  assert.ok(
    nine.persistence.last6
  );

  assert.strictEqual(
    nine.persistence.last10,
    null
  );

  const thirteen =
    oi.buildOpportunityIntelligence(
      oppGames([
        10, 10, 10,
        10, 10, 10,
        10, 10, 10,
        10, 10, 10,
        10,
      ]),
      'WR'
    );

  assert.ok(
    thirteen.persistence.last10
  );
});

test('high-volume short-term decline becomes Softening Role', () => {
  const record =
    oi.buildOpportunityIntelligence(
      oppGames([
        10, 10, 10,
        10, 10, 10,
        13, 13, 13,
        10, 10, 10,
      ]),
      'WR'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.strictEqual(
    p.workload.level,
    'High Volume'
  );

  assert.strictEqual(
    p.roleDirection.label,
    'Softening Role'
  );
});

test('3+6 confirmed material decline becomes Decreasing Role', () => {
  const record =
    oi.buildOpportunityIntelligence(
      oppGames([
        15, 15, 15,
        12, 12, 12,
        9, 9, 9,
      ]),
      'WR'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.strictEqual(
    p.workload.level,
    'High Volume'
  );

  assert.strictEqual(
    p.roleDirection.label,
    'Decreasing Role'
  );
});

test('3+6+10 confirmed material decline becomes Sustained Decline', () => {
  const record =
    oi.buildOpportunityIntelligence(
      oppGames([
        15, 15, 15,
        14, 14, 14,
        14,
        12, 12, 12,
        9, 9, 9,
      ]),
      'WR'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.strictEqual(
    p.workload.level,
    'High Volume'
  );

  assert.strictEqual(
    p.roleDirection.label,
    'Sustained Decline'
  );
});

test('High Volume to Moderate Volume crossing is not protected as Softening Role', () => {
  const record =
    oi.buildOpportunityIntelligence(
      oppGames([
        12, 12, 12,
        12, 12, 12,
        10, 10, 10,
        7, 7, 7,
      ]),
      'WR'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.strictEqual(
    p.workload.level,
    'Moderate Volume'
  );

  assert.strictEqual(
    p.roleDirection.label,
    'Decreasing Role'
  );
});

test('non-elite declining workload gets no high-volume Softening protection', () => {
  const values = [
    14, 14, 14,
    14, 14, 14,
    12, 12, 12,
    8, 8, 8,
  ];

  const record =
    oi.buildOpportunityIntelligence(
      values.map(
        (opportunities, i) => ({
          week: i + 1,
          gameID: `RB_${i + 1}`,
          carries: opportunities,
          targets: 0,
          opportunities,
        })
      ),
      'RB'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.notStrictEqual(
    p.workload.level,
    'High Volume'
  );

  assert.strictEqual(
    p.roleDirection.label,
    'Decreasing Role'
  );
});

test('live Chase-style workload becomes High Volume + Softening Role', () => {
  const chaseOpportunities = [
    5, 16, 7, 8,
    10, 13, 23, 19,
    8, 10, 14, 9,
    16, 11, 9, 10,
  ];

  const record =
    oi.buildOpportunityIntelligence(
      oppGames(
        chaseOpportunities
      ),
      'WR'
    );

  const p =
    profileLib.buildDraftOpportunityProfile(
      record
    );

  assert.strictEqual(
    p.workload.level,
    'High Volume'
  );

  assert.strictEqual(
    p.roleDirection.label,
    'Softening Role'
  );

  assert.strictEqual(
    record.persistence.last3.recentAvg,
    10
  );

  assert.strictEqual(
    record.persistence.last6.recentAvg,
    11.5
  );
});

test('writer normalization treats straight, left-curly, and right-curly apostrophes identically', () => {
  const variants = [
    "Ja'Marr Chase",
    "Ja‘Marr Chase",
    "Ja’Marr Chase",
  ];

  const keys =
    variants.map(
      (name) =>
        oi.normalizePlayerName(
          name
        )
    );

  assert.deepStrictEqual(
    keys,
    [
      'jamarr chase',
      'jamarr chase',
      'jamarr chase',
    ]
  );
});

// ─────────────────────────────────────────────────────────
// 8. PRESERVATION
// ─────────────────────────────────────────────────────────

test('workload seasonAvg remains byte-identical to source Opportunity data', () => {
  Object.keys(fixtures).forEach((name) => {
    const record = recordFor(name);

    const p =
      profileLib.buildDraftOpportunityProfile(
        record
      );

    assert.strictEqual(
      p.workload.seasonAvg,
      record.opportunities.seasonAvg,
      name
    );
  });
});

test('evidence gamesSampled remains byte-identical to source Opportunity data', () => {
  Object.keys(fixtures).forEach((name) => {
    const record = recordFor(name);

    const p =
      profileLib.buildDraftOpportunityProfile(
        record
      );

    assert.strictEqual(
      p.evidence.gamesSampled,
      record.opportunities.gamesSampled,
      name
    );
  });
});

test('recentBasis preserves avgLast5 -> avgLast3 -> lastGame cascade', () => {
  assert.deepStrictEqual(
    profileLib.recentBasis({
      avgLast5: 10,
      avgLast3: 8,
      lastGame: 5,
    }),
    {
      value: 10,
      window: 'avgLast5',
    }
  );

  assert.deepStrictEqual(
    profileLib.recentBasis({
      avgLast5: null,
      avgLast3: 8,
      lastGame: 5,
    }),
    {
      value: 8,
      window: 'avgLast3',
    }
  );

  assert.deepStrictEqual(
    profileLib.recentBasis({
      avgLast5: null,
      avgLast3: null,
      lastGame: 5,
    }),
    {
      value: 5,
      window: 'lastGame',
    }
  );

  assert.strictEqual(
    profileLib.recentBasis({
      avgLast5: null,
      avgLast3: null,
      lastGame: null,
    }),
    null
  );
});

test('buildDraftOpportunityProfile remains read-only and never mutates input', () => {
  const record =
    recordFor('Bijan Robinson');

  const snapshot =
    JSON.parse(
      JSON.stringify(
        record
      )
    );

  profileLib.buildDraftOpportunityProfile(
    record
  );

  assert.deepStrictEqual(
    record,
    snapshot
  );
});

console.log(
  '\n' +
  passed +
  ' passed, ' +
  failed +
  ' failed (' +
  (passed + failed) +
  ' total)'
);

if (failed) {
  console.log('\nFAILURES:');

  failures.forEach(
    (f) =>
      console.log(
        '  - ' + f
      )
  );

  process.exit(1);
}
