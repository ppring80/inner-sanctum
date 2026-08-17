// netlify/functions/context-evidence.js
//
// SAGE CONTEXT INTELLIGENCE — PHASE 2D EVIDENCE REGISTRY
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
    //
    // Archetype:
    // Veteran changing teams into a new QB/offensive environment.
    //
    // Interpretation boundary:
    // We are NOT saying his fantasy production will improve.
    // We are saying his environment materially changed and there
    // is credible evidence supporting continued featured usage.
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
    //
    // Archetype:
    // Established NFL player entering a materially different
    // coaching/scheme environment.
    //
    // Interpretation boundary:
    // We do NOT add fantasy points or targets.
    // We flag that his future usage environment may differ from
    // the historical 2025 Opportunity profile.
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
    //
    // Archetype:
    // High-impact rookie with no NFL Opportunity history.
    //
    // Interpretation boundary:
    // We do NOT fabricate carries, targets, opportunity share,
    // fantasy points, or an NFL role history.
    //
    // Context records objective rookie evidence only.
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
    //
    // Archetype:
    // Veteran changing teams into a narrower role opportunity.
    //
    // Current objective evidence:
    // - Washington's 2026 unofficial depth chart lists
    //   Jacory Croskey-Merritt first at RB and Rachaad White second.
    // - Commanders coverage says White was brought in to serve as
    //   a third-down pass catcher.
    // - Commanders coverage identifies Croskey-Merritt as the player
    //   positioned to lead the backfield.
    //
    // Interpretation boundary:
    // - We do NOT predict White's carries.
    // - We do NOT project receptions or fantasy points.
    // - We do NOT say he has no fantasy value.
    // - We record that his expected 2026 role is narrower than a
    //   featured/lead-back role.
    // ==========================================================

    CONTEXT_EVIDENCE[
      playerKey(
        "Rachaad White",
        "RB"
      )
    ] = {
      // Intentionally null for this first validation pass.
      //
      // The live Context population will resolve the Tank01 identity
      // through normalizedName|POS. After the refresh confirms the
      // correct player, we can capture and lock his playerID.
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

        // Washington specifically identifies third-down receiving
        // work as part of White's intended role.
        receivingProfile:
          "strong",

        // We are NOT declaring Washington's offensive environment
        // inherently negative. The negative signal is role-specific.
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
