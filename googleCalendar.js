const { google } = require("googleapis");
const { pool } = require("./db");

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
}

async function createCalendarEvent(userId, { title, startDateTime, endDateTime, location, description, timeZone }) {
  const tz = timeZone || "America/New_York";

  const result = await pool.query(
    "SELECT google_refresh_token FROM users WHERE id = $1",
    [userId]
  );
  const refreshToken = result.rows[0]?.google_refresh_token;
  if (!refreshToken) {
    return "Calendar not connected. Use the Connect Google Calendar button in the app to grant access, then try again.";
  }

  const auth = makeOAuth2Client();
  auth.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: "v3", auth });

  const event = {
    summary: title,
    start: { dateTime: startDateTime, timeZone: tz },
    end: { dateTime: endDateTime, timeZone: tz },
  };
  if (location) event.location = location;
  if (description) event.description = description;

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
  });

  const eventPayload = JSON.stringify({
    title: res.data.summary,
    start: startDateTime,
    end: endDateTime,
    location: location || null,
    link: res.data.htmlLink,
    timeZone: tz,
  });
  return `Event created successfully. [CALENDAR_EVENT:${eventPayload}]`;
}

module.exports = { createCalendarEvent };
