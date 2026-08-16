const {
  normalizeEvidence,
  environmentChange,
  roleOpportunity,
  rookieImpact,
  contextConfidence,
  buildDraftContextProfile
} = require(
  '../netlify/functions/draft-context-profile'
);

let passed = 0;
let failed = 0;

const failures = [];

function check(
  name,
  condition
) {
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

// ---------------------------------------
// 1. Veteran control:
//    no material contextual change
// ---------------------------------------

let r =
  buildDraftContextProfile({
    longName:
      'Veteran Control',

    pos:
      'WR'
  });

eq(
  'veteran control environment neutral',
  r.environmentChange.label,
  'Neutral'
);

eq(
  'veteran control rookie N/A',
  r.rookieImpact.label,
  'Not Applicable'
);

eq(
  'veteran control confidence limited',
  r.contextConfidence.label,
  'Limited'
);

// ---------------------------------------
// 2. A.J. Brown-type case:
//    new team + favorable environment
// ---------------------------------------

r =
  buildDraftContextProfile({
    longName:
      'A.J. Brown',

    pos:
      'WR',

    evidence: {
      changedTeam:
        true,

      quarterbackChange:
        true,

      environmentDirection:
        'positive',

      roleDirection:
        'similar',

      notes: [
        'Expected featured receiving role'
      ]
    }
  });

eq(
  'new-team veteran environment positive',
  r.environmentChange.label,
  'Positive'
);

eq(
  'new-team veteran role similar',
  r.roleOpportunity.label,
  'Similar'
);

eq(
  'new-team veteran confidence strong',
  r.contextConfidence.label,
  'Strong'
);

check(
  'new-team reason retained',
  r.reasons.includes(
    'changed teams'
  )
);

// ---------------------------------------
// 3. Jeanty-type case:
//    coaching/scheme change
// ---------------------------------------

r =
  buildDraftContextProfile({
    longName:
      'Scheme Change RB',

    pos:
      'RB',

    evidence: {
      coachingChange:
        true,

      environmentDirection:
        'positive',

      roleDirection:
        'improved',

      receivingProfile:
        'strong'
    }
  });

eq(
  'scheme-change environment positive',
  r.environmentChange.label,
  'Positive'
);

eq(
  'scheme-change role improved',
  r.roleOpportunity.label,
  'Improved'
);

eq(
  'scheme-change veteran rookie N/A',
  r.rookieImpact.label,
  'Not Applicable'
);

eq(
  'scheme-change confidence strong',
  r.contextConfidence.label,
  'Strong'
);

// ---------------------------------------
// 4. High-impact rookie:
//    no NFL history, but strong context
// ---------------------------------------

r =
  buildDraftContextProfile({
    longName:
      'High Impact Rookie',

    pos:
      'RB',

    evidence: {
      isRookie:
        true,

      prospectTier:
        'elite',

      draftCapitalTier:
        'premium',

      roleDirection:
        'improved',

      environmentDirection:
        'positive'
    }
  });

eq(
  'elite rookie impact high',
  r.rookieImpact.label,
  'High'
);

eq(
  'elite rookie role improved',
  r.roleOpportunity.label,
  'Improved'
);

eq(
  'elite rookie confidence strong',
  r.contextConfidence.label,
  'Strong'
);

// ---------------------------------------
// 5. Moderate-impact rookie
// ---------------------------------------

r =
  buildDraftContextProfile({
    longName:
      'Moderate Rookie',

    pos:
      'RB',

    evidence: {
      isRookie:
        true,

      prospectTier:
        'strong',

      roleDirection:
        'uncertain'
    }
  });

eq(
  'strong prospect rookie impact moderate',
  r.rookieImpact.label,
  'Moderate'
);

eq(
  'uncertain rookie role remains uncertain',
  r.roleOpportunity.label,
  'Uncertain'
);

eq(
  'moderate rookie confidence moderate',
  r.contextConfidence.label,
  'Moderate'
);

// ---------------------------------------
// 6. Developmental rookie
// ---------------------------------------

r =
  buildDraftContextProfile({
    longName:
      'Developmental Rookie',

    pos:
      'WR',

    evidence: {
      isRookie:
        true
    }
  });

eq(
  'rookie with no strong evidence developmental',
  r.rookieImpact.label,
  'Developmental'
);

eq(
  'rookie with no evidence confidence limited',
  r.contextConfidence.label,
  'Limited'
);

// ---------------------------------------
// 7. Negative environment / reduced role
// ---------------------------------------

r =
  buildDraftContextProfile({
    longName:
      'Reduced Role Veteran',

    pos:
      'RB',

    evidence: {
      environmentDirection:
        'negative',

      roleDirection:
        'reduced',

      depthChartChange:
        'reduced'
    }
  });

eq(
  'negative environment preserved',
  r.environmentChange.label,
  'Negative'
);

eq(
  'reduced role preserved',
  r.roleOpportunity.label,
  'Reduced'
);

eq(
  'negative/reduced confidence strong',
  r.contextConfidence.label,
  'Strong'
);

// ---------------------------------------
// 8. Changed team without directional
//    evidence must NOT be guessed
// ---------------------------------------

r =
  buildDraftContextProfile({
    longName:
      'Unknown Transition',

    pos:
      'WR',

    evidence: {
      changedTeam:
        true
    }
  });

eq(
  'team change without direction is uncertain',
  r.environmentChange.label,
  'Uncertain'
);

eq(
  'team change alone role uncertain',
  r.roleOpportunity.label,
  'Uncertain'
);

// ---------------------------------------
// 9. Offensive line change alone:
//    change exists, direction unknown
// ---------------------------------------

let e =
  normalizeEvidence({
    offensiveLineChange:
      'material'
  });

eq(
  'OL change without direction is uncertain',
  environmentChange(e),
  'Uncertain'
);

// ---------------------------------------
// 10. Explicit role direction wins over
//     secondary role clues
// ---------------------------------------

e =
  normalizeEvidence({
    roleDirection:
      'similar',

    depthChartChange:
      'improved'
  });

eq(
  'explicit role direction wins',
  roleOpportunity(e),
  'Similar'
);

// ---------------------------------------
// 11. Premium draft capital alone
// ---------------------------------------

e =
  normalizeEvidence({
    isRookie:
      true,

    draftCapitalTier:
      'premium'
  });

eq(
  'premium draft capital => high rookie impact',
  rookieImpact(e),
  'High'
);

// ---------------------------------------
// 12. Day-one draft capital
// ---------------------------------------

e =
  normalizeEvidence({
    isRookie:
      true,

    draftCapitalTier:
      'day-one'
  });

eq(
  'day-one draft capital => moderate rookie impact',
  rookieImpact(e),
  'Moderate'
);

// ---------------------------------------
// 13. Confidence comes from evidence
//     breadth, not player identity
// ---------------------------------------

e =
  normalizeEvidence({
    environmentDirection:
      'positive',

    roleDirection:
      'improved'
  });

eq(
  'two evidence families => moderate confidence',
  contextConfidence(e),
  'Moderate'
);

// ---------------------------------------
// 14. Pure / non-mutating
// ---------------------------------------

const input = {
  longName:
    'Pure Test',

  pos:
    'RB',

  evidence: {
    isRookie:
      true,

    prospectTier:
      'elite',

    notes: [
      'note'
    ]
  }
};

const before =
  JSON.stringify(
    input
  );

buildDraftContextProfile(
  input
);

eq(
  'input not mutated',
  JSON.stringify(
    input
  ),
  before
);

// ---------------------------------------
// 15. No hidden numeric score
// ---------------------------------------

r =
  buildDraftContextProfile({
    longName:
      'No Score',

    pos:
      'WR',

    evidence: {
      environmentDirection:
        'positive',

      roleDirection:
        'improved'
    }
  });

check(
  'no score field',
  !Object.prototype.hasOwnProperty.call(
    r,
    'score'
  )
);

console.log(
  `draft-context-profile.test.js: ${passed}/${passed + failed} passed`
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
