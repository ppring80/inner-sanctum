"use strict";

const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "tank01-daily-budget";
const DEFAULT_DAILY_LIMIT = 700;
const DEFAULT_NORMAL_LIMIT = 600;
const MAX_CAS_ATTEMPTS = 8;
const PROJECTION_JOB = 'refresh-weekly-projections';
// Within the existing normal pool: four routine six-hour refreshes plus the
// existing bounded retry allowance (eight total worker attempts per UTC day).
const PROJECTION_RESERVE = 8;
function projectionProtection(state, standardLimit) {
  const allocation = Math.min(PROJECTION_RESERVE, standardLimit);
  const count = Number(state.projectionReserved ?? state.jobs?.[PROJECTION_JOB] ?? 0);
  const used = Number.isSafeInteger(count) && count >= 0 ? count : 0;
  const remaining = Math.max(0, allocation-used);
  return {allocation,used,remaining,backgroundLimit:standardLimit-remaining};
}
function reserveDecision(state, {job,requested,priority,maxJobCalls,limit,standardLimit,day}) {
  const reserved=Number(state.reserved||0),normalReserved=Number(state.normalReserved??state.reserved??0);
  const protection=projectionProtection(state,standardLimit);
  const base={job,requested,reserved,remaining:Math.max(0,limit-reserved),limit,day};
  if(Number(state.jobs?.[job]||0)+requested>maxJobCalls)return {allowed:false,reason:'job-daily-limit',...base};
  if(reserved+requested>limit||(priority==='normal'&&normalReserved+requested>standardLimit))return {allowed:false,reason:'daily-limit',...base};
  if(priority==='normal'&&job!==PROJECTION_JOB&&normalReserved+requested>protection.backgroundLimit)
    return {allowed:false,reason:'projection-reserve',...base,projectionReserveRemaining:protection.remaining,backgroundNormalLimit:protection.backgroundLimit};
  return null;
}
const localFallbackByDay = new Map();

function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function dailyLimit() {
  const configured = Number(process.env.TANK01_DAILY_CALL_LIMIT);
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, 900)
    : DEFAULT_DAILY_LIMIT;
}

function normalLimit(totalLimit = dailyLimit()) {
  const configured = Number(process.env.TANK01_NORMAL_CALL_LIMIT);
  const defaultLimit = Math.min(DEFAULT_NORMAL_LIMIT, totalLimit);
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, defaultLimit)
    : defaultLimit;
}

function killSwitchEnabled() {
  return String(process.env.TANK01_KILL_SWITCH || "").trim().toLowerCase() === "true";
}

function budgetResponse(result) {
  return {
    statusCode: 429,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      cached: false,
      error: "Tank01 refresh blocked by the shared daily safety budget.",
      budget: result
    }, null, 2)
  };
}

async function reserveTank01Calls(event, options, dependencies = {}) {
  const job = String(options && options.job || "unknown").trim();
  const requested = Number(options && options.calls);
  const priority = options && options.priority === "injury" ? "injury" : "normal";
  const maxJobCalls = Number.isInteger(options?.maxJobCalls) && options.maxJobCalls > 0 ? options.maxJobCalls : Infinity;
  const now = dependencies.now || new Date();
  const limit = dependencies.limit || dailyLimit();
  const standardLimit = dependencies.normalLimit || normalLimit(limit);

  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("Tank01 budget reservations require a positive integer call count.");
  }

  if (killSwitchEnabled() || dependencies.killSwitch === true) {
    return { allowed: false, reason: "kill-switch", job, requested, limit, day: utcDay(now) };
  }

  if (!dependencies.store) connectLambda(event);
  const store = dependencies.store || getStore({ name: STORE_NAME });
  const day = utcDay(now);
  const key = `day:${day}`;

  // Unit-test and local Blob fakes used by this repository predate the
  // conditional-write API. Production @netlify/blobs exposes both methods;
  // retain an in-memory fallback only for those non-production adapters so
  // budget bookkeeping cannot interfere with legacy cache-write assertions.
  if (typeof store.getWithMetadata !== "function") {
    const state = localFallbackByDay.get(day) || { day, reserved: 0, normalReserved: 0, injuryReserved: 0, jobs: {} };
    const reserved = Number(state.reserved || 0);
    const normalReserved = Number(state.normalReserved ?? state.reserved ?? 0);
    const denied=reserveDecision(state,{job,requested,priority,maxJobCalls,limit,standardLimit,day});
    if(denied)return denied;
    const next = {
      day,
      limit,
      reserved: reserved + requested,
      normalLimit: standardLimit,
      projectionReserve: Math.min(PROJECTION_RESERVE,standardLimit),
      projectionReserved: projectionProtection(state,standardLimit).used + (job===PROJECTION_JOB&&priority==='normal'?requested:0),
      normalReserved: normalReserved + (priority === "normal" ? requested : 0),
      injuryReserved: Number(state.injuryReserved || 0) + (priority === "injury" ? requested : 0),
      updatedAt: now.toISOString(),
      jobs: { ...(state.jobs || {}), [job]: Number((state.jobs || {})[job] || 0) + requested }
    };
    localFallbackByDay.set(day, next);
    return { allowed: true, reason: "reserved", job, requested, reserved: next.reserved, remaining: limit - next.reserved, limit, day };
  }

  // Lambda connectLambda configures an edge URL but no uncachedEdgeURL.
  // Strong reads therefore throw before any provider work. Read through the
  // supported adapter: onlyIfMatch/onlyIfNew remain the atomic safety boundary.
  // A stale ETag cannot reserve calls: the conditional write loses and retries
  // or fails closed. It never increases the ledger from a stale read.
  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: "json" });
    const state = current && current.data && typeof current.data === "object"
      ? current.data
      : { day, reserved: 0, normalReserved: 0, injuryReserved: 0, jobs: {} };
    const reserved = Number(state.reserved || 0);
    // Ledgers written before priority pools existed are treated as normal
    // consumption. This is conservative and cannot expose the reserved pool.
    const normalReserved = Number(state.normalReserved ?? state.reserved ?? 0);
    const denied=reserveDecision(state,{job,requested,priority,maxJobCalls,limit,standardLimit,day});
    if(denied)return denied;

    const next = {
      day,
      limit,
      reserved: reserved + requested,
      normalLimit: standardLimit,
      projectionReserve: Math.min(PROJECTION_RESERVE,standardLimit),
      projectionReserved: projectionProtection(state,standardLimit).used + (job===PROJECTION_JOB&&priority==='normal'?requested:0),
      normalReserved: normalReserved + (priority === "normal" ? requested : 0),
      injuryReserved: Number(state.injuryReserved || 0) + (priority === "injury" ? requested : 0),
      updatedAt: now.toISOString(),
      jobs: {
        ...(state.jobs || {}),
        [job]: Number((state.jobs || {})[job] || 0) + requested
      }
    };
    const write = current
      ? await store.setJSON(key, next, { onlyIfMatch: current.etag })
      : await store.setJSON(key, next, { onlyIfNew: true });

    if (write.modified) {
      return {
        allowed: true,
        reason: "reserved",
        job,
        requested,
        reserved: next.reserved,
        remaining: limit - next.reserved,
        limit,
        day
      };
    }
  }

  return { allowed: false, reason: "reservation-contention", job, requested, limit, day };
}

async function requireTank01Budget(event, options, dependencies = {}) {
  const result = await reserveTank01Calls(event, options, dependencies);
  if (!result.allowed) {
    console.error("TANK01_BUDGET_BLOCKED", JSON.stringify(result));
    return budgetResponse(result);
  }
  console.log("TANK01_BUDGET_RESERVED", JSON.stringify(result));
  return null;
}

module.exports = {
  STORE_NAME,
  DEFAULT_DAILY_LIMIT,
  DEFAULT_NORMAL_LIMIT,
  MAX_CAS_ATTEMPTS,
  PROJECTION_JOB,
  PROJECTION_RESERVE,
  projectionProtection,
  utcDay,
  dailyLimit,
  normalLimit,
  killSwitchEnabled,
  budgetResponse,
  reserveTank01Calls,
  requireTank01Budget
};
