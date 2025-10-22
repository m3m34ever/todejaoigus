// server.js (ES module)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
app.set('trust proxy', true);
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server);

app.post("/api/admin-auth", (req, res) => {
  try {
    const ip = getIpFromReq(req);
    const { password } = req.body || {};
    if (!password) {
      fs.appendFile(LOG_FILE, `[ADMIN AUTH] [${time}] IP ${ip || 'unknown'} attempted admin auth with incorrect password\n`, (e)=>{ if(e) console.error(e); });
    return res.status(400).json({ ok: false })
    };
    const success = password === ADMIN_PASSWORD;
    fs.appendFile(LOG_FILE, `[ADMIN AUTH] [${time}] IP: ${ip || 'unknown'} - ${success ? 'success' : 'failure'}\n`, (e)=>{ if(e) console.error(e); });
    if (success) return res.json({ ok: true });
    return res.status(401).json({ ok: false });
  } catch (err) {
    console.error("Error in admin auth:", err);
    return res.status(500).json({ ok: false });
  }
});

function getIpFromReq(req) {
  return (
    (req.headers && req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) ||
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    null
  );
}

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

  const ip = 
  (socket.handshake && socket.handshake.headers && socket.handshake.headers['x-forwarded-for'] && socket.handshake.headers['x-forwarded-for'].split(',')[0].trim()) ||
  socket.handshake?.address ||
  socket.request?.socket?.remoteAddress ||
  socket.conn?.remoteAddress ||
  null;

  socket.data.ip = ip;
  console.log("A user connected", ip ? `from IP: ${ip}` : '');

  // Send existing messages to the new user (without emails)
  socket.emit("init", messages.map(m => ({ text: m.text, time: m.time, hasEmail: !!m.email })));

  // Handle new messages
  socket.on("newText", (data) => {
    const msg = {
      text: data.text,
      email: data.email || null,
      time: new Date().toISOString(),
      ip: socket.data.ip || null
    };

    // Save in memory
    messages.push(msg);
    saveState();

    // Broadcast message text to all clients (email stays private)
    io.emit("newText", { text: msg.text, time: msg.time, hasEmail: !!msg.email });

    // Log to server console
    const logEntry = `[${msg.time}] ${msg.text}` +
    (msg.email ? ` | Email: ${msg.email}` : "") +
    (msg.ip ? ` | IP: ${msg.ip}` : "") + "\n";

    fs.appendFile(LOG_FILE, logEntry, (err) => {
      if (err) console.error("Error writing to log file:", err);
    });

    if (msg.email) {
      const emailLogEntry = `[${msg.time}] ${msg.text}` + (msg.email ? ` | Email: ${msg.email}` : "") + "\n";
      fs.appendFile(EMAIL_LOG_FILE, emailLogEntry, (err) => {
        if (err) console.error("Error writing to email log file:", err);
      });
    }
    console.log(`[NEW MESSAGE] ${msg.text}` + (msg.ip ? ` (from ${msg.ip})` : ''));
    if (msg.email) console.log(`  Feedback email: ${msg.email}`);
  });
  socket.on("disconnect", () => {
    console.log("A user disconnected", ip ? `from IP: ${ip}` : '');
  });
});

app.post("/api/admin/emails", (req, res) => {
  try {
    const ip = getIpFromReq(req);
    const supplied =
      (req.body && req.body.password) ||
      (req.headers && req.headers.authorization && req.headers.authorization.split(" ")[1]);

    const time = new Date().toISOString();

    if (!supplied || supplied !== ADMIN_PASSWORD) {
      fs.appendFile(LOG_FILE, `[ADMIN EMAILS] [${time}] IP: ${ip || 'unknown'} - unauthorized attempt\n`, (e)=>{ if(e) console.error(e); });
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    fs.appendFile(LOG_FILE, `[ADMIN EMAILS] [${time}] IP: ${ip || 'unknown'} - authorized fetch\n`, (e)=>{ if(e) console.error(e); });

    if (!fs.existsSync(EMAIL_LOG_FILE)) {
      return res.type("text/plain").send("");
    }

    let content = fs.readFileSync(EMAIL_LOG_FILE, "utf8");

    const MAX_BYTES = 5_000_000; // 5MB
    if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
      content = content.slice(-MAX_BYTES);
      const nl = content.indexOf("\n");
      if (nl >= 0) content = content.slice(nl + 1);
    }

    res.type("text/plain").send(content);
  } catch (err) {
    console.error("Error reading email log:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

