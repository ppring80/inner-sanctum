const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function loadHandlerWithEnv(env) {
  const modPath = path.join(__dirname, '..', 'netlify', 'functions', 'draft-invite-session.js');
  delete require.cache[require.resolve(modPath)];
  const savedEnv = {};
  Object.keys(env).forEach(k => { savedEnv[k] = process.env[k]; process.env[k] = env[k]; });
  // Also explicitly clear keys not in env, to isolate each test
  ['DRAFT_INVITE_PASSCODE', 'COOKIE_SIGNING_SECRET'].forEach(k => {
    if (!(k in env)) delete process.env[k];
  });
  const mod = require(modPath);
  return { mod, restore: () => Object.keys(savedEnv).forEach(k => { process.env[k] = savedEnv[k]; }) };
}

async function run() {
  console.log('=== draft-invite-session.js ===');

  // 1. Valid passcode -> 200, cookie set with correct name/scope
  {
    const { mod } = loadHandlerWithEnv({ DRAFT_INVITE_PASSCODE: 'CBS-MONEY-2026', COOKIE_SIGNING_SECRET: 'test-secret' });
    const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify({ passcode: 'CBS-MONEY-2026' }) });
    check('1. Valid passcode returns 200', res.statusCode === 200);
    const setCookie = res.headers['Set-Cookie'] || '';
    check('1. Set-Cookie uses draft_sage_session name', setCookie.startsWith('draft_sage_session='));
    check('1. Cookie is HttpOnly', setCookie.includes('HttpOnly'));
    check('1. Cookie is Secure', setCookie.includes('Secure'));
    check('1. Cookie has 8-hour Max-Age (28800)', setCookie.includes('Max-Age=28800'));
    // Decode and verify scope
    const cookieVal = setCookie.split(';')[0].split('=')[1];
    const [encodedPayload] = cookieVal.split('.');
    const payload = JSON.parse(mod._test.base64urlEncode ? Buffer.from(encodedPayload.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8') : '{}');
    check('1. Signed payload scope is draft_sage_access', payload.scope === 'draft_sage_access');
    check('1. Signed payload has a future exp', typeof payload.exp === 'number' && payload.exp > Date.now());
  }

  // 2. Wrong passcode -> 403, no cookie
  {
    const { mod } = loadHandlerWithEnv({ DRAFT_INVITE_PASSCODE: 'CBS-MONEY-2026', COOKIE_SIGNING_SECRET: 'test-secret' });
    const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify({ passcode: 'WRONG' }) });
    check('2. Wrong passcode returns 403', res.statusCode === 403);
    check('2. No Set-Cookie on wrong passcode', !res.headers || !res.headers['Set-Cookie']);
  }

  // 3. Missing DRAFT_INVITE_PASSCODE -> fails closed, 503, no cookie
  {
    const { mod } = loadHandlerWithEnv({ COOKIE_SIGNING_SECRET: 'test-secret' });
    const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify({ passcode: 'ANYTHING' }) });
    check('3. Missing DRAFT_INVITE_PASSCODE fails closed with 503', res.statusCode === 503);
    check('3. No Set-Cookie when config missing', !res.headers || !res.headers['Set-Cookie']);
  }

  // 3b. Even the literal string "SANCTUM-TEST" does not work when unconfigured
  {
    const { mod } = loadHandlerWithEnv({ COOKIE_SIGNING_SECRET: 'test-secret' });
    const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify({ passcode: 'SANCTUM-TEST' }) });
    check('3b. No SANCTUM-TEST fallback when DRAFT_INVITE_PASSCODE unset', res.statusCode === 503);
  }

  // 4. Missing COOKIE_SIGNING_SECRET -> fails closed too
  {
    const { mod } = loadHandlerWithEnv({ DRAFT_INVITE_PASSCODE: 'CBS-MONEY-2026' });
    const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify({ passcode: 'CBS-MONEY-2026' }) });
    check('4. Missing COOKIE_SIGNING_SECRET fails closed with 503', res.statusCode === 503);
  }

  // 5. Grep-level confirmation: no hardcoded fallback passcode anywhere in the file
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'draft-invite-session.js'), 'utf8');
    check('5. File contains no "SANCTUM-TEST" fallback string', !src.includes('SANCTUM-TEST'));
  }

  // 6. OPTIONS handled
  {
    const { mod } = loadHandlerWithEnv({ DRAFT_INVITE_PASSCODE: 'x', COOKIE_SIGNING_SECRET: 'y' });
    const res = await mod.handler({ httpMethod: 'OPTIONS' });
    check('6. OPTIONS returns 204', res.statusCode === 204);
  }

  // 7. Non-POST rejected
  {
    const { mod } = loadHandlerWithEnv({ DRAFT_INVITE_PASSCODE: 'x', COOKIE_SIGNING_SECRET: 'y' });
    const res = await mod.handler({ httpMethod: 'GET' });
    check('7. GET returns 405', res.statusCode === 405);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
