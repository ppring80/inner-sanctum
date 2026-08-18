const {
  buildRecommendation,
  isStrongOpportunity,
  isWeakOpportunity,
  isOpportunityCaution
} = require(
  '../netlify/functions/draft-sage-synthesis'
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

function op(
  workload,
  direction = 'Stable Role',
  evidence = 'Established',
  style = 'Balanced'
) {
  return {
    workload: {
      label:
        workload
    },

    roleDirection: {
      label:
        direction
    },

    roleStyle: {
      label:
        style
    },

    evidence: {
      label:
        evidence
    }
  };
}

function market(
  value,
  outlook
) {
  return {
    marketValue: {
      label:
        value
    },

    returnOutlook: {
      label:
        outlook
    }
  };
}

function scarcity(cost) {
  return {
    costOfWaiting: {
      label:
        cost
    }
  };
}

function context(
  environment = 'Neutral',
  role = 'Similar',
  rookie = 'Not Applicable',
  confidence = 'Moderate'
) {
  return {
    environmentChange: {
      label:
        environment
    },

    roleOpportunity: {
      label:
        role
    },

    rookieImpact: {
      label:
        rookie
    },

    contextConfidence: {
      label:
        confidence
    }
  };
}

let r;

// ---------------------------------------
// 1. Strong opportunity + timing pressure
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
        'Stable Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Leans Gone'
      ),

    scarcityProfile:
      scarcity(
        'Moderate'
      ),

    contextProfile:
      context()
  });

eq(
  'strong + timing pressure => Take Now',
  r.recommendation,
  'Take Now'
);

// ---------------------------------------
// 2. Strong opportunity + room to wait
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
        'Stable Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context()
  });

eq(
  'strong + wait room => Can Wait',
  r.recommendation,
  'Can Wait'
);

// ---------------------------------------
// 3. High scarcity can force action
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
        'Stable Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'High'
      ),

    contextProfile:
      context()
  });

eq(
  'strong + high scarcity => Take Now',
  r.recommendation,
  'Take Now'
);

// ---------------------------------------
// 4. KEY FIX:
//    Decreasing != weak
// ---------------------------------------

const decliningHigh =
  {
    workload:
      'High Volume',

    direction:
      'Decreasing Role',

    style:
      'Receiving-Driven',

    evidence:
      'Established'
  };

check(
  'high-volume declining is NOT weak',
  !isWeakOpportunity(
    decliningHigh
  )
);

check(
  'high-volume declining IS caution',
  isOpportunityCaution(
    decliningHigh
  )
);

// ---------------------------------------
// 5. A.J. Brown-type case
//
// Historical signal:
//   moderate-volume + declining
//
// Context:
//   new environment positive,
//   role expected similar,
//   strong confidence.
//
// This must NOT produce Pass For Now.
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'Moderate Volume',
        'Decreasing Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Leans Gone'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context(
        'Positive',
        'Similar',
        'Not Applicable',
        'Strong'
      )
  });

eq(
  'AJ-type context restores strong consideration',
  r.recommendation,
  'Strong Consideration'
);

check(
  'AJ-type result is not pass',
  r.recommendation !==
    'Pass For Now'
);

// ---------------------------------------
// 6. Declining role without positive
//    context + timing pressure
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'Moderate Volume',
        'Decreasing Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Leans Gone'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context(
        'Neutral',
        'Similar',
        'Not Applicable',
        'Moderate'
      )
  });

eq(
  'declining + timing pressure => Consider Now',
  r.recommendation,
  'Consider Now'
);

// ---------------------------------------
// 7. Declining + negative context
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'Moderate Volume',
        'Decreasing Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context(
        'Negative',
        'Reduced',
        'Not Applicable',
        'Strong'
      )
  });

eq(
  'declining + negative context + wait room => Wait',
  r.recommendation,
  'Wait'
);

// ---------------------------------------
// 8. True weak profile can still wait
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'Role Player',
        'Stable Role'
      ),

    marketProfile:
      market(
        'Ahead of Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context()
  });

eq(
  'role player + wait room => Wait',
  r.recommendation,
  'Wait'
);

// ---------------------------------------
// 9. True weak + overpriced
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'Role Player',
        'Stable Role'
      ),

    marketProfile:
      market(
        'Ahead of Market',
        'No Next-Pick Read'
      ),

    scarcityProfile:
      scarcity(
        'Moderate'
      ),

    contextProfile:
      context()
  });

eq(
  'role player + ahead market => Pass For Now',
  r.recommendation,
  'Pass For Now'
);

// ---------------------------------------
// 10. High-impact rookie
//
// No NFL history,
// but strong Context + timing pressure.
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'No NFL History',
        'No NFL History',
        'No NFL History'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Leans Gone'
      ),

    scarcityProfile:
      scarcity(
        'Moderate'
      ),

    contextProfile:
      context(
        'Positive',
        'Improved',
        'High',
        'Strong'
      )
  });

eq(
  'high-impact rookie => Strong Consideration',
  r.recommendation,
  'Strong Consideration'
);

// ---------------------------------------
// 11. Rookie with meaningful context
//     but lower timing pressure
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'No NFL History',
        'No NFL History',
        'No NFL History'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context(
        'Neutral',
        'Improved',
        'Moderate',
        'Moderate'
      )
  });

eq(
  'moderate-impact rookie => Consider',
  r.recommendation,
  'Consider'
);

// ---------------------------------------
// 12. Rookie without real support
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'No NFL History',
        'No NFL History',
        'No NFL History'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context(
        'Uncertain',
        'Uncertain',
        'Developmental',
        'Limited'
      )
  });

eq(
  'unsupported rookie => Needs More Evidence',
  r.recommendation,
  'Needs More Evidence'
);

// ---------------------------------------
// 13. Strong Opportunity + negative
//     context should lose conviction
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
        'Stable Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Leans Gone'
      ),

    scarcityProfile:
      scarcity(
        'High'
      ),

    contextProfile:
      context(
        'Negative',
        'Reduced',
        'Not Applicable',
        'Strong'
      )
  });

eq(
  'strong history + negative context => Strong Consideration',
  r.recommendation,
  'Strong Consideration'
);

// ---------------------------------------
// 14. Mixed player + positive context
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'Moderate Volume',
        'Stable Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context(
        'Positive',
        'Improved',
        'Not Applicable',
        'Strong'
      )
  });

eq(
  'mixed history + positive context => Consider',
  r.recommendation,
  'Consider'
);

// ---------------------------------------
// 15. Limited opportunity evidence,
//     no context rescue
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'Moderate Volume',
        'Not Enough Data Yet',
        'Limited'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      ),

    contextProfile:
      context(
        'Neutral',
        'Uncertain',
        'Not Applicable',
        'Limited'
      )
  });

eq(
  'limited evidence without context => Needs More Evidence',
  r.recommendation,
  'Needs More Evidence'
);

// ---------------------------------------
// 16. Moderate workload + timing pressure
// ---------------------------------------

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'Moderate Volume',
        'Stable Role'
      ),

    marketProfile:
      market(
        'At Market',
        'Market Leans Gone'
      ),

    scarcityProfile:
      scarcity(
        'Moderate'
      ),

    contextProfile:
      context()
  });

eq(
  'moderate + timing pressure => Consider Now',
  r.recommendation,
  'Consider Now'
);

// ---------------------------------------
// 17. 3 / 6 / 10 role-direction vocabulary
// ---------------------------------------

const softeningHigh = {
  workload: 'High Volume',
  direction: 'Softening Role',
  style: 'Receiving-Driven',
  evidence: 'Established'
};

check(
  'high-volume Softening Role remains strong Opportunity',
  isStrongOpportunity(softeningHigh)
);

check(
  'high-volume Softening Role is not caution',
  !isOpportunityCaution(softeningHigh)
);

r = buildRecommendation({
  opportunityProfile:
    op(
      'High Volume',
      'Softening Role'
    ),

  marketProfile:
    market(
      'At Market',
      'Market Leans Gone'
    ),

  scarcityProfile:
    scarcity(
      'Moderate'
    ),

  contextProfile:
    context()
});

eq(
  'high-volume softening + timing pressure => Take Now',
  r.recommendation,
  'Take Now'
);

check(
  'Softening Take Now retains plain-language caution reason',
  r.reasons.includes(
    'recent role has softened but volume remains strong'
  )
);

const sustainedHigh = {
  workload: 'High Volume',
  direction: 'Sustained Decline',
  style: 'Receiving-Driven',
  evidence: 'Established'
};

check(
  'high-volume Sustained Decline is caution',
  isOpportunityCaution(
    sustainedHigh
  )
);

check(
  'high-volume Sustained Decline is not strong',
  !isStrongOpportunity(
    sustainedHigh
  )
);

r = buildRecommendation({
  opportunityProfile:
    op(
      'High Volume',
      'Sustained Decline'
    ),

  marketProfile:
    market(
      'At Market',
      'Market Leans Gone'
    ),

  scarcityProfile:
    scarcity(
      'Moderate'
    ),

  contextProfile:
    context()
});

eq(
  'sustained decline + timing pressure => Consider Now',
  r.recommendation,
  'Consider Now'
);

check(
  'Sustained Decline reason communicates persistence',
  r.reasons.includes(
    'role decline has persisted across longer windows'
  )
);

r = buildRecommendation({
  opportunityProfile:
    op(
      'Moderate Volume',
      'Softening Role'
    ),

  marketProfile:
    market(
      'At Market',
      'Market Leans Gone'
    ),

  scarcityProfile:
    scarcity(
      'Moderate'
    ),

  contextProfile:
    context()
});

check(
  'Moderate Volume + Softening Role never becomes Take Now through strong-opportunity path',
  r.recommendation !==
    'Take Now'
);

// ---------------------------------------
// 18. No hidden score
// ---------------------------------------

check(
  'no hidden score field',
  !Object.prototype.hasOwnProperty.call(
    r,
    'score'
  )
);

// ---------------------------------------
// 19. Context retained in evidence
// ---------------------------------------

check(
  'context evidence returned',
  r.evidence &&
  r.evidence.context &&
  r.evidence.context.confidence ===
    'Moderate'
);

// ---------------------------------------
// 20. Plain-language reasons
// ---------------------------------------

check(
  'reasons array exists',
  Array.isArray(
    r.reasons
  )
);

// ---------------------------------------
// 21. Pure / non-mutating
// ---------------------------------------

const input = {
  opportunityProfile:
    op(
      'High Volume',
      'Stable Role'
    ),

  marketProfile:
    market(
      'At Market',
      'Market Leans Gone'
    ),

  scarcityProfile:
    scarcity(
      'Moderate'
    ),

  contextProfile:
    context(
      'Positive',
      'Improved',
      'Not Applicable',
      'Strong'
    )
};

const before =
  JSON.stringify(
    input
  );

buildRecommendation(
  input
);

eq(
  'pure/non-mutating',
  JSON.stringify(
    input
  ),
  before
);

console.log(
  `draft-sage-synthesis.test.js: ${passed}/${passed + failed} passed`
);

if (
  failures.length
) {
  failures.forEach(
    (failure) =>
      console.error(
        'FAIL:',
        failure
      )
  );

  process.exit(1);
}
