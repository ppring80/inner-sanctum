'use strict';
const assert=require('node:assert/strict'),{rosterSnapshot}=require('../netlify/functions/_club-availability-reconciliation');
const html=`<h4 class="nfl-o-roster__title"><span class="nfl-o-roster__title-status">Active</span></h4><table><tr><th>Player</th><th>Pos</th></tr><tr><td><a href="/team/players-roster/andre-sam/" title="Andre' Sam">Andre' Sam</a></td><td>S</td></tr></table>`;
const opts={team:'PHI',sourceUrl:'https://www.philadelphiaeagles.com/team/players-roster/',observedAt:'2026-10-13T03:00:00Z'};
assert.equal(rosterSnapshot(html,opts).rows[0].name,"Andre' Sam");
assert.equal(rosterSnapshot(html.replace('title="Andre\' Sam"','title="Andre&#x27; Sam"'),opts).rows[0].name,"Andre' Sam");
assert.equal(rosterSnapshot(html.replace('title="Andre\' Sam"',"title='Andre Sam'"),opts).rows[0].name,'Andre Sam');
console.log('PASS: quoted roster identity preserves apostrophes and decodes apostrophe references.');
