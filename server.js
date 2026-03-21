require("dotenv").config();
const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = "gemini-2.0-flash";

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const model = genAI.getGenerativeModel({ model: MODEL });
  const result = await model.generateContent(message);
  const reply = result.response.text();

  res.json({ reply, model: MODEL });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
