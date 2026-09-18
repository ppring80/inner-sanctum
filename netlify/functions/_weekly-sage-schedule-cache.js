// Shared cache-only reader for customer-facing Weekly SAGE leaderboards.
// Live schedule construction belongs exclusively to the authorized refresh.

const { getStore } = require("@netlify/blobs");

const STORE_NAME = "weekly-sage-schedule";

async function readCachedWeeklySchedule({ season, week, seasonType }) {
  const key = `week:${season}:${week}:${seasonType}`;
  let cached = null;

  try {
    cached = await getStore({ name: STORE_NAME }).get(key, { type: "json" });
  } catch (error) {
    const err = new Error("Weekly SAGE schedule cache could not be read.");
    err.statusCode = 503;
    err.detail = error && error.message;
    throw err;
  }

  if (!cached || cached.evidenceType !== "weekly-sage-schedule") {
    const err = new Error(
      `No cached Weekly SAGE schedule found for ${key}. Run refresh-weekly-sage-schedule first.`
    );
    err.statusCode = 503;
    throw err;
  }

  if (
    String(cached.season) !== String(season) ||
    Number(cached.targetWeek ?? cached.week) !== Number(week) ||
    String(cached.seasonType || "reg") !== String(seasonType)
  ) {
    const err = new Error(`Cached Weekly SAGE schedule did not match requested ${key}.`);
    err.statusCode = 503;
    throw err;
  }

  return cached;
}

exports.readCachedWeeklySchedule = readCachedWeeklySchedule;
exports.WEEKLY_SAGE_SCHEDULE_STORE = STORE_NAME;
