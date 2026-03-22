const express = require("express");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");
const { pool } = require("./db");

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3001";
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
    const { id, email, name, picture, school, year } = result.rows[0];
    res.json({ userId: id, email, name, picture, school, year });
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

module.exports = { router, requireAuth };
