// WR weekly eligibility rules. Provider statuses are authoritative when the
// cached snapshot contains them. Soft injury designations remain rankable so
// the UI can show the risk; hard-unavailable players are routed to `inactive`.

const HARD_UNAVAILABLE = new Set([
  "OUT", "IR", "INACTIVE", "INJURED RESERVE", "RESERVE/INJURED",
  "SUSPENDED", "COMMISSIONER EXEMPT", "COMMISSIONER'S EXEMPT LIST",
  "COMMISSIONER EXEMPT NO PLAY", "PUP", "RESERVE/PUP", "NFI", "RESERVE/NFI"
]);

function normalizeStatus(value) {
  return String(value || "").trim().replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ").toUpperCase();
}

function availabilityForPlayer(player) {
  const status = normalizeStatus(player && (
    player.eligibilityStatus || player.injuryStatus ||
    player.availabilityStatus || player.rosterStatus || player.status
  ));
  const hardUnavailable = player && player.eligible !== true && (
    player.eligible === false || HARD_UNAVAILABLE.has(status)
  );
  return {
    status: status || null,
    eligible: !hardUnavailable,
    source: status ? "provider" : null,
    reason: hardUnavailable ? `Provider reports ${status || "ineligible"}.` : null
  };
}

module.exports = { HARD_UNAVAILABLE, normalizeStatus, availabilityForPlayer };
