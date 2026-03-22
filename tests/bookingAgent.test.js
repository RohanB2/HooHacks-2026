const { getCampusBookingGuide } = require("../bookingAgent");

// ── Intent pattern tests ────────────────────────────────────────────────────
// Mirror the exact regex from server.js so we can unit-test routing.
const RESERVATION_INTENT_PATTERN = new RegExp(
  [
    "reserv",
    "book.{0,10}(a |the |my )?(study |library |group )?room",
    "study room",
    "group room",
    "lib\\.virginia\\.edu/spaces",
    "libcal",
    "recording studio",
    "makerspace",
    "maker space",
    "3d print",
    "laser cut",
    "book.{0,10}(a |the |my )?(fitness |afc |gym )?class",
    "sign.?up.{0,10}(for )?(a )?(fitness|afc|gym|yoga|cycle|zumba)",
    "25live",
    "event space",
  ].join("|"),
  "i"
);

describe("RESERVATION_INTENT_PATTERN", () => {
  const shouldMatch = [
    "How do I reserve a library study room?",
    "I want to book a study room at Shannon",
    "Can I reserve a group room in Brown Library?",
    "book a room for my project team",
    "How do I use libcal?",
    "I need a recording studio",
    "Where's the makerspace?",
    "Can I use a 3D printer at Shannon?",
    "How to book a fitness class at AFC",
    "sign up for yoga at the AFC",
    "How do I use 25Live to book a room?",
    "I need an event space for my club meeting",
    "reserve a study room for tomorrow",
    "book the recording studio in Shannon",
    "sign up for a zumba class",
    "laser cutter reservation",
  ];

  const shouldNotMatch = [
    "What's the weather today?",
    "Tell me about UVA history",
    "What dining halls are open?",
    "How do I get to the Rotunda?",
    "Who teaches CS 2150?",
  ];

  test.each(shouldMatch)("matches: %s", (msg) => {
    expect(RESERVATION_INTENT_PATTERN.test(msg)).toBe(true);
  });

  test.each(shouldNotMatch)("does NOT match: %s", (msg) => {
    expect(RESERVATION_INTENT_PATTERN.test(msg)).toBe(false);
  });
});

// ── getCampusBookingGuide tests ─────────────────────────────────────────────
describe("getCampusBookingGuide", () => {
  test("returns structured JSON for library_study_room", async () => {
    const result = await getCampusBookingGuide({ category: "library_study_room" });
    const parsed = JSON.parse(result);

    expect(parsed.system).toBe("library");
    expect(parsed.primaryUrl).toContain("cal.lib.virginia.edu");
    expect(parsed.steps).toBeInstanceOf(Array);
    expect(parsed.steps.length).toBeGreaterThan(0);
    expect(parsed.policies).toBeInstanceOf(Array);
    expect(parsed.disclaimers).toBeInstanceOf(Array);
    expect(parsed.disclaimers[0]).toMatch(/cannot complete/i);
  });

  test("returns structured JSON for rec_fitness_class", async () => {
    const result = await getCampusBookingGuide({ category: "rec_fitness_class" });
    const parsed = JSON.parse(result);

    expect(parsed.system).toBe("rec");
    expect(parsed.primaryUrl).toContain("recsports.virginia.edu");
    expect(parsed.steps.length).toBeGreaterThan(0);
    expect(parsed.policies.some((p) => p.includes("48 hours"))).toBe(true);
  });

  test("returns structured JSON for makerspace", async () => {
    const result = await getCampusBookingGuide({ category: "makerspace" });
    const parsed = JSON.parse(result);

    expect(parsed.system).toBe("library");
    expect(parsed.venues.some((v) => v.name.includes("Shannon"))).toBe(true);
  });

  test("returns structured JSON for meeting_space", async () => {
    const result = await getCampusBookingGuide({ category: "meeting_space" });
    const parsed = JSON.parse(result);

    expect(parsed.system).toBe("other");
    expect(parsed.primaryUrl).toContain("25live");
  });

  test("returns error for unknown category", async () => {
    const result = await getCampusBookingGuide({ category: "swimming_pool" });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/unknown booking category/i);
  });

  test("includes venueHint and dateHint when provided", async () => {
    const result = await getCampusBookingGuide({
      category: "library_study_room",
      venueHint: "Shannon Library",
      dateHint: "tomorrow afternoon",
    });
    const parsed = JSON.parse(result);

    expect(parsed.venueHint).toBe("Shannon Library");
    expect(parsed.dateHint).toBe("tomorrow afternoon");
  });
});
