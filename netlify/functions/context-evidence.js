// netlify/functions/context-evidence.js
//
// SAGE CONTEXT INTELLIGENCE — PHASE 2A EVIDENCE REGISTRY
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
// Initial validation records:
//   A.J. Brown
//   Ashton Jeanty
//   Jeremiyah Love
//
// These three intentionally represent different Context archetypes:
//   veteran team transition
//   veteran/second-year coaching-scheme change
//   rookie with no NFL history

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
    //
    // Keep raw evidence separate from the Context Profile labels.
    //
    // draft-context-profile.js remains responsible for converting
    // this evidence into:
    //
    //   Environment Change
    //   Role Opportunity
    //   Rookie Impact
    //   Context Confidence
    //
    // SOURCE CONFIDENCE:
    //   "primary" = official team / NFL / direct transaction source
    // ----------------------------------------------------------

    var CONTEXT_EVIDENCE = {};


    // ==========================================================
    // A.J. BROWN — WR — NEW ENGLAND
    //
    // Archetype:
    // Veteran changing teams into a new QB/offensive environment.
    //
    // Facts:
    // - New England acquired Brown from Philadelphia in June 2026.
    // - Patriots material identifies him as a likely major/top
    //   option in the passing offense.
    // - Brown has been working with Drake Maye in the new offense.
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
    // Facts:
    // - Jeanty is entering Year 2.
    // - Las Vegas hired Klint Kubiak as head coach.
    // - Raiders material describes Jeanty as the anchor of the
    //   backfield in Kubiak's new offensive scheme.
    // - RB coaching emphasis includes pass protection and becoming
    //   a better pass catcher, supporting potential broader usage.
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
    // Facts:
    // - Arizona selected Love No. 3 overall in the 2026 NFL Draft.
    // - He therefore has premium draft capital.
    // - His Context case must stand independently of NFL workload
    //   because no NFL workload history exists yet.
    //
    // Interpretation boundary:
    // We do NOT fabricate carries, targets, opportunity share,
    // fantasy points, or an NFL role history.
    //
    // Context simply records that objective rookie evidence is
    // unusually strong.
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
