
const https = require('https');

exports.handler = async function(event) {
  const body = JSON.parse(event.body);
  
  const payload = {
    model: "claude-sonnet-4-5",
    max_tokens: 1000,
    system: body.system,
    messages: body.messages,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search"
      }
    ]
  };

  const response = await new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });

  const parsed = JSON.parse(response);
  const text = parsed.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: [{ type: 'text', text: text }] })
  };
};
