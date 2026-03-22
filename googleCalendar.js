const { google } = require("googleapis");
const { pool } = require("./db");

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
}

async function getCalendarAuth(userId) {
  const result = await pool.query(
    "SELECT google_refresh_token FROM users WHERE id = $1",
    [userId]
  );
  const refreshToken = result.rows[0]?.google_refresh_token;
  if (!refreshToken) {
    throw new Error("Calendar not connected. Use the Connect Google Calendar button in the app to grant access, then try again.");
  }
  const auth = makeOAuth2Client();
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

async function createCalendarEvent(userId, { title, startDateTime, endDateTime, location, description, timeZone, attendees }) {
  const tz = timeZone || "America/New_York";
  const auth = await getCalendarAuth(userId);
  const calendar = google.calendar({ version: "v3", auth });

  const event = {
    summary: title,
    start: { dateTime: startDateTime, timeZone: tz },
    end: { dateTime: endDateTime, timeZone: tz },
  };
  if (location) event.location = location;
  if (description) event.description = description;
  if (attendees?.length) {
    event.attendees = attendees.map((email) => ({ email }));
  }

  const res = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: attendees?.length ? "all" : "none",
    requestBody: event,
  });

  const eventPayload = JSON.stringify({
    title: res.data.summary,
    start: startDateTime,
    end: endDateTime,
    location: location || null,
    link: res.data.htmlLink,
    timeZone: tz,
    attendees: attendees || [],
  });
  return `Event created successfully. [CALENDAR_EVENT:${eventPayload}]`;
}

function toRFC3339(val) {
  if (!val) return null;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

async function findCalendarEvents(userId, { query, timeMin, timeMax, maxResults = 5 }) {
  const auth = await getCalendarAuth(userId);
  const calendar = google.calendar({ version: "v3", auth });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksLater = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // When a keyword query is provided, ignore any narrow timeMin/timeMax from
  // the model — it frequently passes timezone-naive strings that get misread
  // as UTC, cutting out events that are actually in the window. Use the wide
  // default instead so the keyword search finds the event regardless of time.
  const resolvedTimeMin = (query && query.trim()) ? sevenDaysAgo : (toRFC3339(timeMin) || sevenDaysAgo);
  const resolvedTimeMax = (query && query.trim()) ? twoWeeksLater : (toRFC3339(timeMax) || twoWeeksLater);

  const params = {
    calendarId: "primary",
    maxResults: Math.max(1, Math.min(20, parseInt(maxResults) || 5)),
    singleEvents: true,
    orderBy: "startTime",
    timeMin: resolvedTimeMin,
    timeMax: resolvedTimeMax,
  };
  if (query && query.trim()) params.q = query.trim();

  console.log("[findCalendarEvents] params:", JSON.stringify(params));
  const res = await calendar.events.list(params);
  const events = res.data.items;
  if (!events?.length) return "No events found matching your criteria.";

  return events
    .map((e) => {
      const start = e.start.dateTime || e.start.date;
      const attendeeList = e.attendees?.map((a) => a.email).join(", ") || "none";
      return `ID: ${e.id} | Title: ${e.summary} | Start: ${start} | Attendees: ${attendeeList} | Link: ${e.htmlLink}`;
    })
    .join("\n");
}

async function deleteCalendarEvent(userId, { eventId }) {
  const auth = await getCalendarAuth(userId);
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.delete({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
  });

  return `Event deleted successfully.`;
}

async function updateCalendarEventAttendees(userId, { eventId, attendeeEmails }) {
  const auth = await getCalendarAuth(userId);
  const calendar = google.calendar({ version: "v3", auth });

  // Fetch existing event to merge attendees
  const existing = await calendar.events.get({ calendarId: "primary", eventId });
  const currentAttendees = existing.data.attendees || [];
  const currentEmails = new Set(currentAttendees.map((a) => a.email));

  const newAttendees = [
    ...currentAttendees,
    ...attendeeEmails.filter((e) => !currentEmails.has(e)).map((email) => ({ email })),
  ];

  const res = await calendar.events.patch({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
    requestBody: { attendees: newAttendees },
  });

  const eventPayload = JSON.stringify({
    title: res.data.summary,
    start: res.data.start.dateTime || res.data.start.date,
    end: res.data.end.dateTime || res.data.end.date,
    location: res.data.location || null,
    link: res.data.htmlLink,
    timeZone: res.data.start.timeZone || "America/New_York",
    attendees: newAttendees.map((a) => a.email),
  });
  return `Invites sent to ${attendeeEmails.join(", ")}. [CALENDAR_EVENT:${eventPayload}]`;
}

module.exports = { createCalendarEvent, findCalendarEvents, deleteCalendarEvent, updateCalendarEventAttendees };
