"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — SHARED ROSTER IDENTITY
// ═══════════════════════════════════════════════════════════════════════
//
// The ONE roster -> Weekly SAGE row matcher used by every Super SAGE consumer
// (ChatGPT MCP, website Start/Sit). Moved verbatim from chatgpt-mcp.js so the
// lineup decision authority and every consumer resolve identity identically.
// Identity is not decision logic: this module never ranks or chooses players.
//
// Also normalizes provider roster statuses into the canonical availability
// vocabulary the decision authority reads (e.g. CBS "RS"/"Reserve" is the
// fantasy bench, not NFL injured reserve).
// ═══════════════════════════════════════════════════════════════════════

const { isUnavailableRosterStatus } = require("./inner-sanctum-ranking-normalizers");

const AUTHORITY_UNAVAILABLE = new Set(["IR", "OUT", "O", "SUSP", "SUSPENDED", "NFI", "PUP", "INACTIVE", "RESERVE", "NA"]);

const GENERATIONAL_SUFFIX_PATTERN =
  /[\s,]+(jr|sr|ii|iii|iv)\.?$/i;

function normalizePlayerName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Strips invisible/zero-width characters (zero-width space,
    // zero-width non-joiner/joiner, BOM, soft hyphen) on their own
    // independent merits: this kind of character can end up embedded
    // in browser-scraped provider text without being visible in it,
    // and removing it can only allow a previously-blocked correct
    // match to succeed -- it never makes two genuinely different
    // visible names equal, so it carries no false-match risk. This
    // is NOT the confirmed cause of any specific known mismatch (see
    // the generational-suffix handling in matchRosterEntryToSageRow()
    // below for that); it is retained purely as harmless, generally
    // useful defensive normalization for scraped text.
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ");
}

function stripGenerationalSuffix(
  normalizedName
) {
  return normalizedName
    .replace(
      GENERATIONAL_SUFFIX_PATTERN,
      ""
    )
    .trim();
}

function normalizeTeamCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function matchRosterEntryToSageRow(
  rosterEntry,
  sageRows,
  usedRowKeys
) {
  const rowKey = (row) =>
    `${row.playerID || ""}|${normalizePlayerName(row.name)}|${row.position}`;

  if (rosterEntry.sageCompatibleId) {
    const byId = sageRows.find(
      (row) =>
        row.playerID &&
        row.playerID === rosterEntry.sageCompatibleId &&
        rosterEntry.eligiblePositions.includes(
          row.position
        ) &&
        !usedRowKeys.has(
          rowKey(row)
        )
    );

    if (byId) {
      return byId;
    }
  }

  if (
    rosterEntry.eligiblePositions.includes(
      "DEF"
    ) &&
    rosterEntry.team
  ) {
    const normalizedTeam =
      normalizeTeamCode(
        rosterEntry.team
      );

    const byTeam = sageRows.find(
      (row) =>
        row.position === "DEF" &&
        normalizeTeamCode(row.team) ===
          normalizedTeam &&
        !usedRowKeys.has(
          rowKey(row)
        )
    );

    if (byTeam) {
      return byTeam;
    }
  }

  const normalizedName =
    normalizePlayerName(
      rosterEntry.name
    );

  const byName = sageRows.find(
    (row) =>
      normalizePlayerName(row.name) ===
        normalizedName &&
      rosterEntry.eligiblePositions.includes(
        row.position
      ) &&
      !usedRowKeys.has(
        rowKey(row)
      )
  );

  if (byName) {
    return byName;
  }

  // Last resort: same base name once a generational suffix is
  // stripped from either side, same eligible position. Still an
  // exact-equality comparison, not a fuzzy one -- but because
  // stripping a suffix necessarily discards information that could
  // distinguish two different real people (e.g. a genuine "Jr."/
  // "Sr." pair both currently active at the same position), this
  // only resolves when EXACTLY ONE remaining SAGE row matches. If
  // stripping suffixes makes more than one row match, that is a
  // real ambiguity this function must not silently guess through,
  // so it returns unmatched rather than picking either candidate.
  const strippedRosterName =
    stripGenerationalSuffix(
      normalizedName
    );

  const suffixToleredCandidates =
    sageRows.filter(
      (row) =>
        stripGenerationalSuffix(
          normalizePlayerName(row.name)
        ) === strippedRosterName &&
        rosterEntry.eligiblePositions.includes(
          row.position
        ) &&
        !usedRowKeys.has(
          rowKey(row)
        )
    );

  return suffixToleredCandidates.length === 1
    ? suffixToleredCandidates[0]
    : null;
}

// Canonical roster status for the decision authority. Provider codes that are
// fantasy roster slots (not NFL availability) carry no availability status;
// provider unavailability maps to its canonical code; anything else is kept
// verbatim (uppercased) for the authority's own availability rules.
function canonicalRosterStatus(value, provider) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const prov = String(provider || "").trim().toLowerCase();
  if (prov === "cbs" && (normalized === "RS" || normalized === "RESERVE")) return null; // CBS fantasy bench
  if (isUnavailableRosterStatus(raw, provider)) {
    if (normalized === "I" || normalized === "IR" || normalized === "INJURED RESERVE") return "IR";
    if (normalized === "O" || normalized === "OUT") return "OUT";
    // Any other provider-unavailable code must still read as unavailable to
    // the authority: keep it when the authority knows it, otherwise INACTIVE.
    return AUTHORITY_UNAVAILABLE.has(normalized) ? normalized : "INACTIVE";
  }
  return normalized;
}

/**
 * Match normalized roster entries ({ name, eligiblePositions[], team?,
 * sageCompatibleId?, rosterStatus? }) to flattened Weekly SAGE rows.
 * Returns { matched: [{ entry, row }], unmatched: [entry] } in roster order.
 */
function matchRoster(rosterEntries, sageRows) {
  const used = new Set();
  const matched = [], unmatched = [];
  (rosterEntries || []).forEach((entry) => {
    const row = matchRosterEntryToSageRow(entry, sageRows, used);
    if (!row) { unmatched.push(entry); return; }
    used.add(`${row.playerID || ""}|${normalizePlayerName(row.name)}|${row.position}`);
    matched.push({ entry, row });
  });
  return { matched, unmatched };
}

module.exports = {
  normalizePlayerName, stripGenerationalSuffix, normalizeTeamCode, GENERATIONAL_SUFFIX_PATTERN,
  matchRosterEntryToSageRow, matchRoster, canonicalRosterStatus
};
