const {
  buildRecommendation
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

let r;

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
        'Stable Role'
      ),

    marketProfile:
      market(
        'Ahead of Market',
        'Market Leans Gone'
      ),

    scarcityProfile:
      scarcity(
        'Moderate'
      )
  });

eq(
  'strong + market gone => Take Now',
  r.recommendation,
  'Take Now'
);

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
        'Increasing Role'
      ),

    marketProfile:
      market(
        'Discount',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      )
  });

eq(
  'strong + discount => Take Now',
  r.recommendation,
  'Take Now'
);

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
      )
  });

eq(
  'strong + wait room => Can Wait',
  r.recommendation,
  'Can Wait'
);

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
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
      )
  });

eq(
  'strong + mixed timing => Strong Consideration',
  r.recommendation,
  'Strong Consideration'
);

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
      )
  });

eq(
  'weak + can wait => Wait',
  r.recommendation,
  'Wait'
);

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
      )
  });

eq(
  'weak + ahead of market => Pass For Now',
  r.recommendation,
  'Pass For Now'
);

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
        'Low'
      )
  });

eq(
  'moderate opportunity + market pressure => Consider Now',
  r.recommendation,
  'Consider Now'
);

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
      )
  });

eq(
  'mixed/no force => Flexible',
  r.recommendation,
  'Flexible'
);

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
      )
  });

eq(
  'limited evidence => Needs More Evidence',
  r.recommendation,
  'Needs More Evidence'
);

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
        'Stable Role',
        'Established'
      ),

    marketProfile:
      market(
        'Market Value Unknown',
        'Return Outlook Unknown'
      ),

    scarcityProfile:
      scarcity(
        'Unknown'
      )
  });

eq(
  'strong opportunity survives unknown timing evidence',
  r.recommendation,
  'Strong Consideration'
);

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
      )
  });

eq(
  'high scarcity overrides wait room => Take Now',
  r.recommendation,
  'Take Now'
);

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
        'High'
      )
  });

eq(
  'moderate opportunity + high scarcity => Consider Now',
  r.recommendation,
  'Consider Now'
);

r =
  buildRecommendation({
    opportunityProfile:
      op(
        'High Volume',
        'Decreasing Role'
      ),

    marketProfile:
      market(
        'Ahead of Market',
        'Market Says He May Return'
      ),

    scarcityProfile:
      scarcity(
        'Low'
      )
  });

eq(
  'declining role + wait room => Wait',
  r.recommendation,
  'Wait'
);

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
        'Uncertain'
      )
  });

eq(
  'strong + uncertain scarcity => Strong Consideration',
  r.recommendation,
  'Strong Consideration'
);

check(
  'reasons are plain-language array',
  Array.isArray(
    r.reasons
  )
);

check(
  'no hidden score field',
  !Object.prototype.hasOwnProperty.call(
    r,
    'score'
  )
);

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
