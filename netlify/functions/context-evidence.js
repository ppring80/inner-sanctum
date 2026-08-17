// netlify/functions/context-evidence.js
//
// SAGE CONTEXT INTELLIGENCE — PHASE 2E EVIDENCE REGISTRY
//
// PURPOSE:
// Store objective, reviewable Context evidence for players whose
// circumstances materially changed.
//
// IMPORTANT:
// - This is NOT a player ranking file.
// - This is NOT a projection file.
// - This is NOT the 256-player population.
// - Most players will NOT need an entry.
// - The dynamic top-256 population remains controlled by
//   refresh-context-intel.js.
//
// Context evidence is EVENT-DRIVEN.
//
// Examples:
// - changed team
// - new coach / coordinator / scheme
// - quarterback change
// - material role/depth-chart change
// - rookie draft capital / prospect evidence
// - offensive-line change
// - meaningful injury-return situation
//
// Every evidence record should be grounded in identifiable source facts.
// The downstream draft-context-profile.js interprets this evidence.
//
// TEAM INTEGRITY:
// Each evidence record may carry:
//
//   expectedTeam: "NE"
//
// context-integrity-check.js compares expectedTeam against:
//   1. context-intel/latest
//   2. CURRENT live player-data.js
//
// If those disagree, the evidence is treated as stale and the
// release integrity check fails.
//
// CURRENT VALIDATED ARCHETYPES:
//
//   A.J. Brown
//     veteran team/QB environment change
//
//   Ashton Jeanty
//     coaching/scheme + role opportunity improvement
//
//   Jeremiyah Love
//     high-impact rookie with no manufactured NFL history
//
//   Rachaad White
//     veteran team change into a narrower role opportunity
//
//   Jaylen Waddle
//     high-value veteran team change; restraint case
//
//   Kenneth Walker III
//     high-value veteran team change; restraint case

(function(root, factory) {
  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = factory();
  } else {
    root.SanctumContextEvidence =
      factory();
  }
}(
  typeof self !== "undefined"
    ? self
    : this,

  function() {
    "use strict";


    // ----------------------------------------------------------
    // PLAYER IDENTITY
    // ----------------------------------------------------------

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


    function playerKey(
      name,
      pos
    ) {
      return (
        normalizePlayerName(name) +
        "|" +
        normalizePosition(pos)
      );
    }


    // ----------------------------------------------------------
    // EVIDENCE REGISTRY
    // ----------------------------------------------------------

    var CONTEXT_EVIDENCE = {};


    // ==========================================================
    // A.J. BROWN — WR — NEW ENGLAND
    // ==========================================================

    CONTEXT_EVIDENCE[
      playerKey(
        "A.J. Brown",
        "WR"
      )
    ] = {
      playerID:
        "4047646",

      longName:
        "A.J. Brown",

      pos:
        "WR",

      expectedTeam:
        "NE",

      evidence: {
        isRookie:
          false,

        changedTeam:
          true,

        coachingChange:
          false,

        quarterbackChange:
          true,

        offensiveLineChange:
          "",

        roleChange:
          "similar",

        depthChartChange:
          "",

        prospectTier:
          "",

        draftCapitalTier:
          "",

        receivingProfile:
          "",

        environmentDirection:
          "positive",

        roleDirection:
          "similar",

        notes: [
          "Acquired by New England from Philadelphia during the 2026 offseason.",
          "Expected to remain a major receiving option in the new offense.",
          "Entering a new quarterback environment with Drake Maye."
        ]
      },

      sources: [
        {
          sourceType:
            "primary",

          publisher:
            "New England Patriots",

          description:
            "Official transaction announcement confirming acquisition from Philadelphia.",

          sourceUrl:
            "https://www.patriots.com/news/patriots-acquire-wr-a-j-brown-in-a-trade-with-the-philadelphia-eagles"
        },

        {
          sourceType:
            "primary",

          publisher:
            "New England Patriots",

          description:
            "Patriots analysis describing Brown as a likely top passing-game option.",

          sourceUrl:
            "https://www.patriots.com/news/report-patriots-acquire-star-wr-a-j-brown-in-blockbuster-trade-with-eagles"
        },

        {
          sourceType:
            "primary",

          publisher:
            "New England Patriots",

          description:
            "Team minicamp evidence of Brown working with Drake Maye.",

          sourceUrl:
            "https://www.patriots.com/video/drake-maye-to-a-j-brown-for-the-td-patriots-minicamp"
        }
      ]
    };


    // ==========================================================
    // ASHTON JEANTY — RB — LAS VEGAS
    // ==========================================================

    CONTEXT_EVIDENCE[
      playerKey(
        "Ashton Jeanty",
        "RB"
      )
    ] = {
      playerID:
        "4890973",

      longName:
        "Ashton Jeanty",

      pos:
        "RB",

      expectedTeam:
        "LV",

      evidence: {
        isRookie:
          false,

        changedTeam:
          false,

        coachingChange:
          true,

        quarterbackChange:
          true,

        offensiveLineChange:
          "",

        roleChange:
          "improved",

        depthChartChange:
          "improved",

        prospectTier:
          "",

        draftCapitalTier:
          "",

        receivingProfile:
          "strong",

        environmentDirection:
          "positive",

        roleDirection:
          "improved",

        notes: [
          "Entering Year 2 under new head coach Klint Kubiak.",
          "Raiders describe Jeanty as the anchor of the 2026 backfield.",
          "Current coaching emphasis includes pass protection and expanded pass-catching development."
        ]
      },

      sources: [
        {
          sourceType:
            "primary",

          publisher:
            "Las Vegas Raiders",

          description:
            "Official announcement of Klint Kubiak as Raiders head coach.",

          sourceUrl:
            "https://www.raiders.com/video/klint-kubiak-raiders-head-coach-hypenfl-2026"
        },

        {
          sourceType:
            "primary",

          publisher:
            "Las Vegas Raiders",

          description:
            "Raiders feature describing Jeanty as the anchor of the backfield in Kubiak's new scheme.",

          sourceUrl:
            "https://www.raiders.com/news/ashton-jeanty-steady-anchor-of-the-raiders-backfield-2026-season-nfl"
        },

        {
          sourceType:
            "primary",

          publisher:
            "Las Vegas Raiders",

          description:
            "Running-backs coach discusses Jeanty's pass protection and pass-catching development.",

          sourceUrl:
            "https://www.raiders.com/news/3-takeaways-from-raiders-offensive-assistants-otas-2026-mike-sullivan-rick-dennison-omar-young"
        }
      ]
    };


    // ==========================================================
    // JEREMIYAH LOVE — RB — ARIZONA
    // ==========================================================

    CONTEXT_EVIDENCE[
      playerKey(
        "Jeremiyah Love",
        "RB"
      )
    ] = {
      playerID:
        "4870808",

      longName:
        "Jeremiyah Love",

      pos:
        "RB",

      expectedTeam:
        "ARI",

      evidence: {
        isRookie:
          true,

        changedTeam:
          false,

        coachingChange:
          false,

        quarterbackChange:
          false,

        offensiveLineChange:
          "",

        roleChange:
          "",

        depthChartChange:
          "",

        prospectTier:
          "elite",

        draftCapitalTier:
          "premium",

        receivingProfile:
          "",

        environmentDirection:
          "",

        roleDirection:
          "",

        notes: [
          "Selected No. 3 overall by Arizona in the 2026 NFL Draft.",
          "Premium draft capital provides strong non-NFL evidence of organizational investment.",
          "No NFL Opportunity history is manufactured for this rookie."
        ]
      },

      sources: [
        {
          sourceType:
            "primary",

          publisher:
            "Arizona Cardinals",

          description:
            "Official Cardinals draft coverage confirming Love as the No. 3 overall selection.",

          sourceUrl:
            "https://www.azcardinals.com/news/cardinals-select-jeremiyah-love-in-first-round-of-2026-draft"
        },

        {
          sourceType:
            "primary",

          publisher:
            "Arizona Cardinals",

          description:
            "Official draft-call video confirming the No. 3 overall selection.",

          sourceUrl:
            "https://www.azcardinals.com/video/on-the-call-jeremiyah-love-learns-he-is-a-cardinal"
        }
      ]
    };


    // ==========================================================
    // RACHAAD WHITE — RB — WASHINGTON
    // ==========================================================

    CONTEXT_EVIDENCE[
      playerKey(
        "Rachaad White",
        "RB"
      )
    ] = {
      playerID:
        null,

      longName:
        "Rachaad White",

      pos:
        "RB",

      expectedTeam:
        "WAS",

      evidence: {
        isRookie:
          false,

        changedTeam:
          true,

        coachingChange:
          true,

        quarterbackChange:
          true,

        offensiveLineChange:
          "",

        roleChange:
          "reduced",

        depthChartChange:
          "reduced",

        prospectTier:
          "",

        draftCapitalTier:
          "",

        receivingProfile:
          "strong",

        environmentDirection:
          "neutral",

        roleDirection:
          "reduced",

        notes: [
          "Washington's 2026 unofficial depth chart lists Jacory Croskey-Merritt first at running back and Rachaad White second.",
          "Commanders coverage says White was brought in to serve as a third-down pass catcher.",
          "The evidence supports a narrower role opportunity without projecting a specific workload."
        ]
      },

      sources: [
        {
          sourceType:
            "primary",

          publisher:
            "Washington Commanders",

          description:
            "Official 2026 unofficial depth chart listing Jacory Croskey-Merritt first and Rachaad White second at running back.",

          sourceUrl:
            "https://www.commanders.com/news/commanders-release-2026-unofficial-depth-chart"
        },

        {
          sourceType:
            "primary",

          publisher:
            "Washington Commanders",

          description:
            "Commanders coverage describing Croskey-Merritt at the top of the backfield and White as a third-down pass catcher.",

          sourceUrl:
            "https://www.commanders.com/news/shawn-springs-competition-commanders-running-back-room"
        },

        {
          sourceType:
            "primary",

          publisher:
            "Washington Commanders",

          description:
            "Commanders coverage identifying Croskey-Merritt as having the best chance to become the team's lead back in 2026.",

          sourceUrl:
            "https://www.commanders.com/news/commanders-confidence-running-back-room-rachaad-white"
        }
      ]
    };


    // ==========================================================
    // JAYLEN WADDLE — WR — DENVER
    //
    // Archetype:
    // High-value established veteran changing teams.
    //
    // RESTRAINT TEST:
    // The transaction is objectively important, but changing teams
    // does NOT by itself prove that Waddle's fantasy environment or
    // role improved.
    //
    // Therefore:
    //   changedTeam = true
    //   quarterbackChange = true
    //   environmentDirection = ""
    //   roleDirection = "similar"
    //
    // Context should recognize meaningful change without creating
    // an automatic positive fantasy adjustment.
    // ==========================================================

    CONTEXT_EVIDENCE[
      playerKey(
        "Jaylen Waddle",
        "WR"
      )
    ] = {
      // Allow the production refresh to resolve and verify identity
      // before we permanently lock a Tank01 player ID.
      playerID:
        null,

      longName:
        "Jaylen Waddle",

      pos:
        "WR",

      expectedTeam:
        "DEN",

      evidence: {
        isRookie:
          false,

        changedTeam:
          true,

        coachingChange:
          false,

        quarterbackChange:
          true,

        offensiveLineChange:
          "",

        roleChange:
          "similar",

        depthChartChange:
          "",

        prospectTier:
          "",

        draftCapitalTier:
          "",

        receivingProfile:
          "strong",

        // Deliberately unspecified.
        //
        // Denver's investment establishes importance, not an
        // objectively guaranteed fantasy upgrade.
        environmentDirection:
          "",

        roleDirection:
          "similar",

        notes: [
          "Denver acquired Jaylen Waddle from Miami during the 2026 offseason.",
          "Denver surrendered significant draft capital in the transaction, demonstrating substantial organizational investment.",
          "Broncos leadership identified Waddle as an explosive offensive element intended to complement the existing receiving group.",
          "The evidence establishes a meaningful team and quarterback change but does not independently prove that Waddle's fantasy environment improved."
        ]
      },

      sources: [
        {
          sourceType:
            "primary",

          publisher:
            "Denver Broncos",

          description:
            "Official announcement confirming Denver acquired Jaylen Waddle from Miami.",

          sourceUrl:
            "https://www.denverbroncos.com/news/broncos-acquire-wr-jaylen-waddle-in-trade-with-dolphins"
        },

        {
          sourceType:
            "primary",

          publisher:
            "Denver Broncos",

          description:
            "Broncos GM George Paton discusses the organizational rationale and offensive fit behind the Waddle acquisition.",

          sourceUrl:
            "https://www.denverbroncos.com/news/gm-george-paton-details-why-trade-for-waddle-was-too-unique-to-pass-up-confidence-in-wr-room"
        }
      ]
    };


    // ==========================================================
    // KENNETH WALKER III — RB — KANSAS CITY
    //
    // Archetype:
    // High-value established veteran changing teams.
    //
    // RESTRAINT TEST:
    // Kansas City clearly valued Walker and made him a marquee
    // addition to the backfield. That does NOT automatically prove
    // his fantasy opportunity improved relative to Seattle.
    //
    // Therefore:
    //   changedTeam = true
    //   quarterbackChange = true
    //   environmentDirection = ""
    //   roleDirection = "similar"
    //
    // Context records the material change without double-counting
    // Walker's established player value.
    // ==========================================================

    CONTEXT_EVIDENCE[
      playerKey(
        "Kenneth Walker III",
        "RB"
      )
    ] = {
      // Allow live production data to resolve and verify the Tank01
      // identity before permanently locking the ID.
      playerID:
        null,

      longName:
        "Kenneth Walker III",

      pos:
        "RB",

      expectedTeam:
        "KC",

      evidence: {
        isRookie:
          false,

        changedTeam:
          true,

        coachingChange:
          true,

        quarterbackChange:
          true,

        offensiveLineChange:
          "",

        roleChange:
          "similar",

        depthChartChange:
          "",

        prospectTier:
          "",

        draftCapitalTier:
          "",

        receivingProfile:
          "",

        // Deliberately unspecified.
        //
        // Joining Kansas City is a material environment change,
        // but Context does not convert team reputation into an
        // automatic fantasy upgrade.
        environmentDirection:
          "",

        roleDirection:
          "similar",

        notes: [
          "Kenneth Walker signed with Kansas City during the 2026 offseason after four seasons with Seattle.",
          "Kansas City identified Walker as a major addition to its backfield.",
          "Chiefs pre-camp coverage described Walker as the team's marquee free-agent running back signing.",
          "The evidence establishes a meaningful team and offensive-environment change without independently declaring his fantasy opportunity improved."
        ]
      },

      sources: [
        {
          sourceType:
            "primary",

          publisher:
            "Kansas City Chiefs",

          description:
            "Official Chiefs player biography and transaction record confirming Walker signed with Kansas City on March 12, 2026.",

          sourceUrl:
            "https://www.chiefs.com/team/players-roster/kenneth-walker-iii/"
        },

        {
          sourceType:
            "primary",

          publisher:
            "Kansas City Chiefs",

          description:
            "Official Chiefs feature describing Walker as a major addition to the backfield.",

          sourceUrl:
            "https://www.chiefs.com/news/five-things-to-know-about-new-chiefs-rb-kenneth-walker-"
        },

        {
          sourceType:
            "primary",

          publisher:
            "Kansas City Chiefs",

          description:
            "Chiefs pre-camp running-back breakdown describing Walker as the marquee free-agent addition.",

          sourceUrl:
            "https://www.chiefs.com/news/pre-camp-breakdown-looking-at-the-chiefs-running-backs"
        }
      ]
    };


    // ----------------------------------------------------------
    // READ HELPERS
    // ----------------------------------------------------------

    function getContextEvidence(
      name,
      pos
    ) {
      var key =
        playerKey(
          name,
          pos
        );

      return (
        CONTEXT_EVIDENCE[key] ||
        null
      );
    }


    function getContextEvidenceByKey(
      key
    ) {
      return (
        CONTEXT_EVIDENCE[key] ||
        null
      );
    }


    function hasContextEvidence(
      name,
      pos
    ) {
      return !!getContextEvidence(
        name,
        pos
      );
    }


    function getAllContextEvidence() {
      var copy = {};

      Object.keys(
        CONTEXT_EVIDENCE
      ).forEach(function(key) {
        copy[key] =
          CONTEXT_EVIDENCE[key];
      });

      return copy;
    }


    return {
      normalizePlayerName:
        normalizePlayerName,

      normalizePosition:
        normalizePosition,

      playerKey:
        playerKey,

      CONTEXT_EVIDENCE:
        CONTEXT_EVIDENCE,

      getContextEvidence:
        getContextEvidence,

      getContextEvidenceByKey:
        getContextEvidenceByKey,

      hasContextEvidence:
        hasContextEvidence,

      getAllContextEvidence:
        getAllContextEvidence
    };
  }
));
