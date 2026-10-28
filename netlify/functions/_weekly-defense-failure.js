'use strict';

// Persist only fixed categories, bounded counts and public game identifiers.
// Never retain provider response bodies, arbitrary messages or request URLs.
const RETRYABLE = new Set(['provider_request', 'provider_incomplete', 'schedule_incomplete']);
const CATEGORIES = new Set([...RETRYABLE, 'processing', 'identity', 'validation', 'budget']);
const MAX_GAMES = 16;
const DEFENSE_POLICY = 'defense-bounded-v1';
const BACKOFF_MS = [30, 60, 120].map(minutes => minutes * 60000);

function failure(category, gameIDs = [], counts = {}) {
  const safe = CATEGORIES.has(category) ? category : 'validation';
  const safeIDs = [...new Set((Array.isArray(gameIDs) ? gameIDs : []).filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)))].slice(0, MAX_GAMES);
  return {
    category: safe,
    retryable: RETRYABLE.has(safe),
    gameIDs: safeIDs,
    counts: Object.fromEntries(['returned', 'completed', 'processed', 'affected'].map(key => [key,
      Number.isSafeInteger(counts?.[key]) && counts[key] >= 0 ? Math.min(counts[key], 100) : key === 'affected' ? safeIDs.length : 0]))
  };
}

function buildError(category, gameIDs = []) {
  const error = new Error('Defensive evidence build failed.');
  error.defenseCategory = CATEGORIES.has(category) ? category : 'processing';
  error.defenseGameIDs = failure(error.defenseCategory, gameIDs).gameIDs;
  return error;
}

function summarize(evidence, problems) {
  const games = Array.isArray(evidence?.gameResults) ? evidence.gameResults : [];
  const failed = games.filter(game => game?.status !== 'processed');
  // A deterministic failure always wins over a transient failure in the same build.
  if (!evidence || evidence.evidenceType !== 'weekly-sage-defense-week' || !evidence.schedule ||
      !Array.isArray(evidence.gameResults) || !Array.isArray(evidence.kickerEvidence) ||
      !evidence.defenses || Array.isArray(evidence.defenses)) return failure('validation');
  const categories = failed.map(game => CATEGORIES.has(game?.failureCategory) ? game.failureCategory : 'processing');
  if (evidence?.schedule?.gamesReturned !== evidence?.schedule?.completedGames || !evidence?.schedule?.completedGames)
    categories.push('schedule_incomplete');
  const category = categories.find(value => !RETRYABLE.has(value)) || categories[0] || 'validation';
  return failure(category, failed.map(game => game?.gameID), {
    returned: evidence?.schedule?.gamesReturned,
    completed: evidence?.schedule?.completedGames,
    processed: evidence?.schedule?.processedGames,
    affected: failed.length || (problems?.length ? 1 : 0)
  });
}

function retryState(response, statusCode) {
  if (statusCode === 429 && response?.budget) return failure('budget');
  return failure(response?.failure?.category, response?.failure?.gameIDs || [], response?.failure?.counts || {});
}

module.exports = { failure, buildError, summarize, retryState, DEFENSE_POLICY, BACKOFF_MS };
