'use strict';

const STORIES = [
  {
    id: 'saquon-barkley-stinger-2026-09-24',
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
      updatedAt: '2026-09-25T19:35:00Z',
      mode: 'editorial',
      stories: STORIES
    })
  };
};
