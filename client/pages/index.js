import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import Head from "next/head";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const SUGGESTED_QUERIES = [
  "What's open for food right now?",
  "How do I reserve a library study room?",
  "When does add/drop end this semester?",
  "Where is CAPS and how do I make an appointment?",
  "How do I apply to McIntire?",
  "What AFC classes are available this week?",
  "Where can I find undergraduate research opportunities?",
  "Which bus goes to Barracks Road?",
];

function SheriffBadge() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Outer star shape */}
      <polygon
        points="18,2 22,13 34,13 25,20 28,32 18,25 8,32 11,20 2,13 14,13"
        fill="#D4A017"
        stroke="#b8860b"
        strokeWidth="1"
      />
      {/* Inner circle */}
      <circle cx="18" cy="18" r="6" fill="#232D4B" />
      {/* Center dot */}
      <circle cx="18" cy="18" r="2" fill="#D4A017" />
    </svg>
  );
}

function TrailDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <span className="text-gray-400 text-sm mr-2">Wrangler is on the trail</span>
      <span className="trail-dot" />
      <span className="trail-dot" />
      <span className="trail-dot" />
    </div>
  );
}

const BUS_TRACKER_MARKER = "[BUS_TRACKER]";

function LiveBusWidget() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
        style={{
          backgroundColor: open ? "#D4A017" : "transparent",
          border: "1px solid #D4A017",
          color: open ? "#1a1a1a" : "#D4A017",
          cursor: "pointer",
        }}
      >
        🚌 {open ? "Hide" : "Open"} Live Bus Tracker
      </button>
      {open && (
        <iframe
          src="https://uva.transloc.com"
          title="UVA Live Bus Tracker"
          className="w-full rounded-lg mt-2"
          style={{ height: "420px", border: "1px solid #444" }}
        />
      )}
    </div>
  );
}

function AssistantContent({ content }) {
  const parts = content.split(BUS_TRACKER_MARKER);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="m-0 mb-2 last:mb-0">{children}</p>,
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer"
                  style={{ color: "#D4A017", textDecoration: "underline" }}>
                  {children}
                </a>
              ),
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-0.5">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold" style={{ color: "#D4A017" }}>{children}</strong>,
              code: ({ children }) => (
                <code className="px-1 py-0.5 rounded text-xs" style={{ backgroundColor: "#1a1a1a" }}>{children}</code>
              ),
            }}
          >
            {part}
          </ReactMarkdown>
          {i < parts.length - 1 && <LiveBusWidget />}
        </span>
      ))}
    </>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center mr-2 mt-1 flex-shrink-0"
          style={{ backgroundColor: "#232D4B" }}>
          <SheriffBadge />
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser ? "rounded-br-sm" : "rounded-bl-sm"
        }`}
        style={
          isUser
            ? { backgroundColor: "#D4A017", color: "#1a1a1a" }
            : { backgroundColor: "#2a2a2a", color: "#e5e7eb" }
        }
      >
        {isUser
          ? <p className="m-0">{message.content}</p>
          : <AssistantContent content={message.content} />
        }
      </div>
    </div>
  );
}

function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-16">
      <div className="mb-4">
        <SheriffBadge />
      </div>
      <h2 className="font-serif text-3xl font-bold mb-2" style={{ color: "#D4A017" }}>
        Howdy, Wahoo.
      </h2>
      <p className="text-gray-400 text-base max-w-md">
        Ask me anything about UVA — dining, buses, classes, health services, libraries, housing, research, and more.
      </p>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || isStreaming) return;

    setInput("");
    setHasStarted(true);
    setIsStreaming(true);

    const userMessage = { role: "user", content: text };
    // history = everything before the new user message
    const conversationHistory = messages;
    const nextMessages = [...messages, userMessage, { role: "assistant", content: "" }];
    setMessages(nextMessages);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationHistory }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + chunk,
          };
          return updated;
        });
      }
    } catch (err) {
      console.error("Stream error:", err);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content:
            "Sorry, something went sideways on the trail. Check your connection and try again.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Is the last message still empty (loading before first chunk arrives)?
  const showTrailDots =
    isStreaming &&
    messages.length > 0 &&
    messages[messages.length - 1].content === "";

  return (
    <>
      <Head>
        <title>Wrangler — Your UVA Trail Guide</title>
        <meta name="description" content="AI guide for everything at UVA" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="flex flex-col h-screen" style={{ backgroundColor: "#1a1a1a" }}>
        {/* ── Header ── */}
        <header
          className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
          style={{ backgroundColor: "#232D4B", borderBottom: "2px solid #D4A017" }}
        >
          <SheriffBadge />
          <div>
            <h1
              className="font-serif font-bold leading-none m-0"
              style={{ color: "#D4A017", fontSize: "26px", letterSpacing: "0.05em" }}
            >
              WRANGLER
            </h1>
            <p className="text-xs text-gray-400 m-0 mt-0.5">Your UVA trail guide</p>
          </div>
        </header>

        {/* ── Messages area ── */}
        <main className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {messages.length === 0 && <WelcomeScreen />}
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}
          {showTrailDots && <TrailDots />}
          <div ref={messagesEndRef} />
        </main>

        {/* ── Suggested query chips (disappear after first message) ── */}
        {!hasStarted && (
          <div
            className="px-4 pb-3 flex flex-wrap gap-2 flex-shrink-0"
            style={{ borderTop: "1px solid #2a2a2a" }}
          >
            {SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                disabled={isStreaming}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors duration-150 text-left"
                style={{
                  borderColor: "#D4A017",
                  color: "#D4A017",
                  backgroundColor: "transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#D4A017";
                  e.currentTarget.style.color = "#1a1a1a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#D4A017";
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* ── Input bar ── */}
        <div
          className="flex-shrink-0 px-4 py-3"
          style={{ backgroundColor: "#232D4B", borderTop: "1px solid #D4A017" }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex gap-2 items-end"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about UVA..."
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 transition-all"
              style={{
                backgroundColor: "#1a1a1a",
                border: "1px solid #444",
                maxHeight: "120px",
                lineHeight: "1.5",
                focusRingColor: "#D4A017",
              }}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className="flex-shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: "#D4A017",
                color: "#1a1a1a",
                minWidth: "72px",
              }}
            >
              {isStreaming ? "..." : "Send"}
            </button>
          </form>
          <p className="text-center text-xs text-gray-600 mt-1.5">
            Wrangler may not have real-time info — verify schedules at their official sites.
          </p>
        </div>
      </div>
    </>
  );
}
