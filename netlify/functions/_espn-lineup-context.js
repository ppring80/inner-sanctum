"use strict";

// Passive source facts only. Never consumed by starter selection or displayed
// as evidence of editability. Current captures verify no eligibility/lock field.
function espnLineupContext(snapshot, player) {
  const id = value => typeof value === "string" || typeof value === "number" ? String(value) : null;
  const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  return {
    provider: "espn",
    leagueId: id(snapshot.league?.id ?? snapshot.leagueId),
    teamId: id(snapshot.team?.id ?? snapshot.teamId),
    season: snapshot.league?.season ?? snapshot.season ?? null,
    scoringPeriodId: snapshot.league?.scoringPeriodId ?? null,
    week: snapshot.week ?? null,
    playerId: id(player.providerPlayerId ?? player.playerId ?? player.id),
    originalSlotId: id(player.lineupSlotId),
    originalSlotLabel: typeof player.lineupSlot === "string" ? player.lineupSlot : null,
    defaultPositionId: id(player.defaultPositionId),
    source: snapshot.meta?.source === "espn-browser-assisted" ? "espn-browser-assisted" : "espn-captured-roster",
    asOf: timestamp(snapshot.meta?.capturedAt ?? snapshot.syncedAt),
    eligibility: { status: "unknown", source: null, asOf: null },
    lock: { state: "unknown", source: null, asOf: null },
    lockRules: { status: "uninterpreted" }
  };
}

module.exports = { espnLineupContext };
