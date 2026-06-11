cconst Anthropic = require("@anthropic-ai/sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { model, max_tokens, system, messages } = JSON.parse(event.body);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model,
      max_tokens,
      system,
      messages,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search"
        }
      ]
    });

    // Pull all text blocks out of the response
    const fullText = response.content
      .map(block => block.type === "text" ? block.text : "")
      .filter(Boolean)
      .join("\n");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text: fullText }] }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
