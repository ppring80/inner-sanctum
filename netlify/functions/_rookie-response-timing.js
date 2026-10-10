'use strict';
// Decorate the current response only. Never mutate a persisted model artifact.
function finishRookieResponse({ body, headers, timing }) {
  let updated = body;
  const add = value => {
    if (value?.result?.structuredContent) {
      value.result.structuredContent.responseTiming = { ...timing };
      // The existing reader's declared artifact map also carries diagnostics,
      // so clients with its older output schema can still receive timings.
      if (value.result.structuredContent.artifact) {
        value.result.structuredContent.artifact.responseTiming = { ...timing };
      }
    }
    return JSON.stringify(value);
  };
  try {
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    if (/application\/json/i.test(contentType)) updated = add(JSON.parse(body));
    else if (/text\/event-stream/i.test(contentType)) {
      updated = body.replace(/^data: (\{[^\r\n]*\})$/gm, (_line, json) => 'data: ' + add(JSON.parse(json)));
    }
  } catch { updated = body; }
  return {
    body: updated,
    headers: {
      ...headers,
      'x-rookie-request-id': timing.requestId,
      'server-timing': `handler;dur=${timing.handlerTotalMs}, mcp;dur=${timing.mcpFetchMs}, response_read;dur=${timing.responseReadMs}`,
      'access-control-expose-headers': 'WWW-Authenticate, Server-Timing, X-Rookie-Request-Id'
    }
  };
}
module.exports = { finishRookieResponse };
