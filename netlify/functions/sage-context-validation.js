// netlify/functions/sage-context-validation.js
//
// SAGE — CONTEXT DIRECTIONAL VALIDATION
//
// PHASE 2G — RELEASE GATE 1
//
// PURPOSE:
// Validate that production Context Intelligence influences SAGE
// in the intended direction without changing Opportunity,
// Market, or Scarcity inputs.
//
// For each player:
//
//   CONTROL RUN
//     Opportunity + Market + Scarcity + NO Context
//
//   CONTEXT RUN
//     SAME Opportunity + SAME Market + SAME Scarcity
//     + production Context profile
//
// The difference between those two SAGE outputs is attributable
// to Context.
//
// READ-ONLY.
// DOES NOT write Blobs.
// DOES NOT modify SAGE.
// DOES NOT modify Context.
//
// IMPORTANT:
// - ADP is read from context-intel/latest.
// - Veterans use real Opportunity Intelligence when available.
// - A rookie with no historical Opportunity record receives an
//   explicit "No NFL History" Opportunity profile.
// - No NFL production is fabricated.
// - High-value players who changed teams are restraint tests.
// - Phase 2G rookies are evidence-restraint tests:
//   objective rookie evidence may inform SAGE, but draft capital,
//   prospect evidence, receiving evidence, or landing spot must
//   NOT manufacture positive environment or role direction.
//
// PHASE 2G VALIDATION SET:
//
// Existing regression set:
//   A.J. Brown
//   Ashton Jeanty
//   Jeremiyah Love
//   Rachaad White
//   Jaylen Waddle
//   Kenneth Walker III
//   Chase Brown
//
// Phase 2G rookie expansion:
//   Carnell Tate
//   Jadarian Price
//   Jordyn Tyson
//   Makai Lemon
//   KC Concepcion
//
// RELEASE GATE 1 PASS CONDITION:
// - All validation players execute successfully.
// - All expected Context profiles validate.
// - All behavioral validations pass.
// - Phase 2G rookies use explicit No NFL History Opportunity.
// - Phase 2G rookie evidence retains blank environmentDirection
//   and roleDirection.
// - Phase 2G rookie Context resolves to Neutral environment and
//   Uncertain role.
// - Context may affect SAGE reasoning, but must not invent
//   directional NFL environment or role evidence.

const {
  getStore,
  connectLambda
} = require("@netlify/blobs");

const {
  buildDraftOpportunityProfile
} = require("./draft-opportunity-profile");

const {
  buildDraftMarketProfile
} = require("./draft-market-profile");

const {
  buildDraftScarcityProfile
} = require("./draft-scarcity-profile");

const {
  buildRecommendation
} = require("./draft-sage-synthesis");


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};


// ------------------------------------------------------------
// VALIDATION PLAYERS
// ------------------------------------------------------------

const VALIDATION_PLAYERS = [
  {
    name: "A.J. Brown",
    pos: "WR",
    archetype: "positive-environment",

    expectedContext: {
      environmentChange: "Positive",
      roleOpportunity: "Similar",
      rookieImpact: "Not Applicable",
      contextConfidence: "Strong"
    },

    expectedBehavior: "positive-support"
  },

  {
    name: "Ashton Jeanty",
    pos: "RB",
    archetype: "positive-role",

    expectedContext: {
      environmentChange: "Positive",
      roleOpportunity: "Improved",
      rookieImpact: "Not Applicable",
      contextConfidence: "Strong"
    },

    expectedBehavior: "positive-support"
  },

  {
    name: "Jeremiyah Love",
    pos: "RB",
    archetype: "high-impact-rookie",

    expectedContext: {
      environmentChange: "Neutral",
      roleOpportunity: "Uncertain",
      rookieImpact: "High",
      contextConfidence: "Strong"
    },

    expectedBehavior: "rookie-support"
  },

  {
    name: "Rachaad White",
    pos: "RB",
    archetype: "reduced-role",

    expectedContext: {
      environmentChange: "Neutral",
      roleOpportunity: "Reduced",
      rookieImpact: "Not Applicable",
      contextConfidence: "Strong"
    },

    expectedBehavior: "negative-support"
  },

  {
    name: "Jaylen Waddle",
    pos: "WR",
    archetype: "high-value-restraint-wr",

    expectedContext: {
      environmentChange: "Uncertain",
      roleOpportunity: "Similar",
      rookieImpact: "Not Applicable",
      contextConfidence: "Strong"
    },

    expectedBehavior: "restraint"
  },

  {
    name: "Kenneth Walker III",
    pos: "RB",
    archetype: "high-value-restraint-rb",

    expectedContext: {
      environmentChange: "Uncertain",
      roleOpportunity: "Similar",
      rookieImpact: "Not Applicable",
      contextConfidence: "Strong"
    },

    expectedBehavior: "restraint"
  },

  {
    name: "Chase Brown",
    pos: "RB",
    archetype: "baseline-control",

    expectedContext: null,

    expectedBehavior: "baseline-control"
  },

  {
    name: "Carnell Tate",
    pos: "WR",
    archetype: "phase-2g-premium-draft-capital-rookie",

    expectedContext: {
      environmentChange: "Neutral",
      roleOpportunity: "Uncertain",
      contextConfidence: "Strong"
    },

    expectedBehavior: "rookie-evidence-restraint"
  },

  {
    name: "Jadarian Price",
    pos: "RB",
    archetype: "phase-2g-day-one-draft-capital-rookie",

    expectedContext: {
      environmentChange: "Neutral",
      roleOpportunity: "Uncertain",
      contextConfidence: "Moderate"
    },

    expectedBehavior: "rookie-evidence-restraint"
  },

  {
    name: "Jordyn Tyson",
    pos: "WR",
    archetype: "phase-2g-premium-draft-capital-rookie",

    expectedContext: {
      environmentChange: "Neutral",
      roleOpportunity: "Uncertain",
      contextConfidence: "Strong"
    },

    expectedBehavior: "rookie-evidence-restraint"
  },

  {
    name: "Makai Lemon",
    pos: "WR",
    archetype: "phase-2g-day-one-draft-capital-rookie",

    expectedContext: {
      environmentChange: "Neutral",
      roleOpportunity: "Uncertain",
      contextConfidence: "Strong"
    },

    expectedBehavior: "rookie-evidence-restraint"
  },

  {
    name: "KC Concepcion",
    pos: "WR",
    archetype: "phase-2g-day-one-draft-capital-rookie",

    expectedContext: {
      environmentChange: "Neutral",
      roleOpportunity: "Uncertain",
      contextConfidence: "Strong"
    },

    expectedBehavior: "rookie-evidence-restraint"
  }
];


// ------------------------------------------------------------
// PLAYER IDENTITY
// ------------------------------------------------------------

function normalizePlayerName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.''']/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizePosition(pos) {
  return String(pos || "")
    .trim()
    .toUpperCase();
}


function playerKey(name, pos) {
  return (
    normalizePlayerName(name) +
    "|" +
    normalizePosition(pos)
  );
}


// ------------------------------------------------------------
// CACHE LOOKUPS
// ------------------------------------------------------------

function getOpportunityRecord(
  opportunityCache,
  player
) {
  const records =
    opportunityCache &&
    opportunityCache.records
      ? opportunityCache.records
      : {};

  return (
    records[
      playerKey(
        player.name,
        player.pos
      )
    ] ||
    null
  );
}


function getContextRecord(
  contextCache,
  player
) {
  const records =
    contextCache &&
    contextCache.records
      ? contextCache.records
      : {};

  return (
    records[
      playerKey(
        player.name,
        player.pos
      )
    ] ||
    null
  );
}


// ------------------------------------------------------------
// LABEL EXTRACTION
// ------------------------------------------------------------

function profileLabel(
  profile,
  field
) {
  if (
    !profile ||
    !profile[field]
  ) {
    return null;
  }

  if (
    typeof profile[field] ===
    "string"
  ) {
    return profile[field];
  }

  if (
    typeof profile[field].label ===
    "string"
  ) {
    return profile[field].label;
  }

  return null;
}


// ------------------------------------------------------------
// CONTEXT EXPECTATION CHECK
// ------------------------------------------------------------

function validateContextProfile(
  contextRecord,
  expected
) {
  if (!expected) {
    return {
      passed:
        (
          !contextRecord ||
          contextRecord.contextStatus !==
            "context-profiled"
        ),

      expected:
        "baseline-only",

      actualStatus:
        contextRecord
          ? contextRecord.contextStatus
          : "missing"
    };
  }

  if (
    !contextRecord ||
    contextRecord.contextStatus !==
      "context-profiled" ||
    !contextRecord.contextProfile
  ) {
    return {
      passed:
        false,

      expected:
        expected,

      actualStatus:
        contextRecord
          ? contextRecord.contextStatus
          : "missing"
    };
  }

  const profile =
    contextRecord.contextProfile;

  const actual = {
    environmentChange:
      profileLabel(
        profile,
        "environmentChange"
      ),

    roleOpportunity:
      profileLabel(
        profile,
        "roleOpportunity"
      ),

    rookieImpact:
      profileLabel(
        profile,
        "rookieImpact"
      ),

    contextConfidence:
      profileLabel(
        profile,
        "contextConfidence"
      )
  };

  const fields =
    Object.keys(expected);

  const mismatches =
    fields.filter(
      function(field) {
        return (
          actual[field] !==
          expected[field]
        );
      }
    );

  return {
    passed:
      mismatches.length === 0,

    expected:
      expected,

    actual:
      actual,

    validatedFields:
      fields,

    mismatches:
      mismatches
  };
}


// ------------------------------------------------------------
// ADP
// ------------------------------------------------------------

function getContextAdp(
  contextRecord
) {
  if (!contextRecord) {
    return null;
  }

  const value =
    Number(
      contextRecord.adp
    );

  return Number.isFinite(
    value
  )
    ? value
    : null;
}


// ------------------------------------------------------------
// ROOKIE / NO NFL HISTORY PROFILE
// ------------------------------------------------------------

function buildNoNFLHistoryOpportunityProfile(
  player
) {
  return {
    player: {
      playerID:
        player &&
        player.playerID
          ? player.playerID
          : null,

      longName:
        player &&
        player.longName
          ? player.longName
          : null,

      pos:
        player &&
        player.pos
          ? player.pos
          : null
    },

    workload: {
      level:
        "No NFL History"
    },

    roleDirection: {
      label:
        "No NFL History"
    },

    roleStyle: {
      label:
        "No NFL History"
    },

    evidence: {
      level:
        "Limited"
    }
  };
}


// ------------------------------------------------------------
// BUILD SHARED OPPORTUNITY PROFILE
// ------------------------------------------------------------

function buildSharedOpportunityProfile(
  opportunityRecord,
  contextRecord
) {
  if (opportunityRecord) {
    return {
      source:
        "production-opportunity",

      profile:
        buildDraftOpportunityProfile(
          opportunityRecord
        )
    };
  }

  if (
    contextRecord &&
    contextRecord.isRookie ===
      true
  ) {
    return {
      source:
        "explicit-no-nfl-history",

      profile:
        buildNoNFLHistoryOpportunityProfile(
          {
            playerID:
              contextRecord.playerID,

            longName:
              contextRecord.longName,

            pos:
              contextRecord.pos
          }
        )
    };
  }

  return {
    source:
      "missing",

    profile:
      null
  };
}


// ------------------------------------------------------------
// SCARCITY UNIVERSE
// ------------------------------------------------------------

function buildScarcityUniverse(
  opportunityCache,
  contextCache
) {
  const opportunityRecords =
    opportunityCache &&
    opportunityCache.records
      ? opportunityCache.records
      : {};

  const contextRecords =
    contextCache &&
    contextCache.records
      ? contextCache.records
      : {};

  const universe = [];

  Object.keys(
    contextRecords
  ).forEach(function(key) {
    const contextRecord =
      contextRecords[key];

    if (!contextRecord) {
      return;
    }

    const pos =
      normalizePosition(
        contextRecord.pos
      );

    if (
      ![
        "QB",
        "RB",
        "WR",
        "TE"
      ].includes(pos)
    ) {
      return;
    }

    const adp =
      getContextAdp(
        contextRecord
      );

    if (adp === null) {
      return;
    }

    const opportunityRecord =
      opportunityRecords[key] ||
      null;

    if (opportunityRecord) {
      universe.push(
        Object.assign(
          {},
          opportunityRecord,
          {
            adp:
              adp,

            longName:
              opportunityRecord.longName ||
              contextRecord.longName,

            pos:
              opportunityRecord.pos ||
              contextRecord.pos
          }
        )
      );

      return;
    }

    universe.push({
      playerID:
        contextRecord.playerID ||
        null,

      longName:
        contextRecord.longName,

      pos:
        contextRecord.pos,

      adp:
        adp,

      workload: {
        level:
          "No NFL History"
      },

      roleDirection: {
        label:
          "No NFL History"
      },

      evidence: {
        level:
          "Limited"
      }
    });
  });

  return universe
    .slice()
    .sort(function(a, b) {
      return (
        Number(a.adp) -
        Number(b.adp)
      );
    });
}


// ------------------------------------------------------------
// DIAGNOSTIC DRAFT STATE
// ------------------------------------------------------------

function buildDiagnosticDraftState(
  adp
) {
  if (
    !Number.isFinite(
      Number(adp)
    )
  ) {
    return null;
  }

  const numeric =
    Number(
      adp
    );

  const currentPick =
    Math.max(
      1,
      Math.round(
        numeric
      )
    );

  return {
    adp:
      numeric,

    currentPick:
      currentPick,

    nextUserPick:
      currentPick +
      24
  };
}


// ------------------------------------------------------------
// SCARCITY WINDOWS
// ------------------------------------------------------------

function buildScarcityPools(
  universe,
  state
) {
  if (
    !state ||
    !Array.isArray(
      universe
    )
  ) {
    return {
      currentPool:
        [],

      nextTurnPool:
        []
    };
  }

  const currentPool =
    universe.filter(
      function(record) {
        const adp =
          Number(
            record.adp
          );

        return (
          Number.isFinite(adp) &&
          adp >=
            (
              state.currentPick -
              6
            ) &&
          adp <=
            (
              state.currentPick +
              12
            )
        );
      }
    );

  const nextTurnPool =
    universe.filter(
      function(record) {
        const adp =
          Number(
            record.adp
          );

        return (
          Number.isFinite(adp) &&
          adp >=
            (
              state.nextUserPick -
              6
            ) &&
          adp <=
            (
              state.nextUserPick +
              12
            )
        );
      }
    );

  return {
    currentPool:
      currentPool,

    nextTurnPool:
      nextTurnPool
  };
}


// ------------------------------------------------------------
// CANDIDATE RECORD FOR SCARCITY
// ------------------------------------------------------------

function buildScarcityCandidate(
  opportunityRecord,
  contextRecord,
  adp
) {
  if (opportunityRecord) {
    return Object.assign(
      {},
      opportunityRecord,
      {
        adp:
          adp
      }
    );
  }

  return {
    playerID:
      contextRecord
        ? contextRecord.playerID
        : null,

    longName:
      contextRecord
        ? contextRecord.longName
        : null,

    pos:
      contextRecord
        ? contextRecord.pos
        : null,

    adp:
      adp,

    workload: {
      level:
        "No NFL History"
    },

    roleDirection: {
      label:
        "No NFL History"
    },

    evidence: {
      level:
        "Limited"
    }
  };
}


// ------------------------------------------------------------
// EVIDENCE HELPERS
// ------------------------------------------------------------

function getContextEvidence(
  contextRecord
) {
  if (
    !contextRecord ||
    typeof contextRecord !==
      "object"
  ) {
    return null;
  }

  if (
    contextRecord.evidence &&
    typeof contextRecord.evidence ===
      "object"
  ) {
    return contextRecord.evidence;
  }

  if (
    contextRecord.contextProfile &&
    contextRecord.contextProfile.evidence &&
    typeof contextRecord.contextProfile.evidence ===
      "object"
  ) {
    return contextRecord.contextProfile.evidence;
  }

  return null;
}


function isBlankDirection(
  value
) {
  return (
    value === undefined ||
    value === null ||
    String(value).trim() ===
      ""
  );
}


// ------------------------------------------------------------
// BEHAVIOR VALIDATION
// ------------------------------------------------------------

function validateBehavior(
  player,
  contextRecord,
  controlSage,
  contextSage,
  opportunitySource
) {
  const behavior =
    player.expectedBehavior;

  if (
    behavior ===
      "baseline-control"
  ) {
    const unchanged =
      (
        controlSage.code ===
          contextSage.code &&

        controlSage.explanation ===
          contextSage.explanation &&

        JSON.stringify(
          controlSage.reasons
        ) ===
        JSON.stringify(
          contextSage.reasons
        )
      );

    return {
      passed:
        unchanged,

      expectation:
        "No Context profile should leave SAGE unchanged.",

      checks: {
        unchanged:
          unchanged
      }
    };
  }

  if (
    behavior ===
      "positive-support"
  ) {
    const positiveSignalPresent =
      (
        contextRecord &&
        contextRecord.contextProfile &&
        (
          profileLabel(
            contextRecord.contextProfile,
            "environmentChange"
          ) ===
            "Positive" ||

          profileLabel(
            contextRecord.contextProfile,
            "roleOpportunity"
          ) ===
            "Improved"
        )
      );

    const contextVisible =
      (
        JSON.stringify(
          contextSage.reasons
        ) !==
        JSON.stringify(
          controlSage.reasons
        ) ||

        contextSage.code !==
          controlSage.code
      );

    return {
      passed:
        (
          positiveSignalPresent &&
          contextVisible
        ),

      expectation:
        "Positive Context should be visible in SAGE reasoning or recommendation.",

      checks: {
        positiveSignalPresent:
          positiveSignalPresent,

        contextVisible:
          contextVisible
      }
    };
  }

  if (
    behavior ===
      "rookie-support"
  ) {
    const rookieHigh =
      (
        contextRecord &&
        contextRecord.contextProfile &&
        profileLabel(
          contextRecord.contextProfile,
          "rookieImpact"
        ) ===
          "High"
      );

    const contextRaisesSupport =
      (
        contextSage.code !==
          controlSage.code ||
        contextSage.explanation !==
          controlSage.explanation
      );

    return {
      passed:
        (
          rookieHigh &&
          contextRaisesSupport
        ),

      expectation:
        "High rookie Context should provide legitimate support despite no NFL history.",

      checks: {
        rookieHigh:
          rookieHigh,

        contextRaisesSupport:
          contextRaisesSupport
      }
    };
  }

  if (
    behavior ===
      "rookie-evidence-restraint"
  ) {
    const evidence =
      getContextEvidence(
        contextRecord
      );

    const isRookie =
      (
        contextRecord &&
        contextRecord.isRookie ===
          true
      );

    const noNFLHistory =
      opportunitySource ===
        "explicit-no-nfl-history";

    const environment =
      contextRecord &&
      contextRecord.contextProfile
        ? profileLabel(
            contextRecord.contextProfile,
            "environmentChange"
          )
        : null;

    const role =
      contextRecord &&
      contextRecord.contextProfile
        ? profileLabel(
            contextRecord.contextProfile,
            "roleOpportunity"
          )
        : null;

    const rookieImpact =
      contextRecord &&
      contextRecord.contextProfile
        ? profileLabel(
            contextRecord.contextProfile,
            "rookieImpact"
          )
        : null;

    const neutralEnvironment =
      environment ===
        "Neutral";

    const uncertainRole =
      role ===
        "Uncertain";

    const rookieImpactPresent =
      (
        rookieImpact &&
        rookieImpact !==
          "Not Applicable"
      );

    const blankEnvironmentDirection =
      (
        evidence &&
        isBlankDirection(
          evidence.environmentDirection
        )
      );

    const blankRoleDirection =
      (
        evidence &&
        isBlankDirection(
          evidence.roleDirection
        )
      );

    const noManufacturedDirection =
      (
        neutralEnvironment &&
        uncertainRole &&
        blankEnvironmentDirection &&
        blankRoleDirection
      );

    const contextVisible =
      (
        contextSage.code !==
          controlSage.code ||

        contextSage.explanation !==
          controlSage.explanation ||

        JSON.stringify(
          contextSage.reasons
        ) !==
        JSON.stringify(
          controlSage.reasons
        )
      );

    const passed =
      (
        isRookie &&
        noNFLHistory &&
        rookieImpactPresent &&
        noManufacturedDirection &&
        contextVisible
      );

    return {
      passed:
        passed,

      expectation:
        "Reviewed rookie evidence may inform SAGE, but must use No NFL History and must not manufacture positive environment or role direction.",

      checks: {
        isRookie:
          isRookie,

        opportunitySource:
          opportunitySource,

        noNFLHistory:
          noNFLHistory,

        environmentChange:
          environment,

        neutralEnvironment:
          neutralEnvironment,

        roleOpportunity:
          role,

        uncertainRole:
          uncertainRole,

        rookieImpact:
          rookieImpact,

        rookieImpactPresent:
          !!rookieImpactPresent,

        evidenceEnvironmentDirection:
          evidence
            ? evidence.environmentDirection
            : null,

        blankEnvironmentDirection:
          !!blankEnvironmentDirection,

        evidenceRoleDirection:
          evidence
            ? evidence.roleDirection
            : null,

        blankRoleDirection:
          !!blankRoleDirection,

        noManufacturedDirection:
          noManufacturedDirection,

        contextVisible:
          contextVisible
      }
    };
  }

  if (
    behavior ===
      "negative-support"
  ) {
    const reducedRole =
      (
        contextRecord &&
        contextRecord.contextProfile &&
        profileLabel(
          contextRecord.contextProfile,
          "roleOpportunity"
        ) ===
          "Reduced"
      );

    const negativeVisible =
      (
        JSON.stringify(
          contextSage.reasons
        ) !==
        JSON.stringify(
          controlSage.reasons
        )
      );

    return {
      passed:
        (
          reducedRole &&
          negativeVisible
        ),

      expectation:
        "Reduced-role Context should be visible in SAGE reasoning without requiring a forced downgrade.",

      checks: {
        reducedRole:
          reducedRole,

        negativeVisible:
          negativeVisible
      }
    };
  }

  if (
    behavior ===
      "restraint"
  ) {
    const environment =
      contextRecord &&
      contextRecord.contextProfile
        ? profileLabel(
            contextRecord.contextProfile,
            "environmentChange"
          )
        : null;

    const role =
      contextRecord &&
      contextRecord.contextProfile
        ? profileLabel(
            contextRecord.contextProfile,
            "roleOpportunity"
          )
        : null;

    const noDirectionalBoost =
      (
        environment ===
          "Uncertain" &&
        role ===
          "Similar"
      );

    return {
      passed:
        noDirectionalBoost,

      expectation:
        "Material team change should remain non-directional unless evidence proves improvement or decline.",

      checks: {
        environmentChange:
          environment,

        roleOpportunity:
          role,

        noDirectionalBoost:
          noDirectionalBoost
      }
    };
  }

  return {
    passed:
      false,

    expectation:
      "Unknown validation behavior."
  };
}


// ------------------------------------------------------------
// ONE PLAYER — CONTROL vs CONTEXT
// ------------------------------------------------------------

function buildPlayerTest(
  opportunityCache,
  contextCache,
  universe,
  player
) {
  const contextRecord =
    getContextRecord(
      contextCache,
      player
    );

  const contextValidation =
    validateContextProfile(
      contextRecord,
      player.expectedContext
    );

  if (!contextRecord) {
    return {
      player:
        player,

      status:
        "missing-context-record",

      contextValidation:
        contextValidation,

      behaviorValidation:
        {
          passed:
            false,

          expectation:
            "Context record missing."
        },

      control:
        null,

      withContext:
        null
    };
  }

  const adp =
    getContextAdp(
      contextRecord
    );

  if (adp === null) {
    return {
      player:
        player,

      status:
        "missing-adp",

      contextValidation:
        contextValidation,

      behaviorValidation:
        {
          passed:
            false,

          expectation:
            "ADP missing."
        },

      control:
        null,

      withContext:
        null
    };
  }

  const opportunityRecord =
    getOpportunityRecord(
      opportunityCache,
      player
    );

  const opportunityResult =
    buildSharedOpportunityProfile(
      opportunityRecord,
      contextRecord
    );

  if (!opportunityResult.profile) {
    return {
      player:
        player,

      status:
        "missing-opportunity-and-not-rookie",

      contextValidation:
        contextValidation,

      behaviorValidation:
        {
          passed:
            false,

          expectation:
            "No Opportunity profile available."
        },

      control:
        null,

      withContext:
        null
    };
  }

  const state =
    buildDiagnosticDraftState(
      adp
    );

  const opportunityProfile =
    opportunityResult.profile;

  const marketProfile =
    buildDraftMarketProfile({
      adp:
        state.adp,

      currentPick:
        state.currentPick,

      nextUserPick:
        state.nextUserPick
    });

  const pools =
    buildScarcityPools(
      universe,
      state
    );

  const candidate =
    buildScarcityCandidate(
      opportunityRecord,
      contextRecord,
      adp
    );

  const scarcityProfile =
    buildDraftScarcityProfile({
      candidate:
        candidate,

      currentPool:
        pools.currentPool,

      nextTurnPool:
        pools.nextTurnPool
    });

  const productionContextProfile =
    contextRecord.contextStatus ===
      "context-profiled"
      ? contextRecord.contextProfile
      : null;

  const controlSage =
    buildRecommendation({
      opportunityProfile:
        opportunityProfile,

      marketProfile:
        marketProfile,

      scarcityProfile:
        scarcityProfile,

      contextProfile:
        null
    });

  const contextSage =
    buildRecommendation({
      opportunityProfile:
        opportunityProfile,

      marketProfile:
        marketProfile,

      scarcityProfile:
        scarcityProfile,

      contextProfile:
        productionContextProfile
    });

  const behaviorValidation =
    validateBehavior(
      player,
      contextRecord,
      controlSage,
      contextSage,
      opportunityResult.source
    );

  return {
    player: {
      name:
        player.name,

      pos:
        player.pos,

      archetype:
        player.archetype,

      expectedBehavior:
        player.expectedBehavior,

      playerID:
        contextRecord.playerID ||
        (
          opportunityRecord
            ? opportunityRecord.playerID
            : null
        ),

      team:
        contextRecord.team ||
        null,

      adp:
        adp,

      marketRank:
        contextRecord.marketRank ||
        null
    },

    status:
      "ok",

    opportunitySource:
      opportunityResult.source,

    diagnosticState: {
      currentPick:
        state.currentPick,

      nextUserPick:
        state.nextUserPick,

      currentPoolCount:
        pools.currentPool.length,

      nextTurnPoolCount:
        pools.nextTurnPool.length
    },

    contextStatus:
      contextRecord.contextStatus,

    contextValidation:
      contextValidation,

    behaviorValidation:
      behaviorValidation,

    contextProfile:
      productionContextProfile,

    sharedInputs: {
      opportunityProfile:
        opportunityProfile,

      marketProfile:
        marketProfile,

      scarcityProfile:
        scarcityProfile
    },

    control: {
      contextApplied:
        false,

      sage:
        controlSage
    },

    withContext: {
      contextApplied:
        !!productionContextProfile,

      sage:
        contextSage
    },

    delta: {
      recommendationChanged:
        (
          controlSage &&
          contextSage &&
          controlSage.code !==
            contextSage.code
        ),

      controlRecommendation:
        controlSage
          ? controlSage.recommendation
          : null,

      contextRecommendation:
        contextSage
          ? contextSage.recommendation
          : null,

      explanationChanged:
        (
          controlSage &&
          contextSage &&
          controlSage.explanation !==
            contextSage.explanation
        ),

      reasonsChanged:
        JSON.stringify(
          controlSage
            ? controlSage.reasons
            : null
        ) !==
        JSON.stringify(
          contextSage
            ? contextSage.reasons
            : null
        )
    }
  };
}


// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------

function buildSummary(
  results
) {
  const okResults =
    results.filter(
      function(result) {
        return (
          result.status ===
            "ok"
        );
      }
    );

  const contextValidationFailures =
    results.filter(
      function(result) {
        return (
          !result.contextValidation ||
          result.contextValidation.passed !==
            true
        );
      }
    );

  const behaviorValidationFailures =
    results.filter(
      function(result) {
        return (
          !result.behaviorValidation ||
          result.behaviorValidation.passed !==
            true
        );
      }
    );

  const changedByContext =
    okResults.filter(
      function(result) {
        return (
          result.delta &&
          (
            result.delta.recommendationChanged ||
            result.delta.explanationChanged ||
            result.delta.reasonsChanged
          )
        );
      }
    );

  const unchanged =
    okResults.filter(
      function(result) {
        return (
          result.delta &&
          !result.delta.recommendationChanged &&
          !result.delta.explanationChanged &&
          !result.delta.reasonsChanged
        );
      }
    );

  const phase2GRookies =
    okResults.filter(
      function(result) {
        return (
          result.player &&
          result.player.expectedBehavior ===
            "rookie-evidence-restraint"
        );
      }
    );

  const phase2GRookiePasses =
    phase2GRookies.filter(
      function(result) {
        return (
          result.contextValidation &&
          result.contextValidation.passed ===
            true &&
          result.behaviorValidation &&
          result.behaviorValidation.passed ===
            true
        );
      }
    );

  return {
    validationPlayerCount:
      results.length,

    successfulPlayerCount:
      okResults.length,

    contextValidationFailureCount:
      contextValidationFailures.length,

    behaviorValidationFailureCount:
      behaviorValidationFailures.length,

    contextChangedSageCount:
      changedByContext.length,

    contextUnchangedSageCount:
      unchanged.length,

    phase2GRookieCount:
      phase2GRookies.length,

    phase2GRookiePassedCount:
      phase2GRookiePasses.length,

    phase2GRookieFailureCount:
      (
        phase2GRookies.length -
        phase2GRookiePasses.length
      ),

    phase2GRookieResults:
      phase2GRookies.map(
        function(result) {
          const checks =
            result.behaviorValidation &&
            result.behaviorValidation.checks
              ? result.behaviorValidation.checks
              : {};

          return {
            name:
              result.player.name,

            opportunitySource:
              result.opportunitySource,

            contextValidationPassed:
              result.contextValidation
                ? result.contextValidation.passed
                : false,

            behaviorValidationPassed:
              result.behaviorValidation
                ? result.behaviorValidation.passed
                : false,

            environmentChange:
              checks.environmentChange ||
              null,

            roleOpportunity:
              checks.roleOpportunity ||
              null,

            rookieImpact:
              checks.rookieImpact ||
              null,

            blankEnvironmentDirection:
              checks.blankEnvironmentDirection ===
                true,

            blankRoleDirection:
              checks.blankRoleDirection ===
                true,

            noManufacturedDirection:
              checks.noManufacturedDirection ===
                true,

            contextVisible:
              checks.contextVisible ===
                true
          };
        }
      ),

    contextChangedPlayers:
      changedByContext.map(
        function(result) {
          return {
            name:
              result.player.name,

            archetype:
              result.player.archetype,

            expectedBehavior:
              result.player.expectedBehavior,

            controlRecommendation:
              result.delta.controlRecommendation,

            contextRecommendation:
              result.delta.contextRecommendation,

            recommendationChanged:
              result.delta.recommendationChanged,

            explanationChanged:
              result.delta.explanationChanged,

            reasonsChanged:
              result.delta.reasonsChanged,

            behaviorValidationPassed:
              result.behaviorValidation.passed
          };
        }
      ),

    unchangedPlayers:
      unchanged.map(
        function(result) {
          return {
            name:
              result.player.name,

            archetype:
              result.player.archetype,

            expectedBehavior:
              result.player.expectedBehavior,

            behaviorValidationPassed:
              result.behaviorValidation.passed
          };
        }
      ),

    contextValidationFailures:
      contextValidationFailures.map(
        function(result) {
          return {
            name:
              result.player &&
              result.player.name
                ? result.player.name
                : null,

            archetype:
              result.player &&
              result.player.archetype
                ? result.player.archetype
                : null,

            expected:
              result.contextValidation
                ? result.contextValidation.expected
                : null,

            actual:
              result.contextValidation
                ? result.contextValidation.actual
                : null,

            mismatches:
              result.contextValidation &&
              result.contextValidation.mismatches
                ? result.contextValidation.mismatches
                : []
          };
        }
      ),

    behaviorValidationFailures:
      behaviorValidationFailures.map(
        function(result) {
          return {
            name:
              result.player &&
              result.player.name
                ? result.player.name
                : null,

            archetype:
              result.player &&
              result.player.archetype
                ? result.player.archetype
                : null,

            expectation:
              result.behaviorValidation
                ? result.behaviorValidation.expectation
                : null,

            checks:
              result.behaviorValidation &&
              result.behaviorValidation.checks
                ? result.behaviorValidation.checks
                : null
          };
        }
      )
  };
}


// ------------------------------------------------------------
// HANDLER
// ------------------------------------------------------------

exports.handler =
  async function(event) {
    connectLambda(
      event
    );

    if (
      event.httpMethod ===
        "OPTIONS"
    ) {
      return {
        statusCode:
          204,

        headers:
          CORS_HEADERS,

        body:
          ""
      };
    }

    if (
      event.httpMethod !==
        "GET"
    ) {
      return {
        statusCode:
          405,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify({
            error:
              "GET only"
          })
      };
    }

    try {
      const opportunityStore =
        getStore({
          name:
            "opportunity-intel"
        });

      const contextStore =
        getStore({
          name:
            "context-intel"
        });

      const [
        opportunityCache,
        contextCache
      ] =
        await Promise.all([
          opportunityStore.get(
            "latest",
            {
              type:
                "json"
            }
          ),

          contextStore.get(
            "latest",
            {
              type:
                "json"
            }
          )
        ]);

      if (!opportunityCache) {
        return {
          statusCode:
            404,

          headers:
            CORS_HEADERS,

          body:
            JSON.stringify(
              {
                error:
                  'No cached Opportunity Intelligence data found for key "latest".'
              },
              null,
              2
            )
        };
      }

      if (!contextCache) {
        return {
          statusCode:
            404,

          headers:
            CORS_HEADERS,

          body:
            JSON.stringify(
              {
                error:
                  'No cached Context Intelligence data found for key "latest".'
              },
              null,
              2
            )
        };
      }

      const universe =
        buildScarcityUniverse(
          opportunityCache,
          contextCache
        );

      const results =
        VALIDATION_PLAYERS.map(
          function(player) {
            return buildPlayerTest(
              opportunityCache,
              contextCache,
              universe,
              player
            );
          }
        );

      const summary =
        buildSummary(
          results
        );

      const allPlayersSuccessful =
        summary.successfulPlayerCount ===
        summary.validationPlayerCount;

      const validationPassed =
        (
          allPlayersSuccessful &&
          summary.contextValidationFailureCount ===
            0 &&
          summary.behaviorValidationFailureCount ===
            0 &&
          summary.phase2GRookieCount ===
            5 &&
          summary.phase2GRookiePassedCount ===
            5 &&
          summary.phase2GRookieFailureCount ===
            0
        );

      return {
        statusCode:
          validationPassed
            ? 200
            : 409,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            {
              validation:
                "SAGE Context Directional Validation",

              phase:
                "2G-release-gate-1",

              validationPassed:
                validationPassed,

              methodology: {
                description:
                  "Each player is run through SAGE twice with identical Opportunity, Market, and Scarcity profiles. The second run adds only the production Context profile.",

                control:
                  "Opportunity + Market + Scarcity",

                treatment:
                  "Opportunity + Market + Scarcity + Context",

                adpSource:
                  "context-intel/latest",

                rookieOpportunityRule:
                  "If a rookie has no production Opportunity record, use an explicit No NFL History profile rather than fabricating NFL production.",

                restraintRule:
                  "A material team or quarterback change is not automatically positive or negative. Direction must be supported by evidence.",

                phase2GRookieRule:
                  "Draft capital, prospect evidence, receiving evidence, or landing spot may inform rookie Context but must not automatically create positive environment or role direction.",

                phase2GRookieDirectionRequirement:
                  "Phase 2G rookies must retain blank evidence environmentDirection and roleDirection unless objective directional evidence exists.",

                hiddenNumericContextScore:
                  false
              },

              opportunityComputedAt:
                opportunityCache.computedAt ||
                null,

              contextComputedAt:
                contextCache.computedAt ||
                null,

              contextPhase:
                contextCache.phase ||
                null,

              contextPopulationCount:
                contextCache.populationCount ||
                null,

              contextProfiledCount:
                contextCache.contextProfiledCount ||
                0,

              summary:
                summary,

              results:
                results
            },
            null,
            2
          )
      };

    } catch (e) {
      return {
        statusCode:
          500,

        headers:
          CORS_HEADERS,

        body:
          JSON.stringify(
            {
              error:
                "SAGE Context directional validation failed",

              detail:
                e.message,

              stack:
                e.stack
            },
            null,
            2
          )
      };
    }
  };


// ------------------------------------------------------------
// PURE EXPORTS
// ------------------------------------------------------------

module.exports.VALIDATION_PLAYERS =
  VALIDATION_PLAYERS;

module.exports.normalizePlayerName =
  normalizePlayerName;

module.exports.normalizePosition =
  normalizePosition;

module.exports.playerKey =
  playerKey;

module.exports.getOpportunityRecord =
  getOpportunityRecord;

module.exports.getContextRecord =
  getContextRecord;

module.exports.profileLabel =
  profileLabel;

module.exports.validateContextProfile =
  validateContextProfile;

module.exports.getContextAdp =
  getContextAdp;

module.exports.buildNoNFLHistoryOpportunityProfile =
  buildNoNFLHistoryOpportunityProfile;

module.exports.buildSharedOpportunityProfile =
  buildSharedOpportunityProfile;

module.exports.buildScarcityUniverse =
  buildScarcityUniverse;

module.exports.buildDiagnosticDraftState =
  buildDiagnosticDraftState;

module.exports.buildScarcityPools =
  buildScarcityPools;

module.exports.buildScarcityCandidate =
  buildScarcityCandidate;

module.exports.getContextEvidence =
  getContextEvidence;

module.exports.isBlankDirection =
  isBlankDirection;

module.exports.validateBehavior =
  validateBehavior;

module.exports.buildPlayerTest =
  buildPlayerTest;

module.exports.buildSummary =
  buildSummary;
