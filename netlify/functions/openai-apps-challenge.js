'use strict';

/**
 * OpenAI Plugin Domain Verification
 *
 * OpenAI verifies ownership of theinnersanctum.xyz by requesting:
 *
 *   https://theinnersanctum.xyz/.well-known/openai-apps-challenge
 *
 * netlify.toml rewrites that public URL to this function.
 *
 * IMPORTANT:
 * The response body must contain the OpenAI verification token exactly.
 */

const OPENAI_APPS_CHALLENGE =
  'p82lzRZYQmucdo9RSrr1cJaSQajCHGtBgIDU_bjbsCM';

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Allow': 'GET, HEAD',
        'Cache-Control': 'no-store',
      },
      body: 'Method Not Allowed',
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: event.httpMethod === 'HEAD' ? '' : OPENAI_APPS_CHALLENGE,
  };
};
