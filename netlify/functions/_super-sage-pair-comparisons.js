"use strict";
// Arithmetic and scope only. No scoring, weighting or preferred starter.
const matchupOrder = ['Strong Negative', 'Negative', 'Neutral', 'Positive', 'Strong Positive'];
function pairComparisons(packet) {
  if (packet.players?.length !== 2) return null;
  const players = packet.players;
  const fact = (p, field) => p.facts?.find(f => f.field === field);
  const projection = players.map(p => fact(p, 'projection'));
  const points = projection.map(f => f?.value?.points);
  const matchups = players.map(p => fact(p, 'matchup'));
  const ranks = matchups.map(f => matchupOrder.indexOf(f?.value));
  const relation = values => values[0] === values[1] ? null : players[values[0] > values[1] ? 0 : 1].id;
  return {
    candidates: players.map(p => ({playerId:p.id, name:p.name, position:p.position})),
    positionRanksComparable: Boolean(players[0].position && players[0].position === players[1].position),
    ...(points.every(Number.isFinite) ? {projection: {
      values: players.map((p,i) => ({playerId:p.id, name:p.name, points:points[i]})),
      higherPlayerId: relation(points), difference: Math.round(Math.abs(points[0]-points[1])*100)/100,
      factIds: projection.map(f => f.factId)
    }} : {}),
    ...(ranks.every(r => r >= 0) ? {matchup: {
      moreFavorablePlayerId: relation(ranks), factIds: matchups.map(f => f.factId)
    }} : {})
  };
}

function validatePairComparisons(answer, packet, namedClauses) {
  const comparison = pairComparisons(packet);
  if (!comparison) return [];
  const errors = [];
  const text = [answer?.explanation,answer?.caveat,answer?.reconsider].filter(v => typeof v === 'string').join('\n');
  // Decimal points are not sentence boundaries.
  const sentences = text.split(/(?<!\d)[.!?]|[.!?](?!\d)|\n/);
  if (packet.players.every(p => p.position) && !comparison.positionRanksComparable &&
      /\b(?:higher|better|stronger|lower)\s+(?:position(?:al)?\s+rank|rank(?:ing)?)\b|\b(?:ranked|ranks)\s+(?:higher|lower|ahead|above|below)\b/i.test(text) &&
      !/\b(?:cannot|can't|not|incomparable)\b[^.!?\n]*\b(?:compar|rank)/i.test(text)) errors.push('cross_position_rank_comparison');
  if (comparison.projection) {
    for (const player of packet.players) {
      for (const sentence of sentences) {
        for (const clause of namedClauses(sentence, player, packet.players)) {
          // Require a direct named assertion. In "start A over B because he
          // has...", a pronoun after B does not establish B as the subject.
          const surname=String(player.name).replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i,'').split(/\s+/).pop();
          const escaped=surname.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          const subject=clause.replace(new RegExp(`^${escaped}(?:\\s+(?:Jr\\.?|Sr\\.?|II|III|IV))?`, 'i'),'').trim();
          const prefix="^(?:['’]s\\s+|(?:has|holds|carries|gets)\\s+(?:the\\s+|an?\\s+)?)";
          const higher = new RegExp(prefix+'(?:\\d+(?:\\.\\d+)?[ -]point\\s+)?(?:projection|projected.points?)\\s+(?:lead|advantage|edge)\\b|'+prefix+'(?:higher|better|greater)\\s+(?:supplied\\s+|points?\\s+)?projection\\b|^[\u0027\u2019]s\\s+projection\\s+is\\s+(?:higher|greater)\\b|^projects?\\s+(?:higher|for more)\\b','i').test(subject);
          const lower = new RegExp(prefix+'(?:lower|smaller)\\s+(?:supplied\\s+|points?\\s+)?projection\\b|^[\u0027\u2019]s\\s+projection\\s+is\\s+(?:lower|smaller)\\b|^projects?\\s+(?:lower|for fewer)\\b','i').test(subject);
          if ((higher && comparison.projection.higherPlayerId !== player.id) || (lower && (comparison.projection.higherPlayerId === player.id || comparison.projection.higherPlayerId === null))) errors.push('projection_comparison_reversed');
        }
      }
    }
  }
  // A missing QB-change record does not supply a special QB disadvantage.
  // This deliberately targets the actual unsupported causal claim, not every
  // mention of unknown adjustments or a hypothetical pregame QB change.
  const current = [answer?.explanation,answer?.caveat].filter(v => typeof v === 'string').join('\n');
  if (/\bdepends? on (?:an?\s+)?unknown quarterback quality\b/i.test(current) &&
      !packet.players.some(p => p.facts?.some(f => f.field === 'stateChanges' && JSON.stringify(f.value).includes('QB_CHANGE')))) errors.push('unsupported_quarterback_disadvantage');
  return [...new Set(errors)];
}
module.exports = {pairComparisons, validatePairComparisons};
