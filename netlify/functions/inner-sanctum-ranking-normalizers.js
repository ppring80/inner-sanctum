// Shared, dependency-free normalization for the Inner Sanctum MCP bridge.

const UNAVAILABLE_ROSTER_STATUSES = new Set([
  "RS",
  "RESERVE",
  "IR",
  "INJURED RESERVE",
  "INACTIVE"
]);

function cleanRankingText(value) {
  if (value === undefined || value === null) return null;

  if (typeof value !== "object") {
    const text = String(value).trim();
    return text || null;
  }

  const candidates = [
    value.label,
    value.recommendation,
    value.code,
    value.signal,
    value.value,
    value.name
  ];

  for (const candidate of candidates) {
    if (
      candidate === undefined ||
      candidate === null ||
      typeof candidate === "object"
    ) continue;

    const text = String(candidate).trim();
    if (text) return text;
  }

  return null;
}

function isUnavailableRosterStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  return UNAVAILABLE_ROSTER_STATUSES.has(normalized);
}

module.exports = {
  cleanRankingText,
  isUnavailableRosterStatus
};
