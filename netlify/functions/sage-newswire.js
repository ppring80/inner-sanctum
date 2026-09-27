'use strict';

const NFL_REPORT = 'https://www.nfl.com/news/week-3-injuries-sunday-pregame-2026-nfl-season';
const story = (id, player, team, position, status, statusTone, headline, summary, sageImpact, publishedAt, extra = {}) => ({
  id, player, team, position, status, statusTone, headline, summary, sageImpact,
  sourceLabel: 'NFL Week 3 Sunday injury update', sourceUrl: NFL_REPORT, publishedAt, ...extra
});

const STORIES = [
  story(
    'zay-flowers-gtd-2026-09-27', 'Zay Flowers', 'BAL', 'WR', 'Questionable', 'breaking',
    'Flowers is a true game-time decision and will test his hamstring pregame.',
    'Flowers returned to a limited Friday practice after missing Wednesday and Thursday. Baltimore says he has a real opportunity to play, but his hamstring remains a legitimate pregame decision.',
    'Keep Flowers ranked but apply a meaningful availability/floor penalty. Managers should have a late-window pivot ready and should not treat him as a locked starter.',
    '2026-09-27T14:20:00Z',
    { featured: true, sourceLabel: 'Baltimore Ravens / NFL Sunday update', sourceUrl: 'https://www.baltimoreravens.com/' }
  ),
  story(
    'puka-nacua-doubtful-2026-09-27', 'Puka Nacua', 'LAR', 'WR', 'Doubtful', 'breaking',
    'Nacua remains doubtful for Sunday night after missing practice all week.',
    'Los Angeles has Nacua listed doubtful. Sean McVay has indicated doubtful means he is more unlikely than likely to play.',
    'Treat Nacua as highly unlikely to play. Do not wait for Sunday night without a viable pivot; raise the target outlook for the Rams’ healthy receivers and tight ends.',
    '2026-09-27T14:18:00Z',
    { featured: true, sourceLabel: 'NFL.com', sourceUrl: 'https://www.nfl.com/news/rams-puka-nacua-doubtful-to-play-sunday-night-broncos' }
  ),
  story(
    'nico-collins-out-2026-09-27', 'Nico Collins', 'HOU', 'WR', 'Out', 'breaking',
    'Collins is out for Week 3.',
    'Houston will be without Collins against Indianapolis, removing its top outside target from the active receiving rotation.',
    'Remove Collins from WR rankings and start/sit consideration. Reallocate targets toward Houston’s healthy receivers and tight ends.',
    '2026-09-27T14:16:00Z',
    { featured: true, sourceLabel: 'Houston Texans injury report', sourceUrl: 'https://www.houstontexans.com/news/week-3-injury-report-texans-at-colts' }
  ),
  story(
    'caleb-williams-out-2026-09-27', 'Caleb Williams', 'CHI', 'QB', 'Out', 'breaking',
    'Williams is out for Week 3 with a hamstring injury.',
    'Chicago will be without Williams for the Monday night matchup.',
    'Remove Williams from QB rankings. Downgrade Bears pass catchers until the replacement quarterback situation is fully settled.',
    '2026-09-27T14:14:00Z',
    { featured: true }
  ),
  story(
    'jayden-daniels-out-2026-09-27', 'Jayden Daniels', 'WSH', 'QB', 'Out', 'breaking',
    'Daniels is out; Marcus Mariota will start.',
    'Washington has ruled Daniels out for Week 3.',
    'Remove Daniels from QB rankings. Mariota becomes a superflex/2QB option; apply a modest efficiency downgrade to Washington pass catchers.',
    '2026-09-27T14:12:00Z',
    { relatedPlayers: ['Marcus Mariota'] }
  ),
  story(
    'kyler-murray-cleared-2026-09-27', 'Kyler Murray', 'MIN', 'QB', 'Cleared', 'expected',
    'Murray has cleared concussion protocol and is set to start.',
    'Minnesota gets Murray back under center for Week 3.',
    'Restore Murray to the active QB pool and normalize the outlook for Minnesota pass catchers.',
    '2026-09-27T14:10:00Z'
  ),
  story(
    'sam-darnold-cleared-2026-09-27', 'Sam Darnold', 'SEA', 'QB', 'Cleared', 'expected',
    'Darnold is cleared and will start.',
    'Seattle removed the quarterback uncertainty after Darnold worked through his glute issue.',
    'Keep Darnold active in QB/superflex rankings and restore normal Seattle passing-game expectations.',
    '2026-09-27T14:08:00Z'
  ),
  story(
    'brock-bowers-questionable-2026-09-27', 'Brock Bowers', 'LV', 'TE', 'Questionable', 'monitor',
    'Bowers remains questionable with a knee issue.',
    'Bowers enters Sunday without a clean designation and needs final active-status confirmation.',
    'Keep him ranked because of positional scarcity, but carry a same-window TE fallback.',
    '2026-09-27T14:06:00Z'
  ),
  story(
    'dallas-goedert-out-2026-09-27', 'Dallas Goedert', 'PHI', 'TE', 'Out', 'breaking',
    'Goedert is out for Week 3.',
    'Philadelphia will be without Goedert for Monday night.',
    'Remove Goedert from TE rankings. Philadelphia receiving volume consolidates among its healthy wideouts and remaining tight ends.',
    '2026-09-27T14:04:00Z'
  ),
  story(
    'saquon-barkley-cleared-2026-09-27', 'Saquon Barkley', 'PHI', 'RB', 'No designation', 'expected',
    'Barkley has no final game designation and is expected to play.',
    'The earlier stinger concern did not result in a Week 3 game-status tag.',
    'Remove the injury-driven suppression from Barkley’s RB ranking and treat him as a normal start.',
    '2026-09-27T14:02:00Z'
  ),
  story(
    'jonah-coleman-out-2026-09-27', 'Jonah Coleman', 'DEN', 'RB', 'Out', 'breaking',
    'Coleman is out for Week 3.',
    'Denver will play without Coleman against the Rams.',
    'Remove Coleman from RB rankings and redistribute backfield opportunity to Denver’s healthy backs.',
    '2026-09-27T14:00:00Z'
  ),
  story(
    'rico-dowdle-out-2026-09-27', 'Rico Dowdle', 'PIT', 'RB', 'Out', 'breaking',
    'Dowdle is out for Week 3.',
    'Pittsburgh will be without Dowdle, while Jaylen Warren remains a status to monitor.',
    'Remove Dowdle. Warren’s workload ceiling rises if active, but managers should retain a contingency because of Warren’s shoulder issue.',
    '2026-09-27T13:58:00Z',
    { relatedPlayers: ['Jaylen Warren'] }
  ),
  story(
    'marquise-brown-out-2026-09-27', 'Marquise Brown', 'KC', 'WR', 'Out', 'breaking',
    'Brown is out for Week 3.',
    'Kansas City will be without Brown because of an ankle injury.',
    'Remove Brown from WR rankings and slightly boost the target share for Kansas City’s healthy receivers and tight ends.',
    '2026-09-27T13:56:00Z'
  ),
  story(
    'alec-pierce-out-2026-09-27', 'Alec Pierce', 'IND', 'WR', 'Out', 'breaking',
    'Pierce is out for Week 3.',
    'Indianapolis ruled Pierce out with a heel injury.',
    'Remove Pierce from WR rankings and bump route/target opportunity for the Colts’ healthy receivers.',
    '2026-09-27T13:54:00Z'
  ),
  story(
    'devonta-smith-cleared-2026-09-27', 'DeVonta Smith', 'PHI', 'WR', 'No designation', 'expected',
    'Smith has no Week 3 game designation.',
    'Smith finished the week as a full participant and is cleared for Monday night.',
    'Remove the injury penalty and rank Smith normally for Week 3.',
    '2026-09-27T13:52:00Z'
  )
];

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'GET' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=120'
    },
    body: JSON.stringify({
      version: 1,
      updatedAt: '2026-09-27T14:20:00Z',
      mode: 'editorial',
      stories: STORIES
    })
  };
};
