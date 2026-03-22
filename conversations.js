const express = require("express");
const { pool } = require("./db");
const { requireAuth } = require("./auth");

const router = express.Router();
router.use(requireAuth);

// List recent conversations
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20",
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

// Create conversation
router.post("/", async (req, res) => {
  const { title } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING *",
      [req.user.userId, title || "New conversation"]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

// Get conversation + messages
router.get("/:id", async (req, res) => {
  try {
    const conv = await pool.query(
      "SELECT * FROM conversations WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.userId]
    );
    if (!conv.rows[0]) return res.status(404).json({ error: "Not found" });

    const msgs = await pool.query(
      "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json({ ...conv.rows[0], messages: msgs.rows });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

// Delete conversation
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.user.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

// Save messages batch
router.post("/:id/messages", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }
  try {
    // Verify ownership
    const conv = await pool.query(
      "SELECT id FROM conversations WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.userId]
    );
    if (!conv.rows[0]) return res.status(404).json({ error: "Not found" });

    for (const msg of messages) {
      await pool.query(
        "INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)",
        [req.params.id, msg.role, msg.content]
      );
    }
    // Touch updated_at
    await pool.query(
      "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );
    res.json({ saved: messages.length });
  } catch (err) {
    res.status(500).json({ error: "DB error" });
  }
});

module.exports = router;
