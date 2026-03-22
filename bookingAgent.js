const { searchUVA, extractPage } = require("./tavilySearch");

// Curated booking systems at UVA with official URLs, steps, and policies.
// Each entry is keyed by a stable category name that matches the Gemini tool enum.
const BOOKING_SYSTEMS = {
  library_study_room: {
    system: "library",
    name: "Library Study Room",
    primaryUrl: "https://cal.lib.virginia.edu/reserve/spaces",
    deepLink: "https://cal.lib.virginia.edu/reserve/spaces",
    venues: [
      { name: "Shannon Library", location: "Central Grounds, near the Rotunda" },
      { name: "Brown Science & Engineering Library", location: "Brown/Mauer Hall area, near SEAS" },
      { name: "Clemons Library", location: "Central Grounds" },
    ],
    steps: [
      "Go to cal.lib.virginia.edu/reserve/spaces",
      "Sign in with your UVA NetBadge (computing ID + password)",
      "Select the library and room type (study room, group room, recording studio, etc.)",
      "Pick a date and available time slot",
      "Confirm the reservation — you'll receive a confirmation email",
    ],
    policies: [
      "Book up to 2 weeks in advance",
      "Reservations are typically 2-hour blocks (may vary by room)",
      "No-show policy: if you don't check in, the room may be released",
      "Available to all current UVA students, faculty, and staff",
    ],
    disclaimers: [
      "Wrangler cannot complete the reservation for you — you must sign in with NetBadge on the booking site.",
    ],
  },

  rec_fitness_class: {
    system: "rec",
    name: "AFC / RecSports Fitness Class",
    primaryUrl: "https://recsports.virginia.edu",
    deepLink: "https://recsports.virginia.edu/group-fitness",
    venues: [
      { name: "Aquatic & Fitness Center (AFC)", location: "Next to Scott Stadium" },
      { name: "Memorial Gymnasium", location: "Central Grounds, Alderman Road area (under renovation until Fall 2026)" },
    ],
    steps: [
      "Go to recsports.virginia.edu and navigate to Group Fitness",
      "Sign in with your UVA NetBadge",
      "Browse available classes (yoga, cycle, Zumba, HIIT, etc.)",
      "Select a class and time slot, then register",
      "Show up on time — spots are released if you're late",
    ],
    policies: [
      "Classes open for registration 48 hours in advance",
      "Classes fill fast — register as soon as the window opens",
      "Free for all students with a valid UVA ID",
      "Cancellation: cancel at least 2 hours before class to free the spot",
    ],
    disclaimers: [
      "Wrangler cannot register you for a class — you must sign in with NetBadge on the RecSports site.",
    ],
  },

  makerspace: {
    system: "library",
    name: "Makerspace / Recording Studio",
    primaryUrl: "https://cal.lib.virginia.edu/reserve/spaces",
    deepLink: "https://cal.lib.virginia.edu/reserve/spaces",
    venues: [
      { name: "Shannon Library Makerspace", location: "Shannon Library, Central Grounds — 3D printers, laser cutters, VR headsets, podcast recording" },
      { name: "Thornton MakerGrounds", location: "Thornton Hall, SEAS — engineering fabrication and prototyping" },
    ],
    steps: [
      "Go to cal.lib.virginia.edu/reserve/spaces",
      "Sign in with your UVA NetBadge",
      "Select the makerspace or recording studio you need",
      "Choose a date and time slot",
      "Confirm reservation — some equipment requires a safety orientation first",
    ],
    policies: [
      "Book up to 2 weeks in advance",
      "Some equipment (laser cutters, 3D printers) requires a completed safety training",
      "Check lib.virginia.edu for equipment-specific availability and orientation schedules",
    ],
    disclaimers: [
      "Wrangler cannot complete the reservation for you — you must sign in with NetBadge on the booking site.",
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
      "Go to 25Live (25live.collegenet.com/pro/virginia)",
      "Sign in with your UVA NetBadge",
      "Search for available rooms by date, time, capacity, and building",
      "Submit a reservation request (some spaces require approval from the Events office)",
      "Wait for confirmation email before advertising the event",
    ],
    policies: [
      "Student organizations can book rooms through 25Live",
      "Some high-demand spaces (e.g., Newcomb Ballroom) require advance booking",
      "Cancellation policy varies by space — check the confirmation email",
      "For large events, contact the Events Management office directly",
    ],
    disclaimers: [
      "Wrangler cannot complete the reservation for you — submit through 25Live with your NetBadge.",
    ],
  },
};

/**
 * Returns structured booking guidance for a campus reservation category.
 * Optionally enriches with live web data when Tavily is available.
 */
async function getCampusBookingGuide({ category, venueHint, dateHint }) {
  const info = BOOKING_SYSTEMS[category];

  if (!info) {
    const knownCategories = Object.keys(BOOKING_SYSTEMS).join(", ");
    return JSON.stringify({
      system: "unknown",
      error: `Unknown booking category "${category}". Known categories: ${knownCategories}.`,
      suggestion: "Try webSearch to find the right booking system for this request.",
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

  if (venueHint) {
    result.venueHint = venueHint;
  }
  if (dateHint) {
    result.dateHint = dateHint;
  }

  // Enrich with live availability data if Tavily is configured
  if (process.env.TAVILY_API_KEY && (venueHint || dateHint)) {
    try {
      const query = `UVA ${info.name} ${venueHint || ""} ${dateHint || ""} availability`.trim();
      const searchResults = await searchUVA(query);
      if (searchResults && searchResults !== "No results found.") {
        result.liveSearchResults = searchResults.slice(0, 3000);
      }
    } catch {
      // Live enrichment is best-effort
    }
  }

  return JSON.stringify(result);
}

module.exports = { getCampusBookingGuide };
