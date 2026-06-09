const https = require('https');

exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const scoring = params.scoring || 'ppr';
  const teams = params.teams || '12';
  const year = '2025';

  const scoringMap = { ppr: 'ppr', half: 'half-ppr', standard: 'standard' };
  const scoringPath = scoringMap[scoring] || 'ppr';

  const url = `https://fantasyfootballcalculator.com/api/v1/adp/${scoringPath}?teams=${teams}&year=${year}&count=200`;

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'TheInnerSanctum/1.0 (theinnersanctum.xyz)',
          'Accept': 'application/json'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    const parsed = JSON.parse(data);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch ADP data', message: err.message })
    };
  }
};
