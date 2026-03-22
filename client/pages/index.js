import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import Head from "next/head";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const SUGGESTED_PROMPTS = [
  "What dining halls are open right now?",
  "How do I reserve a library study room?",
  "When does add/drop end this semester?",
  "Where is CAPS and how do I make an appointment?",
  "Which bus goes to Barracks Road?",
  "What AFC classes are available this week?",
];

const BUS_TRACKER_MARKER = "[BUS_TRACKER]";

function LoadingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block w-2 h-2 rounded-full bg-brass animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function PaperAirplaneIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
    </svg>
  );
}

function AssistantContent({ content, onOpenBusTracker }) {
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
                  className="text-brass underline hover:text-brass-dim">
                  {children}
                </a>
              ),
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-0.5">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-brass">{children}</strong>,
              code: ({ children }) => (
                <code className="px-1 py-0.5 rounded text-xs bg-desert">{children}</code>
              ),
            }}
          >
            {part}
          </ReactMarkdown>
          {i < parts.length - 1 && (
            <button
              onClick={onOpenBusTracker}
              className="mt-3 flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border border-brass text-brass hover:bg-brass hover:text-desert transition-colors"
            >
              🚌 Open Live Bus Tracker
            </button>
          )}
        </span>
      ))}
    </>
  );
}

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [busTrackerOpen, setBusTrackerOpen] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const sendMessage = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || isStreaming) return;

    const userMsg = { role: "user", content: text };
    const conversationHistory = messages;
    const updated = [...messages, userMsg, { role: "assistant", content: "" }];

    setMessages(updated);
    setInput("");
    setIsStreaming(true);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationHistory }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: next[next.length - 1].content + chunk,
          };
          return next;
        });
      }
    } catch (err) {
      console.error("Stream error:", err);
      const isNetwork =
        err instanceof TypeError &&
        (err.message.includes("Failed to fetch") || err.message.includes("Load failed"));
      const errorContent = isNetwork
        ? `**Could not reach the Wrangler API.** Make sure the backend is running at \`${API_URL}\`.`
        : "Sorry, something went sideways on the trail. Check your connection and try again.";
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], content: errorContent };
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <>
      <Head>
        <title>Wrangler — UVA Campus Guide</title>
        <meta name="description" content="Your AI guide for everything at UVA — dining, buses, classes, health services, libraries, housing, research, and more." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="flex flex-col h-dvh bg-desert">
        {/* ── Header ── */}
        <header className="shrink-0 border-b border-desert-border bg-desert-light/50 backdrop-blur-sm">
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl tracking-wide text-brass m-0 leading-none">WRANGLER</h1>
              <p className="text-xs text-parchment-dim m-0 mt-0.5">Your UVA Campus Guide</p>
            </div>
            {busTrackerOpen && (
              <button
                onClick={() => setBusTrackerOpen(false)}
                className="text-xs px-3 py-1.5 rounded-full border border-desert-border text-parchment-dim hover:border-brass hover:text-brass transition-colors"
              >
                ✕ Close Map
              </button>
            )}
          </div>
        </header>

        {/* ── Body: chat + optional bus tracker panel ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Chat column ── */}
          <div className={`flex flex-col ${busTrackerOpen ? "w-1/2 border-r border-desert-border" : "w-full"} transition-all duration-300`}>

            {/* Empty state */}
            {!hasMessages && (
              <div className="flex-1 flex flex-col items-center justify-center px-4">
                <h2 className="font-display text-5xl sm:text-6xl text-brass mb-4 text-center">Howdy, partner</h2>
                <p className="text-parchment-dim text-base max-w-md text-center mb-8">
                  Ask me anything about UVA — dining, buses, classes, health services, libraries, housing, research, and more.
                </p>
                <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      disabled={isStreaming}
                      className="text-sm px-4 py-2 rounded-full border border-desert-border text-parchment-dim hover:border-brass hover:text-brass transition-colors duration-150 disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message list */}
            {hasMessages && (
              <div ref={scrollRef} className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
                  {messages.map((msg, i) => {
                    const isUser = msg.role === "user";
                    const isLoadingAssistant = !isUser && msg.content === "" && isStreaming;
                    return (
                      <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
                          isUser
                            ? "bg-leather text-parchment"
                            : "border border-desert-border bg-desert-light"
                        }`}>
                          {isUser ? (
                            <p className="whitespace-pre-wrap break-words text-sm m-0">{msg.content}</p>
                          ) : isLoadingAssistant ? (
                            <LoadingDots />
                          ) : (
                            <div className="prose-western text-sm text-parchment-dim">
                              <AssistantContent
                                content={msg.content}
                                onOpenBusTracker={() => setBusTrackerOpen(true)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Input bar */}
            <footer className="shrink-0 border-t border-desert-border bg-desert-light/50 backdrop-blur-sm">
              <form
                onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
                className="max-w-3xl mx-auto px-4 py-3 flex items-end gap-2"
              >
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); resizeTextarea(); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything about UVA..."
                  rows={1}
                  disabled={isStreaming}
                  className="flex-1 resize-none rounded-xl border border-desert-border bg-desert text-parchment placeholder-parchment-dim px-4 py-3 text-sm focus:outline-none focus:border-brass transition-colors"
                  style={{ maxHeight: "160px", lineHeight: "1.5" }}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isStreaming}
                  className="h-12 w-12 flex items-center justify-center rounded-xl bg-brass text-desert hover:bg-brass-dim transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <PaperAirplaneIcon />
                </button>
              </form>
              <p className="text-center text-xs text-parchment-dim/60 pb-2">
                Wrangler is not an official UVA service — verify info at official sources.
              </p>
            </footer>
          </div>

          {/* ── Bus tracker panel ── */}
          {busTrackerOpen && (
            <div className="w-1/2 flex flex-col">
              <div className="shrink-0 px-4 py-2.5 bg-desert-light border-b border-desert-border flex items-center gap-2">
                <span className="text-sm font-semibold text-brass">🚌 UVA Live Bus Tracker</span>
                <span className="text-xs text-parchment-dim ml-auto">via uva.transloc.com</span>
              </div>
              <iframe
                src="https://uva.transloc.com"
                title="UVA Live Bus Tracker"
                className="flex-1 w-full border-0"
              />
            </div>
          )}
        </div>
      </main>
    </>
  );
}
