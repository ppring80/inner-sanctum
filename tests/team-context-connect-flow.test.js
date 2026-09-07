const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'team-context.js'), 'utf8');

assert.ok(
  source.includes('function watchConnectLeagueProviderForm()'),
  'team-context should watch the connect-league provider form for rerenders'
);

assert.ok(
  source.includes('new MutationObserver(function ()'),
  'connect-league team selection should use a MutationObserver so the ESPN selector survives provider-form rebuilds'
);

assert.ok(
  source.includes('observer.observe(host, { childList:true })'),
  'the observer should watch direct providerForms child replacement without observing its own ESPN step insertion'
);

assert.ok(
  source.includes('renderEspnTeamStep(LeagueConnection.getActiveConnection())'),
  'provider-form rerenders should restore the ESPN team-selection step from current connection state'
);

assert.ok(
  source.includes('watchConnectLeagueProviderForm();'),
  'the connect-league provider-form observer should initialize with the shared team context'
);

console.log('team-context-connect-flow.test.js passed');
