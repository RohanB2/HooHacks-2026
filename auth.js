const express = require("express");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const { pool } = require("./db");

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3001";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-prod";

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.BACKEND_URL || "http://localhost:3000"}/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const { id: googleId, displayName: name, emails, photos } = profile;
          const email = emails?.[0]?.value;
          const picture = photos?.[0]?.value;

          const result = await pool.query(
            `INSERT INTO users (google_id, email, name, picture)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (google_id) DO UPDATE
               SET email = EXCLUDED.email,
                   name = EXCLUDED.name,
                   picture = EXCLUDED.picture
             RETURNING *`,
            [googleId, email, name, picture]
          );
          return done(null, result.rows[0]);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

function issueToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, name: user.name, picture: user.picture },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Initiate Google OAuth
router.get("/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Google OAuth not configured" });
  }
  passport.authenticate("google", { scope: ["profile", "email"], session: false })(req, res, next);
});

// Google OAuth callback
router.get("/google/callback", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.redirect(`${FRONTEND_URL}?auth=failed`);
  }
  passport.authenticate("google", { session: false, failureRedirect: `${FRONTEND_URL}?auth=failed` }, (err, user) => {
    if (err || !user) return res.redirect(`${FRONTEND_URL}?auth=failed`);
    const token = issueToken(user);
    res.redirect(`${FRONTEND_URL}?token=${token}`);
  })(req, res, next);
});

// Get current user
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    const { id, email, name, picture, school, year, google_refresh_token } = result.rows[0];
    res.json({ userId: id, email, name, picture, school, year, calendarConnected: !!google_refresh_token });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

// Update user profile (school/year)
router.patch("/me", requireAuth, async (req, res) => {
  const { school, year } = req.body;
  try {
    const result = await pool.query(
      "UPDATE users SET school = $1, year = $2 WHERE id = $3 RETURNING id, email, name, picture, school, year",
      [school ?? null, year ?? null, req.user.userId]
    );
    const u = result.rows[0];
    res.json({ userId: u.id, email: u.email, name: u.name, picture: u.picture, school: u.school, year: u.year });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

// ─── Google Calendar OAuth (separate from sign-in) ───────────────────────────
// Initiates consent for calendar.events scope. The user must already be signed
// in — their userId is encoded in the OAuth `state` parameter so the callback
// knows which DB row to attach the refresh token to.

router.get("/google/calendar", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Google OAuth not configured" });
  }
  // Accept JWT via query param since browser link navigations can't send headers
  const tokenStr = req.query.token;
  if (!tokenStr) return res.redirect(`${FRONTEND_URL}?calendar=failed`);
  let decoded;
  try { decoded = jwt.verify(tokenStr, JWT_SECRET); } catch {
    return res.redirect(`${FRONTEND_URL}?calendar=failed`);
  }
  const state = jwt.sign({ userId: decoded.userId }, JWT_SECRET, { expiresIn: "10m" });
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BACKEND_URL}/auth/google/calendar/callback`
  );
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state,
  });
  res.redirect(url);
});

router.get("/google/calendar/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.redirect(`${FRONTEND_URL}?calendar=failed`);

  let payload;
  try {
    payload = jwt.verify(state, JWT_SECRET);
  } catch {
    return res.redirect(`${FRONTEND_URL}?calendar=failed`);
  }

  try {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${BACKEND_URL}/auth/google/calendar/callback`
    );
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      return res.redirect(`${FRONTEND_URL}?calendar=failed`);
    }

    await pool.query(
      "UPDATE users SET google_refresh_token = $1 WHERE id = $2",
      [tokens.refresh_token, payload.userId]
    );

    res.redirect(`${FRONTEND_URL}?calendar=connected`);
  } catch (err) {
    console.error("Calendar OAuth error:", err);
    res.redirect(`${FRONTEND_URL}?calendar=failed`);
  }
});

module.exports = { router, requireAuth };
