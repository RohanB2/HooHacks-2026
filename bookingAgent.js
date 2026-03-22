const https = require("https");
const { URLSearchParams } = require("url");

// ─── Library room registry ────────────────────────────────────────────────────
// All rooms have confirmed eids from the LibCal availability grid endpoint.
// Live availability (real-time slot checking) works for all libraries below.
const LIBRARY_ROOMS = {
  shannon: {
    name: "Shannon Library",
    lid: 1076,
    location: "Central Grounds, next to the Rotunda",
    directUrl: "https://cal.lib.virginia.edu/reserve/spaces/Shannon",
    rooms: [
      { name: "134 - Conference Room", capacity: 14, eid: 169211 },
      { name: "318 C", capacity: 6, eid: 168175 },
      { name: "318 D", capacity: 6, eid: 168177 },
      { name: "318 F", capacity: 6, eid: 168179 },
      { name: "318 G", capacity: 6, eid: 168181 },
      { name: "318 H", capacity: 6, eid: 168182 },
      { name: "318 I", capacity: 6, eid: 168183 },
      { name: "318 K", capacity: 6, eid: 168185 },
      { name: "318 L", capacity: 6, eid: 168186 },
      { name: "Shannon 321 (Taylor Room)", capacity: 14, eid: 216543 },
    ],
  },
  clemons: {
    name: "Clemons Library",
    lid: 2172,
    location: "Central Grounds, near Old Cabell Hall",
    directUrl: "https://cal.lib.virginia.edu/spaces?lid=2172",
    rooms: [
      { name: "Clemons 202 (Conference Room)", capacity: 12, eid: 15080 },
      { name: "Clemons 203 (Conference Room)", capacity: 12, eid: 15082 },
      { name: "Clemons 204 (Conference Room)", capacity: 24, eid: 15084 },
      { name: "Clemons 220", capacity: 10, eid: 19357 },
      { name: "Clemons 221", capacity: 5, eid: 15065 },
      { name: "Clemons 222", capacity: 5, eid: 15066 },
      { name: "Clemons 224", capacity: 5, eid: 15067 },
      { name: "Clemons 226", capacity: 4, eid: 15068 },
      { name: "Clemons 227", capacity: 5, eid: 15069 },
      { name: "Clemons 230", capacity: 5, eid: 15070 },
      { name: "Clemons 234", capacity: 3, eid: 15071 },
      { name: "Clemons 237", capacity: 5, eid: 15073 },
      { name: "Clemons 238", capacity: 5, eid: 15075 },
      { name: "Clemons 241", capacity: 6, eid: 15077 },
      { name: "Clemons 245", capacity: 6, eid: 15078 },
    ],
  },
  // Georges Student Center = Clemons 2nd floor study rooms only (NOT the conference rooms, NOT RMC)
  clem2: {
    name: "Georges Student Center (Clemons 2nd Floor)",
    lid: 2172,
    location: "Clemons Library, 2nd Floor — Central Grounds",
    directUrl: "https://cal.lib.virginia.edu/spaces?lid=2172",
    rooms: [
      { name: "Clemons 221", capacity: 5, eid: 15065 },
      { name: "Clemons 222", capacity: 5, eid: 15066 },
      { name: "Clemons 224", capacity: 5, eid: 15067 },
      { name: "Clemons 226", capacity: 4, eid: 15068 },
      { name: "Clemons 227", capacity: 5, eid: 15069 },
      { name: "Clemons 230", capacity: 5, eid: 15070 },
      { name: "Clemons 234", capacity: 3, eid: 15071 },
      { name: "Clemons 237", capacity: 5, eid: 15073 },
      { name: "Clemons 238", capacity: 5, eid: 15075 },
      { name: "Clemons 241", capacity: 6, eid: 15077 },
      { name: "Clemons 245", capacity: 6, eid: 15078 },
    ],
  },
  rmc: {
    name: "Robertson Media Center (RMC)",
    lid: 241,
    location: "Clemons Library, Central Grounds",
    directUrl: "https://cal.lib.virginia.edu/spaces?lid=241",
    rooms: [
      { name: "VizWall", capacity: 20, eid: 8400 },
      { name: "Audio Studio", capacity: 4, eid: 8468 },
      { name: "Steenbeck Film Editor", capacity: 1, eid: 8472 },
      { name: "HTC Vive VR Station 1", capacity: 1, eid: 8478 },
      { name: "HTC Vive VR Station 2", capacity: 1, eid: 14407 },
    ],
  },
  dml: {
    name: "Digital Media Lab (DML)",
    lid: 1510,
    location: "Clemons Library (Lower Level), Central Grounds",
    directUrl: "https://cal.lib.virginia.edu/spaces?lid=1510",
    rooms: [
      { name: "Audio Digitization Workstation", capacity: 1, eid: 8392 },
      { name: "VHS Digitization Workstation 1", capacity: 1, eid: 8393 },
      { name: "VHS Digitization Workstation 2", capacity: 1, eid: 8394 },
      { name: "Open Workstation A", capacity: 1, eid: 8395 },
      { name: "Open Workstation B", capacity: 1, eid: 8396 },
      { name: "Open Workstation C", capacity: 1, eid: 8397 },
      { name: "Open Workstation D", capacity: 1, eid: 8398 },
      { name: "Open Workstation E", capacity: 1, eid: 8399 },
      { name: "Video Studio", capacity: 5, eid: 8474 },
      { name: "Film ScanStation", capacity: 1, eid: 41137 },
      { name: "Photography & Animation Studio", capacity: 5, eid: 223695 },
    ],
  },
  finearts: {
    name: "Fine Arts Library",
    lid: 1412,
    location: "Fiske Kimball Fine Arts Library, Rugby Road",
    directUrl: "https://cal.lib.virginia.edu/spaces?lid=1412",
    rooms: [
      { name: "Fine Arts Conference Room", capacity: 8, eid: 8388 },
      { name: "Fine Arts Materials Collection Room", capacity: 8, eid: 8389 },
      { name: "Fine Arts R Lab (Mediated)", capacity: 8, eid: 8473 },
    ],
  },
  music: {
    name: "Music Library",
    lid: 263,
    location: "Old Cabell Hall, Central Grounds",
    directUrl: "https://cal.lib.virginia.edu/spaces?lid=263",
    rooms: [
      { name: "L013 - Group Study Room", capacity: 10, eid: 8447 },
      { name: "L016 - Group Study Room", capacity: 4, eid: 158147 },
    ],
  },
  scholarslab: {
    name: "Scholars' Lab",
    lid: 14313,
    location: "Shannon Library, Room 308",
    directUrl: "https://cal.lib.virginia.edu/spaces?lid=14313",
    rooms: [
      { name: "Common Room (Rm 308)", capacity: 48, eid: 170573 },
      { name: "308K (Consultation Room)", capacity: 4, eid: 171513 },
      { name: "VR Space", capacity: 4, eid: 171514 },
      { name: "Presentation Space", capacity: 40, eid: 171527 },
      { name: "Training Workstations", capacity: 8, eid: 171533 },
    ],
  },
  brown: {
    name: "Brown Science & Engineering Library",
    lid: 1411,
    location: "Brown/Mauer Hall, near SEAS",
    directUrl: "https://cal.lib.virginia.edu/spaces?lid=1411",
    rooms: [
      { name: "Brown 145 - Sensory Room", capacity: 4, eid: 158145 },
      { name: "Brown 147", capacity: 6, eid: 8403 },
      { name: "Brown 148", capacity: 20, eid: 8402 },
      { name: "Brown 155", capacity: 10, eid: 8405 },
      { name: "Brown 156", capacity: 14, eid: 8406 },
      { name: "Brown G-046", capacity: 6, eid: 8407 },
      { name: "Study Table A", capacity: 6, eid: 31372 },
      { name: "Study Table B", capacity: 6, eid: 31376 },
    ],
  },
};

function resolveLibrary(hint) {
  if (!hint) return null;
  const h = hint.toLowerCase();
  if (h.includes("shannon") || h.includes("318") || h.includes("taylor")) return "shannon";
  if (h.includes("brown") || h.includes("mauer") || h.includes("seas library") || h.includes("science") && h.includes("engineering") && h.includes("lib")) return "brown";
  if (h.includes("clem 2") || h.includes("clem2") || h.includes("clemons 2") || h.includes("clemons2") || h.includes("georges") || h.includes("george")) return "clem2";
  if (h.includes("clemons") || h.includes("clem")) return "clemons";
  if (h.includes("rmc") || h.includes("robertson") || h.includes("media center")) return "rmc";
  if (h.includes("dml") || h.includes("digital media")) return "dml";
  if (h.includes("fine art") || h.includes("fiske")) return "finearts";
  if (h.includes("music") || h.includes("cabell")) return "music";
  if (h.includes("scholar")) return "scholarslab";
  return null;
}

function getETDateString(dayOffset = 0) {
  const d = new Date(Date.now() + dayOffset * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function nextDayStr(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function resolveDate(dateInput) {
  if (!dateInput || dateInput === "today") return getETDateString(0);
  if (dateInput === "tomorrow") return getETDateString(1);
  // Valid ISO date — use directly
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
  // Day names: "saturday", "next saturday", "this friday", etc.
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const normalized = dateInput.toLowerCase().replace(/^(next|this)\s+/, "").trim();
  const dayIdx = DAYS.indexOf(normalized);
  if (dayIdx !== -1) {
    const todayDayName = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" }).toLowerCase();
    const todayIdx = DAYS.indexOf(todayDayName);
    const diff = ((dayIdx - todayIdx + 7) % 7) || 7; // always next occurrence, never today
    return getETDateString(diff);
  }
  // Generic fallback (e.g. "March 28, 2026")
  const d = new Date(dateInput);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return getETDateString(0);
}

function parseTimeHint(hint) {
  if (!hint) return null;
  const m = hint.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h * 60 + min;
}

// fmt12: convert a minute value (may exceed 1440 for late-night spillover) to 12-hr string.
// 1440 → "12:00 AM", 1500 → "1:00 AM", etc.
function fmt12(totalMin) {
  const norm = totalMin % (24 * 60);
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

// Group a sorted array of integer minute values into human-readable ranges.
// Accepts values > 1440 for late-night spillover (e.g. 1470 = 12:30 AM next day).
// e.g. [600,630,660,780,810] → ["10:00 AM – 11:30 AM", "1:00 PM – 2:00 PM"]
function groupMinsToRanges(sortedMins) {
  if (!sortedMins || !sortedMins.length) return [];
  const ranges = [];
  let start = sortedMins[0], end = sortedMins[0] + 30;
  for (let i = 1; i < sortedMins.length; i++) {
    if (sortedMins[i] === end) { end += 30; }
    else { ranges.push(`${fmt12(start)} – ${fmt12(end)}`); start = sortedMins[i]; end = sortedMins[i] + 30; }
  }
  ranges.push(`${fmt12(start)} – ${fmt12(end)}`);
  return ranges;
}

// POST to LibCal's availability grid endpoint (works without auth)
async function fetchLibraryAvailability(lid, rooms, dateStr) {
  const eids = rooms.filter((r) => r.eid);
  if (!eids.length) return null;

  const params = new URLSearchParams();
  params.append("lid", lid);
  params.append("gid", "0");
  for (const r of eids) params.append("eid[]", r.eid);
  params.append("start", dateStr);
  params.append("end", nextDayStr(nextDayStr(dateStr))); // 2 days to capture late-night spillover
  params.append("pageIndex", "0");
  params.append("pageSize", String(eids.length + 5));
  const body = params.toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "cal.lib.virginia.edu",
        path: "/spaces/availability/grid",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "Referer": `https://cal.lib.virginia.edu/spaces?lid=${lid}`,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (compatible)",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error("Bad JSON from LibCal")); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Check real-time study room availability at a UVA library.
 * Returns a structured object (not a string) so the agent loop can use it for
 * both the Gemini summary and the [BOOK_ROOM:JSON] frontend panel.
 */
async function checkLibraryAvailability({ library, date, time }) {
  const key = resolveLibrary(library);
  const libData = key ? LIBRARY_ROOMS[key] : null;

  if (!libData) {
    return {
      type: "library_list",
      message: "Here are all UVA libraries with bookable spaces:",
      libraries: Object.values(LIBRARY_ROOMS).map((l) => ({
        name: l.name,
        location: l.location,
        roomCount: l.rooms.length,
        bookingUrl: l.directUrl,
      })),
      mainBookingUrl: "https://cal.lib.virginia.edu/",
    };
  }

  const dateStr = resolveDate(date);
  // Enforce 2-week booking limit
  const todayDate = new Date(getETDateString(0) + "T00:00:00");
  const targetDate = new Date(dateStr + "T00:00:00");
  const diffDays = Math.round((targetDate - todayDate) / 86400000);
  if (diffDays > 14) {
    return {
      type: "too_far",
      message: `Library rooms can only be booked up to 2 weeks in advance. ${dateStr} is ${diffDays} days away — please check cal.lib.virginia.edu directly for dates beyond 2 weeks.`,
      bookingUrl: "https://cal.lib.virginia.edu/",
    };
  }
  const timeMinutes = parseTimeHint(time);

  // Try live availability for rooms with known eids
  const roomsWithEid = libData.rooms.filter((r) => r.eid);
  if (roomsWithEid.length > 0) {
    try {
      const data = await fetchLibraryAvailability(libData.lid, roomsWithEid, dateStr);
      const slots = data?.slots || [];

      const nextDate = nextDayStr(dateStr);
      const eidToRoom = Object.fromEntries(roomsWithEid.map((r) => [r.eid, r]));
      const availableByEid = {};

      for (const slot of slots) {
        // no className = available (green bookable slot); s-lc-eq-checkout = already taken (grey)
        if (slot.className) continue;
        const room = eidToRoom[slot.itemId];
        if (!room) continue;

        const slotDate = slot.start.slice(0, 10);
        const [h, m] = slot.start.slice(11, 16).split(":").map(Number);

        let extMin; // "extended minutes" — may exceed 1440 for late-night spillover
        if (slotDate === dateStr) {
          extMin = h * 60 + m; // normal same-day slot
        } else if (slotDate === nextDate && h < 6) {
          extMin = (h + 24) * 60 + m; // spillover: 1:00 AM next day → 25*60=1500, sorts after 23:30
        } else {
          continue; // outside the range we care about
        }

        if (!availableByEid[slot.itemId]) {
          availableByEid[slot.itemId] = { room, extMins: [] };
        }
        availableByEid[slot.itemId].extMins.push(extMin);
      }

      let roomResults = Object.values(availableByEid)
        .map(({ room, extMins }) => {
          let filtered = extMins;
          if (timeMinutes !== null) {
            const lo = timeMinutes - 30;
            const hi = timeMinutes + 120;
            filtered = extMins.filter((em) =>
              // Check normal range, and also the +24h extended range (for near-midnight queries)
              (em >= lo && em <= hi) || (em >= lo + 1440 && em <= hi + 1440)
            );
          }
          const sortedMins = filtered.sort((a, b) => a - b);
          return {
            name: room.name,
            capacity: room.capacity,
            eid: room.eid,
            availableRanges: groupMinsToRanges(sortedMins),
            bookingUrl: `https://cal.lib.virginia.edu/spaces?lid=${libData.lid}&eid=${room.eid}&d=${dateStr}`,
          };
        })
        .filter((r) => r.availableRanges.length > 0)
        .sort((a, b) => b.capacity - a.capacity);

      return {
        type: "rooms_available",
        library: libData.name,
        location: libData.location,
        date: dateStr,
        timeHint: time || null,
        availableRooms: roomResults,
        totalAvailable: roomResults.length,
        allRoomsUrl: `https://cal.lib.virginia.edu/spaces?lid=${libData.lid}&d=${dateStr}`,
        bookingUrl: libData.directUrl,
      };
    } catch (e) {
      console.error("[checkLibraryAvailability] fetch error:", e.message);
    }
  }

  // Fallback: static room list with booking link (include date so link lands on the right day)
  return {
    type: "rooms_static",
    library: libData.name,
    location: libData.location,
    date: dateStr,
    rooms: libData.rooms.map((r) => ({ name: r.name, capacity: r.capacity })),
    bookingUrl: `https://cal.lib.virginia.edu/spaces?lid=${libData.lid}&d=${dateStr}`,
    note: "Live availability not currently available for this library — visit the booking link for real-time slots.",
  };
}

// ─── Booking guidance for non-library categories ──────────────────────────────
const BOOKING_SYSTEMS = {
  rec_fitness_class: {
    system: "rec",
    name: "AFC / RecSports Fitness Class",
    primaryUrl: "https://rec.virginia.edu",
    deepLink: "https://rec.virginia.edu/active/fitness/group-fitness",
    venues: [
      { name: "Aquatic & Fitness Center (AFC)", location: "Next to Scott Stadium" },
      { name: "Memorial Gymnasium", location: "Central Grounds, Alderman Road area" },
    ],
    steps: [
      "Go to rec.virginia.edu and navigate to 'Fitness & Wellness' → 'Group Fitness'",
      "Sign in with your UVA NetBadge when prompted",
      "Browse the schedule for available classes (yoga, cycle, Zumba, HIIT, etc.)",
      "Click a class, select a time slot, and register",
      "Show up on time — spots may be released if you're late",
    ],
    policies: [
      "Classes open for registration 48 hours in advance",
      "Classes fill fast — register as soon as the window opens",
      "Free for all students with a valid UVA ID",
      "Cancel at least 2 hours before class to free the spot for others",
    ],
    disclaimers: [
      "Wrangler cannot register you for a class — you must sign in with NetBadge on the RecSports site.",
    ],
  },

  makerspace: {
    system: "library",
    name: "Makerspace / Recording Studio",
    primaryUrl: "https://cal.lib.virginia.edu/",
    deepLink: "https://cal.lib.virginia.edu/spaces?lid=241",
    venues: [
      { name: "Shannon Library Makerspace", location: "Shannon Library, Central Grounds — 3D printers, laser cutters, VR headsets, podcast recording booth" },
      { name: "Robertson Media Center (RMC)", location: "Clemons Library — audio studio, Steenbeck film editor, VizWall, VR stations" },
      { name: "Digital Media Lab (DML)", location: "Clemons Library lower level — audio/video digitization workstations, photography studio" },
      { name: "Thornton MakerGrounds", location: "Thornton Hall, SEAS — engineering fabrication and prototyping" },
    ],
    steps: [
      "Go to cal.lib.virginia.edu",
      "Click 'Reserve a Space' and select the makerspace or studio you need",
      "Sign in with your UVA NetBadge",
      "Choose a date and time slot",
      "Confirm reservation — some equipment (laser cutters, 3D printers) requires a safety orientation first",
    ],
    policies: [
      "Book up to 2 weeks in advance",
      "Some equipment requires completed safety training before use",
      "Check library.virginia.edu for equipment-specific availability and orientation schedules",
    ],
    disclaimers: [
      "Wrangler cannot complete the reservation — you must sign in with NetBadge on the LibCal booking site.",
    ],
  },

  meeting_space: {
    system: "other",
    name: "Meeting / Event Space",
    primaryUrl: "https://25live.collegenet.com/pro/virginia",
    deepLink: "https://25live.collegenet.com/pro/virginia",
    venues: [
      { name: "Newcomb Hall meeting rooms", location: "Newcomb Hall, Central Grounds" },
      { name: "Various classroom spaces", location: "Across Grounds — bookable for student org events" },
    ],
    steps: [
      "Go to 25Live at 25live.collegenet.com/pro/virginia",
      "Sign in with your UVA NetBadge",
      "Search for available rooms by date, time, capacity, and building",
      "Submit a reservation request — some spaces require approval from the Events office",
      "Wait for a confirmation email before advertising the event",
    ],
    policies: [
      "Student organizations can book rooms through 25Live",
      "Some high-demand spaces (e.g., Newcomb Ballroom) require advance booking and approval",
      "Cancellation policy varies by space — check the confirmation email",
      "For large events, contact the Events Management office directly",
    ],
    disclaimers: [
      "Wrangler cannot complete the reservation — submit through 25Live with your NetBadge.",
    ],
  },
};

async function getCampusBookingGuide({ category, venueHint, dateHint }) {
  // Library study rooms now go through checkLibraryAvailability instead
  if (category === "library_study_room") {
    return JSON.stringify({
      system: "library",
      name: "Library Study Room",
      primaryUrl: "https://cal.lib.virginia.edu/",
      steps: [
        "Go to cal.lib.virginia.edu and click 'Reserve a Space'",
        "Choose a library: Shannon, Clemons, Fine Arts, Music, RMC, or DML",
        "Select 'Group Study Rooms' (or 'Conference Rooms', 'Study Tables', etc.) from the category dropdown",
        "Pick a date and available time slot",
        "Sign in with your UVA NetBadge to confirm — you'll get a confirmation email",
      ],
      policies: [
        "Book up to 2 weeks in advance",
        "Typical blocks are 2 hours (may vary by room)",
        "No-show policy: if you don't check in, the room may be released to others",
        "Available to all current UVA students, faculty, and staff",
      ],
      venues: Object.values(LIBRARY_ROOMS).map((l) => ({
        name: l.name,
        location: l.location,
        bookingUrl: l.directUrl,
      })),
      tip: "For real-time availability, ask me 'What study rooms are open at Shannon at 2pm?' and I'll check live.",
    });
  }

  const info = BOOKING_SYSTEMS[category];
  if (!info) {
    return JSON.stringify({
      error: `Unknown booking category "${category}". Known: rec_fitness_class, makerspace, meeting_space.`,
      tip: "For library study rooms, ask about availability directly (e.g. 'open rooms at Clemons today').",
    });
  }

  const result = {
    system: info.system,
    name: info.name,
    primaryUrl: info.primaryUrl,
    deepLink: info.deepLink,
    venues: info.venues,
    steps: info.steps,
    policies: info.policies,
    disclaimers: info.disclaimers,
  };
  if (venueHint) result.venueHint = venueHint;
  if (dateHint) result.dateHint = dateHint;

  return JSON.stringify(result);
}

module.exports = { getCampusBookingGuide, checkLibraryAvailability };
