// Shared, dependency-free normalization for the Inner Sanctum MCP bridge.

const UNAVAILABLE_ROSTER_STATUSES = new Set([
  "RS",
  "RESERVE",
  "IR",
  "INJURED RESERVE",
  "INACTIVE",
  "O",
  "OUT"
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

function isUnavailableRosterStatus(value, provider) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (String(provider || "").trim().toLowerCase() === "cbs" && normalized === "I") return true;
  // CBS RS/Reserve is the fantasy bench, not NFL injured reserve.
  // Preserve the conservative generic meaning when provider is unknown.
  if (String(provider || "").trim().toLowerCase() === "cbs" &&
      (normalized === "RS" || normalized === "RESERVE")) return false;
  return UNAVAILABLE_ROSTER_STATUSES.has(normalized);
}

module.exports = {
  cleanRankingText,
  isUnavailableRosterStatus
};
