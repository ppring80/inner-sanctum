// ═══════════════════════════════════════
// VOICE IDS — one per persona
// Set in code (not secret) since these are
// public ElevenLabs library voice references,
// not credentials.
// ═══════════════════════════════════════
const VOICE_IDS = {
  oracle:  "6sFKzaJr574YWVu4UuJF",
  trash:   "2vubyVoGjNJ5HPga4SkV",
  analyst: "g2W4HAjKvdW93AmsjsOx"
};

// ═══════════════════════════════════════
// ALLOWED ORIGINS
// Mirrors chat.js — set ALLOWED_ORIGINS in
// Netlify environment variables to add CI
// testers or localhost without touching code.
// ═══════════════════════════════════════
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["https://theinnersanctum.xyz"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// ═══════════════════════════════════════
// CHARACTER LIMIT PER REQUEST
// Keeps a single call well under ElevenLabs'
// per-request ceiling and bounds worst-case
// monthly character spend per response.
// ═══════════════════════════════════════
const MAX_CHARS = 1000;

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════
exports.handler = async (event) => {

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  // ── Origin check ──────────────────────────────────────────
  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!originAllowed) {
    console.log(`Blocked request from origin: ${origin}`);
    return {
      statusCode: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Forbidden" })
    };
  }

  try {
    const { text, persona } = JSON.parse(event.body);

    if (!text || typeof text !== "string") {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing or invalid 'text'" })
      };
    }

    const voiceId = VOICE_IDS[persona];
    if (!voiceId) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: `Unknown persona: ${persona}` })
      };
    }

    // Truncate defensively — caller should already be sending
    // single-response-length text, but this is a hard backstop
    // against unexpectedly long input driving up character spend.
    const safeText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: safeText,
          model_id: "eleven_flash_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      }
    );

    if (!elevenRes.ok) {
      const errBody = await elevenRes.text();
      console.log(`ElevenLabs API error: ${elevenRes.status} — ${errBody}`);
      return {
        statusCode: elevenRes.status === 429 ? 429 : 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Voice generation unavailable" })
      };
    }

    // ElevenLabs returns raw MP3 bytes. Netlify Functions require
    // binary responses to be base64-encoded with isBase64Encoded
    // set to true — this is the one structural difference from
    // chat.js, which returns plain JSON.
    const audioBuffer = await elevenRes.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "audio/mpeg"
      },
      body: audioBase64,
      isBase64Encoded: true
    };

  } catch (err) {
    console.log("Handler error:", err.message);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
