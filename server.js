// server.js (ES module)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server);

app.post("/api/admin-auth", (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ ok: false });
    if (password === ADMIN_PASSWORD) return res.json({ ok: true });
    return res.status(401).json({ ok: false });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
});

// external persistence file path
let LOG_FILE = process.env.LOG_FILE || './logs/messages.log';
let EMAIL_LOG_FILE = process.env.EMAIL_LOG_FILE || './logs/email_messages.log';
let STATE_FILE = process.env.STATE_FILE || './data/state.json';

function prepareFile(filePath) {
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return filePath;
  } catch (err) {
    if (err && err.code === 'EACCES') {
      console.error('Permission denied creating', dir, '- falling back to ./data');
      const fallbackDir = path.join(process.cwd(), 'data');
      try { fs.mkdirSync(fallbackDir, { recursive: true }); } catch (e) { /* ignore */ }
      return path.join(fallbackDir, path.basename(filePath));
    }
    throw err;
  }
}

LOG_FILE = prepareFile(LOG_FILE);
EMAIL_LOG_FILE = prepareFile(EMAIL_LOG_FILE);
STATE_FILE = prepareFile(STATE_FILE);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'kylltulebarmastus';
const PORT = process.env.PORT || 3000;

// admin pwd - make sure to set via env variable in production!
function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureParentDir(LOG_FILE);
ensureParentDir(EMAIL_LOG_FILE);
ensureParentDir(STATE_FILE);

try {
  fs.mkdirSync('/app/logs', { recursive: true });
  fs.mkdirSync('/app/data', { recursive: true });
} catch (e) {
  console.error("Error creating directories:", e);
}

// Store messages in memory
let messages = [];

try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    messages = raw ? JSON.parse(raw) : [];
  } 
} catch (err) {
  console.error("Error loading state file:", err);
}
// Save state to file - synchronous to avoid race conditions
function saveState() {
  try {
    const tmp = STATE_FILE + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(messages), "utf8");
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error("Failed to save state file:", err);
  }
}

// Serve static files (HTML, JS, CSS, video)
app.use(express.static("public")); // put index.html, bubbles.js, video in 'public' folder

// Socket.io connection
io.on("connection", (socket) => {
  console.log("A user connected");

  // Send existing messages to the new user (without emails)
  socket.emit("init", messages.map(m => ({ text: m.text })));

  // Handle new messages
  socket.on("newText", (data) => {
    const msg = {
      text: data.text,
      email: data.email || null,
      time: new Date()
    };

    // Save in memory
    messages.push(msg);
    saveState();

    // Broadcast message text to all clients (email stays private)
    io.emit("newText", { text: msg.text });

    // Log to server console
    const logEntry = `[${msg.time.toISOString()}] ${msg.text}` + (msg.email ? ` | Email: ${msg.email}` : "") + "\n";

    fs.appendFile(LOG_FILE, logEntry, (err) => {
      if (err) console.error("Error writing to log file:", err);
    });

    if (msg.email) {
      fs.appendFile(EMAIL_LOG_FILE, logEntry, (err) => {
        if (err) console.error("Error writing to email log file:", err);
      });
    }
    console.log(`[NEW MESSAGE] ${msg.text}`);
    if (msg.email) console.log(`  Feedback email: ${msg.email}`);
  });
  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});