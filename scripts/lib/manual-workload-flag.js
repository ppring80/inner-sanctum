'use strict';

// Manual Newswire pilot policy. The caller supplies a server-verified admin
// identity, trusted clock, and server-resolved game and evidence records.
function reviewWorkloadFlag({draft, action, actor, now, preview}) {
  if (actor?.isAdmin !== true || !actor.id) throw new Error('Admin required');
  if (!draft || !Number.isFinite(Date.parse(now))) throw new Error('Invalid flag');
  if (action === 'withdraw' && draft.state === 'approved') {
    return {...draft, state:'withdrawn', withdrawnBy:actor.id, withdrawnAt:now};
  }
  if (action !== 'approve' || draft.state !== 'draft') throw new Error('Invalid transition');
  const event = draft.event;
  if (!event || !Number.isFinite(Date.parse(event.kickoff)) ||
      Date.parse(now) >= Date.parse(event.kickoff) ||
      event.status !== 'OUT' || event.statusVerified !== true ||
      event.successorRole !== 'EXPECTED_LEAD' || event.roleVerified !== true ||
      !event.statusSource || !event.roleSource ||
      !preview || preview.applied !== true || preview.flagId !== draft.id ||
      preview.revision !== draft.revision || !draft.id || !draft.revision ||
      !Number.isFinite(Date.parse(preview.baselineAt))) throw new Error('Verified preview required');
  return {...draft, state:'approved', approvedBy:actor.id, approvedAt:now, baselineAt:preview.baselineAt};
}
module.exports = { reviewWorkloadFlag };
