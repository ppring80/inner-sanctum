"use strict";

const assert = require("assert");
const { handler } = require("../netlify/functions/instagram-publish.js");

const original = {
  token: process.env.INSTAGRAM_ACCESS_TOKEN,
  accountId: process.env.INSTAGRAM_ACCOUNT_ID,
  publishKey: process.env.INSTAGRAM_PUBLISH_KEY,
};

function upstream(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

(async () => {
  process.env.INSTAGRAM_ACCESS_TOKEN = "private-token";
  process.env.INSTAGRAM_ACCOUNT_ID = "27676522198688915";
  process.env.INSTAGRAM_PUBLISH_KEY = "private-publish-key";

  const receipts = new Map();
  const store = {
    async get(key) { return receipts.get(key) || null; },
    async setJSON(key, value) { receipts.set(key, value); },
  };
  const baseEvent = {
    httpMethod: "POST",
    headers: { "x-instagram-publish-key": "private-publish-key" },
  };

  try {
    let result = await handler({ ...baseEvent, httpMethod: "GET" }, { store });
    assert.strictEqual(result.statusCode, 405);

    result = await handler({ ...baseEvent, headers: {}, body: "{}" }, { store });
    assert.strictEqual(result.statusCode, 401);

    result = await handler({ ...baseEvent, body: JSON.stringify({
      confirmPublish: false,
      idempotencyKey: "week2-news",
      caption: "Test",
      imageUrls: ["https://theinnersanctum.xyz/assets/instagram/slide-1.png"],
    }) }, { store });
    assert.strictEqual(JSON.parse(result.body).error, "publish_confirmation_required");

    result = await handler({ ...baseEvent, body: JSON.stringify({
      confirmPublish: true,
      idempotencyKey: "week2-news",
      caption: "Test",
      imageUrls: ["https://evil.example/slide.png"],
    }) }, { store });
    assert.strictEqual(JSON.parse(result.body).error, "unapproved_image_host");

    const calls = [];
    let containerNumber = 0;
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (url.includes("fields=status_code")) return upstream({ status_code: "FINISHED" });
      if (url.includes("media_publish")) return upstream({ id: "published-123" });
      containerNumber += 1;
      return upstream({ id: `container-${containerNumber}` });
    };

    const payload = {
      confirmPublish: true,
      idempotencyKey: "week2-news",
      caption: "The board changed.",
      imageUrls: [
        "https://theinnersanctum.xyz/assets/instagram/slide-1.png",
        "https://theinnersanctum.xyz/assets/instagram/slide-2.png",
      ],
    };
    result = await handler({ ...baseEvent, body: JSON.stringify(payload) }, {
      store,
      fetch: fetchImpl,
      wait: async () => {},
    });
    assert.strictEqual(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.duplicate, false);
    assert.strictEqual(body.mediaId, "published-123");
    assert.strictEqual(calls.filter((call) => call.url.endsWith("/media")).length, 3);
    assert.strictEqual(calls.some((call) => String(call.options.body).includes("media_type=CAROUSEL")), true);
    assert.strictEqual(calls.every((call) => !call.url.includes("private-token")), true);
    assert.strictEqual(JSON.stringify(calls).includes("private-publish-key"), false);

    const callCount = calls.length;
    result = await handler({ ...baseEvent, body: JSON.stringify(payload) }, {
      store,
      fetch: fetchImpl,
      wait: async () => {},
    });
    assert.strictEqual(JSON.parse(result.body).duplicate, true);
    assert.strictEqual(calls.length, callCount);

    console.log("Instagram publishing tests passed.");
  } finally {
    if (original.token === undefined) delete process.env.INSTAGRAM_ACCESS_TOKEN;
    else process.env.INSTAGRAM_ACCESS_TOKEN = original.token;
    if (original.accountId === undefined) delete process.env.INSTAGRAM_ACCOUNT_ID;
    else process.env.INSTAGRAM_ACCOUNT_ID = original.accountId;
    if (original.publishKey === undefined) delete process.env.INSTAGRAM_PUBLISH_KEY;
    else process.env.INSTAGRAM_PUBLISH_KEY = original.publishKey;
  }
})().catch((error) => { console.error(error); process.exit(1); });
