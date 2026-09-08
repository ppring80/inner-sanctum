const path = require('path');
const crypto = require('crypto');

process.env.COOKIE_SIGNING_SECRET = 'test-secret-p0';

const sageRecommend = require(path.join(__dirname, '..', 'netlify', 'functions', 'sage-recommend.js'));
const draftInviteSession = require(path.join(__dirname, '..', 'netlify', 'functions', 'draft-invite-session.js'));
const oauthCallback = require(path.join(__dirname, '..', 'netlify', 'functions', 'oauth-callback.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sign(payload, secret) {
  const encoded = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encoded}.${sig}`;
}

function samplePlayer(name, pos, adp) {
  return { name, pos, adp: adp || 50, team: 'XXX' };
}

async function run() {
  const secret = process.env.COOKIE_SIGNING_SECRET;

  // Build real, validly-signed cookies for each path
  const validPatreonSession = sign({ fullAccess: true, exp: Date.now() + 3600000 }, secret);
  const validDraftSession = sign({ scope: 'draft_sage_access', exp: Date.now() + 3600000 }, secret);
  const wrongScopeSession = sign({ scope: 'something_else', exp: Date.now() + 3600000 }, secret);
  const expiredDraftSession = sign({ scope: 'draft_sage_access', exp: Date.now() - 1000 }, secret);

  console.log('=== AUTH: hasDraftSageAccess isolation ===');
  {
    const eventWithDraft = { headers: { cookie: `draft_sage_session=${validDraftSession}` } };
    check('Valid draft_sage_session grants hasDraftSageAccess', sageRecommend._test.hasDraftSageAccess(eventWithDraft) === true);

    const eventWrongScope = { headers: { cookie: `draft_sage_session=${wrongScopeSession}` } };
    check('Wrong-scope signed cookie does NOT grant hasDraftSageAccess', sageRecommend._test.hasDraftSageAccess(eventWrongScope) === false);

    const eventExpired = { headers: { cookie: `draft_sage_session=${expiredDraftSession}` } };
    check('Expired draft_sage_session does NOT grant access', sageRecommend._test.hasDraftSageAccess(eventExpired) === false);

    const eventNone = { headers: {} };
    check('No cookie at all -> hasDraftSageAccess false', sageRecommend._test.hasDraftSageAccess(eventNone) === false);

    // Isolation: a draft_sage_session cookie must never satisfy hasFullAcolyteAccess
    const result = await sageRecommend._test.hasFullAcolyteAccess(eventWithDraft);
    check('draft_sage_session cookie never satisfies hasFullAcolyteAccess (isolation)', result === false);
  }

  console.log('\n=== AUTH: full handler integration ===');
  const basePayload = {
    candidates: [samplePlayer('Available Star', 'RB', 5)],
    currentPool: [samplePlayer('Available Star', 'RB', 5)],
    nextTurnPool: [],
    currentPick: 1,
    nextUserPick: 13,
    scoring: 'ppr',
    rosterContext: { remainingDedicated: { QB:1,RB:2,WR:2,TE:1,K:1,DEF:1 }, remainingFlex:1, flexEligible:['RB','WR','TE'] }
  };

  {
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(basePayload) });
    check('Anonymous request (no cookies) still returns 403', res.statusCode === 403);
  }
  {
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: { cookie: `sanctum_session=${validPatreonSession}` }, body: JSON.stringify(basePayload) });
    check('Valid Patreon fullAccess session returns 200', res.statusCode === 200);
    const data = JSON.parse(res.body);
    check('Valid Patreon session returns recommendations array', Array.isArray(data.recommendations));
  }
  {
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: { cookie: `draft_sage_session=${validDraftSession}` }, body: JSON.stringify(basePayload) });
    check('Valid Draft-scoped session returns 200 with recommendations', res.statusCode === 200 && Array.isArray(JSON.parse(res.body).recommendations));
  }
  {
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: { cookie: `draft_sage_session=${wrongScopeSession}` }, body: JSON.stringify(basePayload) });
    check('Wrong-scope cookie on full handler still returns 403', res.statusCode === 403);
  }

  console.log('\n=== AVAILABILITY: drafted-player filtering ===');
  const authHeaders = { cookie: `draft_sage_session=${validDraftSession}` };

  {
    // Drafted player present in candidates -- must not appear in recommendations
    const payload = Object.assign({}, basePayload, {
      candidates: [samplePlayer('Drafted Guy', 'RB', 3), samplePlayer('Available Guy', 'WR', 8)],
      currentPool: [samplePlayer('Drafted Guy', 'RB', 3), samplePlayer('Available Guy', 'WR', 8)],
      draftedPlayers: [{ name: 'Drafted Guy', pos: 'RB' }]
    });
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
    const data = JSON.parse(res.body);
    check('Drafted player in candidates never appears in recommendations', !data.recommendations.some(r => r.player.name === 'Drafted Guy'));
  }
  {
    // Drafted player present only in currentPool (used for scarcity signals) -- confirm it's removed from that pool's effect too by re-checking recommendations never surfaces them
    const payload = Object.assign({}, basePayload, {
      candidates: [samplePlayer('Available Guy 2', 'WR', 8)],
      currentPool: [samplePlayer('Drafted In Pool', 'RB', 3), samplePlayer('Available Guy 2', 'WR', 8)],
      draftedPlayers: [{ name: 'Drafted In Pool', pos: 'RB' }]
    });
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
    const data = JSON.parse(res.body);
    check('Drafted player present only in currentPool never appears in recommendations', !data.recommendations.some(r => r.player.name === 'Drafted In Pool'));
  }
  {
    // Drafted player present in nextTurnPool
    const payload = Object.assign({}, basePayload, {
      candidates: [samplePlayer('Available Guy 3', 'WR', 8)],
      nextTurnPool: [samplePlayer('Drafted Next Turn', 'RB', 3)],
      draftedPlayers: [{ name: 'Drafted Next Turn', pos: 'RB' }]
    });
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
    check('Handler does not error with drafted player in nextTurnPool', res.statusCode === 200);
  }
  {
    // Apostrophe/suffix normalization consistency
    const payload = Object.assign({}, basePayload, {
      candidates: [samplePlayer("Ja'Marr Chase", 'WR', 2), samplePlayer('Available Guy 4', 'RB', 9)],
      currentPool: [samplePlayer("Ja'Marr Chase", 'WR', 2), samplePlayer('Available Guy 4', 'RB', 9)],
      draftedPlayers: [{ name: 'Jamarr Chase', pos: 'WR' }] // different apostrophe/casing form
    });
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
    const data = JSON.parse(res.body);
    check('Apostrophe/suffix variant normalization matches consistently', !data.recommendations.some(r => r.player.name === "Ja'Marr Chase"));
  }
  {
    // Stale/malicious payload: drafted star player present in candidates AND (correctly) in draftedPlayers -- confirms it cannot slip through
    const payload = Object.assign({}, basePayload, {
      candidates: [samplePlayer('Star Player', 'RB', 1), samplePlayer('Backup Option', 'WR', 15)],
      currentPool: [samplePlayer('Star Player', 'RB', 1), samplePlayer('Backup Option', 'WR', 15)],
      nextTurnPool: [samplePlayer('Star Player', 'RB', 1)],
      draftedPlayers: [{ name: 'Star Player', pos: 'RB' }]
    });
    const res = await sageRecommend.handler({ httpMethod: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
    const data = JSON.parse(res.body);
    check('Malicious/stale payload with drafted star player cannot return that player', !data.recommendations.some(r => r.player.name === 'Star Player'));
    check('A genuinely available player still comes through normally', data.recommendations.some(r => r.player.name === 'Backup Option'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
