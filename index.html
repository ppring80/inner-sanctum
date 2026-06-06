import { useState, useRef, useEffect } from "react";

const PERSONAS = {
  oracle: {
    id: "oracle",
    name: "The Oracle",
    title: "38 Seasons of Wisdom",
    emoji: "🔮",
    color: "#c9a84c",
    accent: "#1a1a2e",
    systemPrompt: `You are "The Oracle" — a wise, all-knowing fantasy football sage with 38 years of experience. You speak with gravitas, dropping hard-won wisdom, historical context, and deep knowledge. You reference legendary players from past eras (Jerry Rice, Barry Sanders, Emmitt Smith, etc.) to illustrate modern advice. You're not arrogant — you're genuinely wise and want to help. Your tone is warm but authoritative, like a beloved mentor. You occasionally use mystical/sage language ("I have seen this before...", "The football gods have shown me...", "In the ancient seasons of '94..."). Keep responses to 3-5 sentences max. Always give concrete actionable fantasy football advice wrapped in your sage persona.`,
    placeholder: "Ask the Oracle for wisdom...",
    greeting: "I have watched 38 seasons come and go, witnessed dynasties rise and fall. Ask, and I shall illuminate your path to fantasy glory.",
  },
  trash: {
    id: "trash",
    name: "The Trash Lord",
    title: "Certified League Villain",
    emoji: "🔥",
    color: "#ff4444",
    accent: "#0a0a0a",
    systemPrompt: `You are "The Trash Lord" — the ultimate fantasy football trash talker and hype machine. You are brutally snarky, hilarious, and savage but never genuinely mean. You roast bad decisions, hype up good ones, and deliver spicy hot takes. You're like that one league member everyone loves to hate. Use sports slang, dramatic reactions, ALL CAPS for emphasis occasionally, and playful trash talk. Reference current NFL players and fantasy football culture. Keep it fun and never actually cruel. You also give real fantasy advice but wrapped in maximum bravado. Keep responses to 3-5 sentences max. Be funny, be bold, be the chaos agent your league deserves.`,
    placeholder: "Brace yourself for the truth...",
    greeting: "Oh you actually showed up? Bold move from someone who started a bye week player last week. Let's hear your sad little fantasy problem. 😂",
  },
};

const SUGGESTED_QUESTIONS = [
  "Should I start or sit my RB this week?",
  "Help me decide on a trade",
  "Who should I pick up on waivers?",
  "Rate my team's chances this season",
  "Give me a hot take on my roster",
];

export default function FantasyOracle() {
  const [activePersona, setActivePersona] = useState("oracle");
  const [messages, setMessages] = useState({
    oracle: [],
    trash: [],
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showGreeting, setShowGreeting] = useState({ oracle: true, trash: true });
  const messagesEndRef = useRef(null);
  const persona = PERSONAS[activePersona];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activePersona]);

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user", content: text };
    const currentMessages = [...messages[activePersona], userMsg];

    setMessages((prev) => ({ ...prev, [activePersona]: currentMessages }));
    setInput("");
    setLoading(true);
    setShowGreeting((prev) => ({ ...prev, [activePersona]: false }));

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: persona.systemPrompt,
          messages: currentMessages,
        }),
      });
      const data = await response.json();
      const reply = data.content?.map((b) => b.text).join("") || "The spirits are silent. Try again.";
      setMessages((prev) => ({
        ...prev,
        [activePersona]: [...currentMessages, { role: "assistant", content: reply }],
      }));
    } catch {
      setMessages((prev) => ({
        ...prev,
        [activePersona]: [
          ...currentMessages,
          { role: "assistant", content: "The mystical connection was severed. Try again." },
        ],
      }));
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const currentMsgs = messages[activePersona];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080810",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "0",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Background texture */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        background: "radial-gradient(ellipse at 20% 50%, #1a0a2e 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #0a1a0a 0%, transparent 60%)",
        pointerEvents: "none",
      }} />

      {/* Stars */}
      {[...Array(30)].map((_, i) => (
        <div key={i} style={{
          position: "fixed",
          width: Math.random() * 2 + 1 + "px",
          height: Math.random() * 2 + 1 + "px",
          background: "#fff",
          borderRadius: "50%",
          top: Math.random() * 100 + "%",
          left: Math.random() * 100 + "%",
          opacity: Math.random() * 0.5 + 0.1,
          animation: `twinkle ${Math.random() * 3 + 2}s infinite alternate`,
          zIndex: 0,
        }} />
      ))}

      <style>{`
        @keyframes twinkle { from { opacity: 0.1; } to { opacity: 0.7; } }
        @keyframes glow { from { text-shadow: 0 0 10px currentColor; } to { text-shadow: 0 0 30px currentColor, 0 0 60px currentColor; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { from { box-shadow: 0 0 0 0 rgba(201,168,76,0.4); } to { box-shadow: 0 0 0 12px rgba(201,168,76,0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .msg-bubble { animation: slideUp 0.3s ease forwards; }
        textarea:focus { outline: none; }
        textarea { resize: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
      `}</style>

      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: "720px",
        display: "flex", flexDirection: "column", height: "100vh",
      }}>

        {/* Header */}
        <div style={{
          padding: "20px 24px 0",
          textAlign: "center",
        }}>
          <div style={{
            fontSize: "11px", letterSpacing: "4px", color: "#555",
            textTransform: "uppercase", marginBottom: "6px",
          }}>Fantasy Football AI</div>
          <h1 style={{
            margin: "0 0 4px",
            fontSize: "26px",
            fontWeight: "700",
            color: "#e8d5a3",
            letterSpacing: "1px",
          }}>The Inner Sanctum</h1>
          <div style={{ fontSize: "12px", color: "#444", marginBottom: "16px" }}>
            Choose your counsel wisely
          </div>

          {/* Persona Switcher */}
          <div style={{
            display: "flex", gap: "10px", justifyContent: "center", marginBottom: "8px",
          }}>
            {Object.values(PERSONAS).map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePersona(p.id)}
                style={{
                  flex: 1,
                  maxWidth: "220px",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  border: `2px solid ${activePersona === p.id ? p.color : "#222"}`,
                  background: activePersona === p.id
                    ? `linear-gradient(135deg, ${p.color}22, ${p.color}11)`
                    : "#111",
                  color: activePersona === p.id ? p.color : "#555",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  textAlign: "left",
                }}
              >
                <div style={{ fontSize: "20px", marginBottom: "2px" }}>{p.emoji}</div>
                <div style={{ fontSize: "14px", fontWeight: "700" }}>{p.name}</div>
                <div style={{ fontSize: "10px", opacity: 0.7 }}>{p.title}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 24px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}>

          {/* Greeting */}
          {showGreeting[activePersona] && (
            <div className="msg-bubble" style={{
              display: "flex", gap: "10px", alignItems: "flex-start",
            }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                background: `linear-gradient(135deg, ${persona.color}44, ${persona.color}22)`,
                border: `1px solid ${persona.color}66`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "18px", flexShrink: 0,
              }}>{persona.emoji}</div>
              <div style={{
                background: "#111",
                border: `1px solid ${persona.color}33`,
                borderRadius: "4px 16px 16px 16px",
                padding: "12px 16px",
                color: "#ccc",
                fontSize: "14px",
                lineHeight: "1.6",
                maxWidth: "85%",
                fontStyle: "italic",
              }}>
                {persona.greeting}
              </div>
            </div>
          )}

          {/* Suggested Questions (only when no messages) */}
          {currentMsgs.length === 0 && (
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontSize: "11px", color: "#444", marginBottom: "8px", letterSpacing: "2px", textTransform: "uppercase" }}>
                Try asking...
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button key={q} onClick={() => sendMessage(q)} style={{
                    background: "transparent",
                    border: "1px solid #222",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    color: "#555",
                    fontSize: "13px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                    onMouseEnter={e => { e.target.style.borderColor = persona.color + "66"; e.target.style.color = "#999"; }}
                    onMouseLeave={e => { e.target.style.borderColor = "#222"; e.target.style.color = "#555"; }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {currentMsgs.map((msg, i) => (
            <div key={i} className="msg-bubble" style={{
              display: "flex",
              flexDirection: msg.role === "user" ? "row-reverse" : "row",
              gap: "10px",
              alignItems: "flex-start",
            }}>
              {msg.role === "assistant" && (
                <div style={{
                  width: "36px", height: "36px", borderRadius: "50%",
                  background: `linear-gradient(135deg, ${persona.color}44, ${persona.color}22)`,
                  border: `1px solid ${persona.color}66`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "18px", flexShrink: 0,
                }}>{persona.emoji}</div>
              )}
              <div style={{
                maxWidth: "82%",
                padding: "12px 16px",
                borderRadius: msg.role === "user"
                  ? "16px 4px 16px 16px"
                  : "4px 16px 16px 16px",
                background: msg.role === "user"
                  ? `linear-gradient(135deg, ${persona.color}33, ${persona.color}22)`
                  : "#111",
                border: `1px solid ${msg.role === "user" ? persona.color + "44" : "#222"}`,
                color: msg.role === "user" ? "#e0d0a0" : "#ccc",
                fontSize: "14px",
                lineHeight: "1.65",
              }}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Loading */}
          {loading && (
            <div className="msg-bubble" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                background: `linear-gradient(135deg, ${persona.color}44, ${persona.color}22)`,
                border: `1px solid ${persona.color}66`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "18px",
              }}>{persona.emoji}</div>
              <div style={{
                background: "#111", border: "1px solid #222",
                borderRadius: "4px 16px 16px 16px",
                padding: "14px 20px", display: "flex", gap: "6px", alignItems: "center",
              }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: "6px", height: "6px", borderRadius: "50%",
                    background: persona.color,
                    animation: `pulse 1.2s ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: "12px 24px 24px",
          borderTop: "1px solid #1a1a1a",
        }}>
          <div style={{
            display: "flex", gap: "10px", alignItems: "flex-end",
            background: "#0e0e0e",
            border: `1px solid ${persona.color}44`,
            borderRadius: "16px",
            padding: "10px 12px",
            transition: "border-color 0.3s",
          }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={persona.placeholder}
              rows={1}
              style={{
                flex: 1, background: "transparent", border: "none",
                color: "#ddd", fontSize: "14px", lineHeight: "1.5",
                fontFamily: "inherit", padding: "2px 4px",
                maxHeight: "120px", overflowY: "auto",
              }}
              onInput={e => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              style={{
                width: "36px", height: "36px", borderRadius: "10px",
                border: "none",
                background: loading || !input.trim()
                  ? "#222"
                  : `linear-gradient(135deg, ${persona.color}, ${persona.color}bb)`,
                color: loading || !input.trim() ? "#444" : "#000",
                fontSize: "16px", cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.2s", flexShrink: 0,
                fontWeight: "bold",
              }}
            >
              ↑
            </button>
          </div>
          <div style={{
            textAlign: "center", fontSize: "10px", color: "#2a2a2a",
            marginTop: "8px", letterSpacing: "1px",
          }}>
            THE INNER SANCTUM · FANTASY AI © 2026
          </div>
        </div>
      </div>
    </div>
  );
}
