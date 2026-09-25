'use strict';

const STORIES = [
  {
    id: 'saquon-barkley-stinger-2026-09-24',
    featured: true,
    player: 'Saquon Barkley',
    team: 'PHI',
    position: 'RB',
    status: 'Expected to play',
    statusTone: 'expected',
    headline: 'Barkley says the MRI went well and he expects to play Monday night.',
    summary: 'The Eagles running back is dealing with a stinger suffered against Tennessee. His own update is encouraging, but Philadelphia has not issued the final game designation yet.',
    sageImpact: 'Keep Barkley in the starting lineup for now. Because he plays Monday, carry a late-game replacement until his final status is official.',
    sourceLabel: 'Jeff McLane on X',
    sourceUrl: 'https://x.com/Jeff_McLane/status/2103236479095087517',
    publishedAt: '2026-09-24T21:33:47.517Z'
  },
  {
    id: 'zay-flowers-availability-2026-09-25',
    featured: true,
    player: 'Zay Flowers',
    team: 'BAL',
    position: 'WR',
    status: 'Trending up',
    statusTone: 'expected',
    headline: 'Baltimore sounds optimistic about Flowers being available Sunday.',
    summary: 'Ravens coach Jesse Minter sounded more optimistic about Flowers and Nnamdi Madubuike than Ronnie Stanley, whose status may go to game time.',
    sageImpact: 'Flowers remains a start if active. Confirm Sunday availability before kickoff, but the latest signal is favorable rather than a reason to bench him now.',
    sourceLabel: 'Jeff Zrebiec on X',
    sourceUrl: 'https://x.com/jeffzrebiec/status/2103561938706006148',
    publishedAt: '2026-09-25T19:07:03.135Z'
  },
  {
    id: 'puka-nacua-practice-2026-09-25',
    featured: true,
    player: 'Puka Nacua',
    team: 'LAR',
    position: 'WR',
    status: 'Monitor',
    statusTone: 'monitor',
    headline: 'Nacua is working off to the side during Rams practice.',
    summary: 'Puka Nacua and Kam Kinchens were not working with the main practice group during the portion observed by reporters.',
    sageImpact: 'Do not treat this as an automatic bench call, but have a contingency ready and wait for the official designation before locking him in.',
    sourceLabel: 'Sarah Barshop on X',
    sourceUrl: 'https://x.com/sarahbarshop/status/2103562697929527641',
    publishedAt: '2026-09-25T19:10:04.148Z'
  },
  {
    id: 'nico-collins-out-2026-09-25',
    player: 'Nico Collins',
    team: 'HOU',
    position: 'WR',
    status: 'Out',
    statusTone: 'breaking',
    headline: 'Houston has ruled Collins out Sunday with a hamstring injury.',
    summary: 'The Texans made Collins unavailable for their Week 3 matchup at Indianapolis.',
    sageImpact: 'Remove Collins from every lineup. Houston’s remaining receivers and pass-catching backs gain opportunity, but none automatically inherits his full role.',
    sourceLabel: 'Adam Schefter on X',
    sourceUrl: 'https://x.com/AdamSchefter/status/2103573231278121246',
    publishedAt: '2026-09-25T19:51:55.494Z'
  },
  {
    id: 'steelers-backfield-2026-09-25',
    player: 'Rico Dowdle',
    relatedPlayers: ['Jaylen Warren'],
    team: 'PIT',
    position: 'RB',
    status: 'Out / Questionable',
    statusTone: 'breaking',
    headline: 'Dowdle is out; Warren is questionable with a shoulder injury.',
    summary: 'Pittsburgh ruled Dowdle out against Cincinnati while Warren carries a questionable designation.',
    sageImpact: 'Dowdle must come out of lineups. Warren remains usable if active, but his shoulder status makes the remaining Steelers backfield worth monitoring through Sunday.',
    sourceLabel: 'Adam Schefter on X',
    sourceUrl: 'https://x.com/AdamSchefter/status/2103572404408635804',
    publishedAt: '2026-09-25T19:48:38.353Z'
  },
  {
    id: 'bears-quarterbacks-2026-09-25',
    player: 'Caleb Williams',
    relatedPlayers: ['Tyson Bagent'],
    team: 'CHI',
    position: 'QB',
    status: 'Monitor',
    statusTone: 'monitor',
    headline: 'Williams and Bagent did not practice again.',
    summary: 'The Bears’ latest injury report showed another non-participation for both quarterbacks.',
    sageImpact: 'Avoid locking in a Bears quarterback until the starter is confirmed. The uncertainty also lowers confidence in Chicago’s pass catchers.',
    sourceLabel: 'Ian Rapoport on X',
    sourceUrl: 'https://x.com/RapSheet/status/2103569019471266046',
    publishedAt: '2026-09-25T19:35:11.321Z'
  },
  {
    id: 'brock-bowers-questionable-2026-09-25',
    player: 'Brock Bowers',
    team: 'LV',
    position: 'TE',
    status: 'Questionable',
    statusTone: 'monitor',
    headline: 'Bowers is questionable, and Las Vegas does not plan a pregame workout.',
    summary: 'Klint Kubiak said Bowers’ non-participation was planned and the team will not repeat last week’s pregame workout process.',
    sageImpact: 'Keep Bowers tentatively active, but confirm his official status. The lack of a planned pregame test suggests the Raiders expect a clearer decision before warmups.',
    sourceLabel: 'Sam Warren via Ian Rapoport',
    sourceUrl: 'https://x.com/samwarren83/status/2103557157488881864',
    publishedAt: '2026-09-25T18:48:03.204Z'
  }
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
      updatedAt: '2026-09-25T19:55:00Z',
      mode: 'editorial',
      stories: STORIES
    })
  };
};
