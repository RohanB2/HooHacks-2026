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
const CALENDAR_MARKER_RE = /\[CALENDAR_EVENT:(\{[\s\S]*?\})\]/;
const BOOK_ROOM_MARKER_RE = /\[BOOK_ROOM:(\{[\s\S]*\})\]/;

function parseCalendarMarker(content) {
  const m = content.match(CALENDAR_MARKER_RE);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function parseBookRoomMarker(content) {
  const m = content.match(BOOK_ROOM_MARKER_RE);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function formatEventTime(iso, timeZone) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone,
  });
}
function formatEventDate(iso, timeZone) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone,
  });
}

const BOOKING_URL_PATTERNS = [
  // Library rooms are now handled by the [BOOK_ROOM:JSON] split panel — no external link needed
  { pattern: /rec\.virginia\.edu/i, label: "Open RecSports", emoji: "🏋️" },
  { pattern: /25live\.collegenet\.com/i, label: "Open 25Live Room Booking", emoji: "🏛️" },
];

const SCHOOLS = ["CLAS", "SEAS", "McIntire", "Architecture", "Nursing", "Batten", "Education", "Darden", "Law", "Other"];
const YEARS = [
  { label: "1st year", value: 1 },
  { label: "2nd year", value: 2 },
  { label: "3rd year", value: 3 },
  { label: "4th year", value: 4 },
  { label: "Graduate", value: 5 },
];

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

function HistoryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
    </svg>
  );
}

function AssistantContent({ content, onOpenBusTracker, onOpenCalendar, onOpenBookRoom }) {
  const calEvent = parseCalendarMarker(content);
  const bookRoom = parseBookRoomMarker(content);
  const cleanContent = content.replace(CALENDAR_MARKER_RE, "").replace(BOOK_ROOM_MARKER_RE, "").trim();
  const parts = cleanContent.split(BUS_TRACKER_MARKER);

  // Detect booking URLs in the full content to show action buttons
  const bookingButtons = [];
  for (const { pattern, label, emoji } of BOOKING_URL_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      const urlMatch = content.match(new RegExp(`https?://[^\\s)]*${pattern.source}[^\\s)]*`, "i"));
      if (urlMatch) {
        bookingButtons.push({ url: urlMatch[0], label, emoji });
      }
    }
  }

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
      {bookingButtons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {bookingButtons.map((btn, i) => (
            <a
              key={i}
              href={btn.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-brass text-brass hover:bg-brass hover:text-desert transition-colors"
            >
              {btn.emoji} {btn.label}
            </a>
          ))}
        </div>
      )}
      {calEvent && onOpenCalendar && (
        <button
          onClick={() => onOpenCalendar(calEvent)}
          className="mt-3 flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border border-brass text-brass hover:bg-brass hover:text-desert transition-colors"
        >
          📅 View Event Details
        </button>
      )}
      {bookRoom && onOpenBookRoom && bookRoom.type !== "library_list" && (
        <button
          onClick={() => onOpenBookRoom(bookRoom)}
          className="mt-3 flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border border-brass text-brass hover:bg-brass hover:text-desert transition-colors"
        >
          📚 View Available Rooms
        </button>
      )}
    </>
  );
}

function PersonalizationModal({ user, onSave, onSkip }) {
  const [school, setSchool] = useState("");
  const [year, setYear] = useState("");

  const handleSave = () => {
    if (!school && !year) { onSkip(); return; }
    onSave({ school: school || null, year: year ? parseInt(year) : null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-desert-light border border-desert-border rounded-2xl p-6 w-80 shadow-xl">
        <h2 className="font-display text-xl text-brass mb-1">Howdy, {user.name?.split(" ")[0]}!</h2>
        <p className="text-sm text-parchment-dim mb-5">Tell Wrangler about yourself for more tailored answers.</p>

        <div className="space-y-3 mb-5">
          <div>
            <label className="text-xs text-parchment-dim mb-1 block">School</label>
            <select
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              className="w-full bg-desert border border-desert-border rounded-lg px-3 py-2 text-sm text-parchment focus:outline-none focus:border-brass"
            >
              <option value="">Select school…</option>
              {SCHOOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-parchment-dim mb-1 block">Year</label>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full bg-desert border border-desert-border rounded-lg px-3 py-2 text-sm text-parchment focus:outline-none focus:border-brass"
            >
              <option value="">Select year…</option>
              {YEARS.map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 bg-brass text-desert font-semibold text-sm py-2 rounded-lg hover:bg-brass-dim transition-colors"
          >
            Save
          </button>
          <button
            onClick={onSkip}
            className="px-4 text-sm text-parchment-dim hover:text-parchment transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [busTrackerOpen, setBusTrackerOpen] = useState(false);
  const [calendarEvent, setCalendarEvent] = useState(null);
  const [bookRoomData, setBookRoomData] = useState(null);

  const openBusTracker = () => { setCalendarEvent(null); setBookRoomData(null); setBusTrackerOpen(true); };
  const openCalendar = (evt) => { setBusTrackerOpen(false); setBookRoomData(null); setCalendarEvent(evt); };
  const openBookRoom = (data) => { setBusTrackerOpen(false); setCalendarEvent(null); setBookRoomData(data); };

  // Auth state
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConvId, setCurrentConvId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showPersonalization, setShowPersonalization] = useState(false);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  // ── Auth initialization ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    const calendarStatus = params.get("calendar");
    if (urlToken || calendarStatus) {
      if (urlToken) localStorage.setItem("wrangler_token", urlToken);
      if (calendarStatus === "connected") setCalendarConnected(true);
      window.history.replaceState({}, "", window.location.pathname);
    }

    const storedToken = urlToken || localStorage.getItem("wrangler_token");
    if (!storedToken) return;

    setToken(storedToken);
    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((userData) => {
        if (!userData) { localStorage.removeItem("wrangler_token"); return; }
        setUser(userData);
        setCalendarConnected(!!userData.calendarConnected);
        if (urlToken && userData.school === null && userData.year === null) {
          setShowPersonalization(true);
        }
        return fetch(`${API_URL}/conversations`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        }).then((r) => r.ok ? r.json() : []).then(setConversations);
      })
      .catch(() => localStorage.removeItem("wrangler_token"));
  }, []);

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

  const logout = () => {
    localStorage.removeItem("wrangler_token");
    setUser(null);
    setToken(null);
    setConversations([]);
    setCurrentConvId(null);
    setHistoryOpen(false);
  };

  const startNewChat = () => {
    setMessages([]);
    setCurrentConvId(null);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const loadConversation = async (convId) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages.map((m) => ({ role: m.role, content: m.content })));
      setCurrentConvId(convId);
      setHistoryOpen(false);
    } catch {}
  };

  const deleteConversation = async (convId, e) => {
    e.stopPropagation();
    if (!token) return;
    try {
      await fetch(`${API_URL}/conversations/${convId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (currentConvId === convId) startNewChat();
    } catch {}
  };

  const savePersonalization = async ({ school, year }) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ school, year }),
      });
      if (res.ok) {
        const updated = await res.json();
        setUser(updated);
      }
    } catch {}
    setShowPersonalization(false);
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

    // Create conversation on first message if signed in
    let convId = currentConvId;
    if (token && !convId) {
      try {
        const res = await fetch(`${API_URL}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title: text.slice(0, 60) }),
        });
        if (res.ok) {
          const conv = await res.json();
          convId = conv.id;
          setCurrentConvId(convId);
          setConversations((prev) => [conv, ...prev]);
        }
      } catch {}
    }

    let assistantContent = "";

    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: text, conversationHistory }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        assistantContent += chunk;
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
      assistantContent = isNetwork
        ? `**Could not reach the Wrangler API.** Make sure the backend is running at \`${API_URL}\`.`
        : "Sorry, something went sideways on the trail. Check your connection and try again.";
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], content: assistantContent };
        return next;
      });
    } finally {
      setIsStreaming(false);

      // Persist messages to DB if signed in
      if (token && convId && assistantContent) {
        try {
          await fetch(`${API_URL}/conversations/${convId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              messages: [
                { role: "user", content: text },
                { role: "assistant", content: assistantContent },
              ],
            }),
          });
        } catch {}
      }
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

      {showPersonalization && user && (
        <PersonalizationModal
          user={user}
          onSave={savePersonalization}
          onSkip={() => setShowPersonalization(false)}
        />
      )}

      <main className="flex flex-col h-dvh bg-desert">
        {/* ── Header ── */}
        <header className="shrink-0 border-b border-desert-border bg-desert-light/50 backdrop-blur-sm">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* History toggle */}
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                title="Conversation history"
                className={`p-1.5 rounded-lg transition-colors ${historyOpen ? "text-brass bg-brass/10" : "text-parchment-dim hover:text-brass"}`}
              >
                <HistoryIcon />
              </button>

              <div>
                <h1 className="font-display text-2xl tracking-wide text-brass m-0 leading-none">WRANGLER</h1>
                <p className="text-xs text-parchment-dim m-0 mt-0.5">Your UVA Campus Guide</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(busTrackerOpen || calendarEvent || bookRoomData) && (
                <button
                  onClick={() => { setBusTrackerOpen(false); setCalendarEvent(null); setBookRoomData(null); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-desert-border text-parchment-dim hover:border-brass hover:text-brass transition-colors"
                >
                  ✕ {busTrackerOpen ? "Close Map" : "Close Panel"}
                </button>
              )}

              {/* Auth area */}
              {user ? (
                <div className="flex items-center gap-2">
                  {!calendarConnected && token && (
                    <a
                      href={`${API_URL}/auth/google/calendar?token=${token}`}
                      className="text-xs px-2.5 py-1.5 rounded-full border border-brass/50 text-brass hover:bg-brass hover:text-desert transition-colors font-medium hidden sm:inline-flex items-center gap-1"
                      title="Connect Google Calendar"
                    >
                      📅 Connect Calendar
                    </a>
                  )}
                  {user.picture && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.picture} alt={user.name} className="w-7 h-7 rounded-full border border-desert-border" referrerPolicy="no-referrer" />
                  )}
                  <span className="text-xs text-parchment-dim hidden sm:block max-w-[100px] truncate">{user.name}</span>
                  <button
                    onClick={logout}
                    title="Sign out"
                    className="p-1.5 text-parchment-dim hover:text-brass transition-colors"
                  >
                    <LogoutIcon />
                  </button>
                </div>
              ) : (
                <a
                  href={`${API_URL}/auth/google`}
                  className="text-xs px-3 py-1.5 rounded-full border border-brass text-brass hover:bg-brass hover:text-desert transition-colors font-medium"
                >
                  Sign in
                </a>
              )}
            </div>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── History sidebar ── */}
          {historyOpen && user && (
            <div className="w-64 shrink-0 flex flex-col border-r border-desert-border bg-desert-light overflow-hidden">
              <div className="shrink-0 px-3 py-2.5 border-b border-desert-border flex items-center justify-between">
                <span className="text-xs font-semibold text-parchment uppercase tracking-wide">History</span>
                <button
                  onClick={startNewChat}
                  className="text-xs px-2 py-1 rounded-lg border border-brass text-brass hover:bg-brass hover:text-desert transition-colors"
                >
                  + New chat
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations.length === 0 ? (
                  <p className="text-xs text-parchment-dim px-3 py-4 text-center">No conversations yet</p>
                ) : (
                  <ul className="py-1">
                    {conversations.map((conv) => (
                      <li key={conv.id}>
                        <button
                          onClick={() => loadConversation(conv.id)}
                          className={`w-full text-left px-3 py-2.5 flex items-start gap-2 group hover:bg-desert transition-colors ${currentConvId === conv.id ? "bg-desert" : ""}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-parchment truncate">{conv.title || "Untitled"}</p>
                            <p className="text-xs text-parchment-dim mt-0.5">
                              {new Date(conv.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </p>
                          </div>
                          <button
                            onClick={(e) => deleteConversation(conv.id, e)}
                            className="shrink-0 opacity-0 group-hover:opacity-100 text-parchment-dim hover:text-red-400 transition-all text-xs p-0.5"
                            title="Delete"
                          >
                            ✕
                          </button>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ── Chat column ── */}
          <div className={`flex flex-col ${busTrackerOpen || calendarEvent || bookRoomData ? "w-1/2 border-r border-desert-border" : "flex-1"} transition-all duration-300 min-w-0`}>

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
                                onOpenBusTracker={openBusTracker}
                                onOpenCalendar={openCalendar}
                                onOpenBookRoom={openBookRoom}
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

          {/* ── Calendar event panel ── */}
          {calendarEvent && (
            <div className="w-1/2 flex flex-col bg-desert-light">
              <div className="shrink-0 px-4 py-2.5 border-b border-desert-border flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-brass shrink-0">{calendarEvent.deleted ? "🗑️" : "📅"}</span>
                <div className="min-w-0">
                  <p className="text-xs text-parchment-dim uppercase tracking-wide">
                    {calendarEvent.deleted ? "Removed from Calendar" : calendarEvent._action === "updateCalendarEvent" ? "Updated Calendar" : "Added to Calendar"}
                  </p>
                  <p className="text-sm font-semibold text-brass truncate">{calendarEvent.title}</p>
                  {!calendarEvent.deleted && (
                    <p className="text-xs text-parchment-dim">
                      {formatEventDate(calendarEvent.start, calendarEvent.timeZone || "America/New_York")}
                      {" · "}
                      {formatEventTime(calendarEvent.start, calendarEvent.timeZone || "America/New_York")}
                      {" – "}
                      {formatEventTime(calendarEvent.end, calendarEvent.timeZone || "America/New_York")}
                    </p>
                  )}
                  {calendarEvent.location && (
                    <p className="text-xs text-parchment-dim truncate">📍 {calendarEvent.location}</p>
                  )}
                  {calendarEvent.meetLink && (
                    <a href={calendarEvent.meetLink} target="_blank" rel="noopener noreferrer" className="text-xs text-brass underline">
                      🎥 Join Google Meet
                    </a>
                  )}
                  {calendarEvent.attendees?.length > 0 && (
                    <p className="text-xs text-parchment-dim truncate">👥 {calendarEvent.attendees.join(", ")}</p>
                  )}
                </div>
              </div>
              {user?.email ? (
                <iframe
                  src={`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(user.email)}&ctz=America%2FNew_York&mode=WEEK&showTitle=0&showNav=1&showPrint=0&showTabs=0&showCalendars=0&showTz=0&bgcolor=%231a1a1a`}
                  title="Google Calendar"
                  className="flex-1 w-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <a
                    href={calendarEvent.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brass underline"
                  >
                    Open in Google Calendar ↗
                  </a>
                </div>
              )}
            </div>
          )}

          {/* ── Book Room panel ── */}
          {bookRoomData && (
            <div className="w-1/2 flex flex-col bg-desert-light">
              {/* Header */}
              <div className="shrink-0 px-4 py-2.5 border-b border-desert-border">
                <p className="text-xs text-parchment-dim uppercase tracking-wide">📚 Available Study Rooms</p>
                <p className="text-sm font-semibold text-brass">{bookRoomData.library || "UVA Libraries"}</p>
                {bookRoomData.location && (
                  <p className="text-xs text-parchment-dim">📍 {bookRoomData.location}</p>
                )}
                {bookRoomData.date && (
                  <p className="text-xs text-parchment-dim">
                    {bookRoomData.date}{bookRoomData.timeHint ? ` · around ${bookRoomData.timeHint}` : ""}
                  </p>
                )}
              </div>

              {/* Room list */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {bookRoomData.type === "rooms_available" && bookRoomData.availableRooms?.length > 0 ? (
                  bookRoomData.availableRooms.map((room, i) => (
                    <div key={i} className="rounded-lg border border-desert-border bg-desert p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-brass truncate">{room.name}</p>
                          <p className="text-xs text-parchment-dim">Capacity: {room.capacity}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {room.availableRanges.map((range, j) => (
                              <span key={j} className="text-xs px-1.5 py-0.5 rounded bg-desert-light border border-desert-border text-parchment-dim">
                                {range}
                              </span>
                            ))}
                          </div>
                        </div>
                        <a
                          href={room.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border border-brass text-brass hover:bg-brass hover:text-desert transition-colors"
                        >
                          Book →
                        </a>
                      </div>
                    </div>
                  ))
                ) : bookRoomData.type === "rooms_available" && bookRoomData.availableRooms?.length === 0 ? (
                  <div className="text-sm text-parchment-dim text-center py-8">
                    No rooms available for this time window.
                    <br />
                    <a href={bookRoomData.bookingUrl} target="_blank" rel="noopener noreferrer" className="text-brass underline mt-2 inline-block">
                      Check full calendar →
                    </a>
                  </div>
                ) : bookRoomData.type === "rooms_static" ? (
                  <>
                    {bookRoomData.rooms?.map((room, i) => (
                      <div key={i} className="rounded-lg border border-desert-border bg-desert p-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-brass">{room.name}</p>
                          <p className="text-xs text-parchment-dim">Capacity: {room.capacity}</p>
                        </div>
                      </div>
                    ))}
                    {bookRoomData.note && (
                      <p className="text-xs text-parchment-dim mt-2">{bookRoomData.note}</p>
                    )}
                  </>
                ) : null}
              </div>

              {/* Footer with main booking link */}
              {(bookRoomData.bookingUrl || bookRoomData.allRoomsUrl) && (
                <div className="shrink-0 px-4 py-2.5 border-t border-desert-border">
                  <a
                    href={bookRoomData.allRoomsUrl || bookRoomData.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brass underline"
                  >
                    View full availability calendar →
                  </a>
                  <p className="text-xs text-parchment-dim mt-0.5">Sign in with UVA NetBadge to complete booking</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
