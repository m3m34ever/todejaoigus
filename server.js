// server.js (ES module)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import nodemailer from "nodemailer";
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import DOMPurify from 'isomorphic-dompurify';
import crypto from 'crypto';
import FileStore from 'session-file-store';
import { exec } from "child_process";
import { promisify } from "util";

dotenv.config();

const NOTIFY_LIST = (process.env.NOTIFY_LIST || "").split(",").map(s => s.trim()).filter(Boolean); // recipients
const EMAIL_FROM = process.env.EMAIL_FROM || `no-reply@${process.env.DOMAIN || "example.com"}`;
const clientRateMap = new Map(); // IP -> { count, resetTime }
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_MESSAGES = 10; // max messages per window
const sessionsDir = './data/sessions';
try {
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
    console.log(`[SESSIONS] Created sessions directory: ${sessionsDir}`);
  }
} catch (err) {
  console.error(`[SESSIONS] Failed to create sessions directory:`, err);
}

let mailer;
if (process.env.EMAIL_SMTP_HOST && process.env.EMAIL_SMTP_USER) {
  mailer = nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port: parseInt(process.env.EMAIL_SMTP_PORT || "587", 10),
    secure: process.env.EMAIL_SMTP_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASS || ''
    }
  });
} else {
  mailer = null;
}

function sendNotificationEmail(msg) {
  if (!mailer || NOTIFY_LIST.length === 0) return;
  const hasUserEmail = !!msg.email;
  const subject = hasUserEmail 
    ? `New feedback message from ${msg.email}`
    : `New anonymous message received`;
  const body = `Message:\n\n${msg.text}\n\nUser-supplied email: ${msg.email || "(none - anonymous)"}\n\nLogged at: ${msg.time}\nIP: ${msg.ip || "unknown"}\n`;
  const mail = {
    from: EMAIL_FROM,
    to: NOTIFY_LIST.join(","),
    subject: subject,
    text: body
  };
  mailer.sendMail(mail, (err, info) => {
    if (err) {
      console.error("Error sending notification email:", err);
    } else {
      console.log("Notification email sent:", info);
    }
  });
}

const app = express();
app.set('trust proxy', true);
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server);
const adminAuthLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: { ok: false, error: 'Too many attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
const adminActionLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // limit each IP to 30 requests per windowMs
  message: { ok: false, error: 'Too many admin actions, ratelimiting' }
});

const fileStore = FileStore(session);

app.use(session({
  store: new fileStore({
    path: './data/sessions',    // Store sessions in data folder
    retries: 2,
    secret: 'session-secret',    // Additional encryption
    logFn: function() {} // disable logging
  }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // ✅ Fix this too
    httpOnly: true,
    maxAge: 30 * 60 * 1000 // 30 minutes
  }
}));

app.post("/api/admin-auth", adminAuthLimit,(req, res) => {
  try {
    const ip = getIpFromReq(req);
    const { password } = req.body || {};
    const time = new Date().toISOString();
    try {
      if (!password) {
        fs.appendFile(LOG_FILE || './logs/messages.log', `[ADMIN AUTH] [${time}] IP: ${ip || 'unknown'} - missing password\n`, () => {});
        return res.status(400).json({ ok: false });
      }
      const success = password === ADMIN_PASSWORD;

      fs.appendFile(LOG_FILE || './logs/messages.log', `[ADMIN AUTH] [${time}] IP: ${ip || 'unknown'} - ${success ? 'success' : 'failure'}\n`, () => {});
      if (success) {
        req.session.isAdmin = true;
        req.session.adminLoginTime = Date.now();

        return res.json({ 
          ok: true,
          token: req.sessionID 
        });
      }
      return res.status(401).json({ ok: false });
    } catch (e) {
      console.error("Failed to write admin auth log:", e);
      if (password === ADMIN_PASSWORD) return res.json({ ok: true });
      return res.status(401).json({ ok: false });
    }
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
let BACKUP_FILE = process.env.BACKUP_FILE || './data/backup.json';
BACKUP_FILE = prepareFile(BACKUP_FILE);
ensureParentDir(BACKUP_FILE);

function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const sessionAge = Date.now() - (req.session.adminLoginTime || 0);
  if (sessionAge > 30 * 60 * 1000) {
    req.session.destroy();
    return res.status(401).json({ ok: false, error: 'Session expired' });
  }
  next();
}

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
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn('Could not create dir', dir, '-', err && err.code ? err.code : err);
  }
}
ensureParentDir(LOG_FILE);
ensureParentDir(EMAIL_LOG_FILE);
ensureParentDir(STATE_FILE);

// Store messages in memory
let messages = [];

function loadBackup() {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, "utf-8");
      return raw ? JSON.parse(raw) : null;
    }
    return null;
  } catch (err) {
    console.error("Error loading backup file:", err);
    return null;
  }
}

function saveBackup(backupData) {
  try {
    const tmp = BACKUP_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(backupData), "utf8");
    fs.renameSync(tmp, BACKUP_FILE);
  } catch (err) {
    console.error("Failed to save backup file:", err);
  }
}

function clearBackup() {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      fs.unlinkSync(BACKUP_FILE);
    }
  } catch (err) {
    console.error("Failed to clear backup file:", err);
  }
}

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
    // Validate and sanitize
    let text = typeof data?.text === "string" ? data.text.trim() : "";
    
    // Length check
    if (!text || text.length > 10000) {
      return; // Reject oversized content
    }
    
    // Basic HTML sanitization
    text = DOMPurify.sanitize(text, { ALLOWED_TAGS: [] }); // Strip all HTML
    
    // Rate limiting per IP
    const clientIP = socket.data.ip;
    if (isRateLimited(clientIP)) {
      return; // Silently reject if rate limited
    }
    const emailRaw = typeof data?.email === "string" ? data.email.trim() : null;
    const email = (emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) ? emailRaw : null;

    if (!text) return; // ignore empty messages

    const msg = {
      text,
      email,
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

    // ALWAYS send notification email for every message
    console.log(`[NEW MESSAGE] ${msg.text}` + (msg.email ? ` (email: ${msg.email})` : ' (anonymous)') + (msg.ip ? ` from ${msg.ip}` : ''));
    try { 
      sendNotificationEmail(msg); 
    } catch (e) { 
      console.error("sendNotificationEmail threw:", e && e.message); 
    }

    // Still log to email-specific file if email provided
    if (msg.email) {
      const emailLogEntry = `[${msg.time}] ${msg.text}` + (msg.email ? ` | Email: ${msg.email}` : "") + "\n";
      fs.appendFile(EMAIL_LOG_FILE, emailLogEntry, (err) => {
        if (err) console.error("Error writing to email log file:", err);
      });
      console.log(`  Feedback email: ${msg.email}`);
    }
  });
  socket.on("disconnect", () => {
    console.log("A user disconnected", ip ? `from IP: ${ip}` : '');
  });
  socket.on("videoQualityChange", (data) => {
    try {
      const ip = socket.data.ip || 'unknown';
      const from = data?.from || 'unknown';
      const to = data?.to || 'unknown';
      const reason = data?.reason || 'unknown';
      const time = data?.timestamp || new Date().toISOString();
      
      const logEntry = `[VIDEO QUALITY] [${time}] IP: ${ip} - switched from ${from} to ${to} (reason: ${reason})\n`;
      
      // Log to console
      console.log(`[VIDEO QUALITY CHANGE] ${ip} switched from ${from} to ${to} (${reason})`);
      
      // Log to file
      fs.appendFile(LOG_FILE, logEntry, (err) => {
        if (err) console.error("Error writing video quality log:", err);
      });
    } catch (e) {
      console.error("Error handling video quality change:", e);
    }
  });
  
});

app.post("/api/admin/delete-ship", requireAdmin, (req, res) => {
  try {
    const ip = getIpFromReq(req);
    const shipText = req.body?.shipText;
    const time = new Date().toISOString();

    if (!shipText) {
      return res.status(400).json({ ok: false, error: "missing_ship_text" });
    }

    // Find and remove the ship from messages array
    const initialCount = messages.length;
    messages = messages.filter(m => m.text !== shipText);
    const deletedCount = initialCount - messages.length;
    
    if (deletedCount > 0) {
      // Save updated state to file
      saveState();
      
      // Log the deletion
      const logEntry = `[ADMIN DELETE SHIP] [${time}] IP: ${ip || 'unknown'} - deleted ship: "${shipText.substring(0, 100)}${shipText.length > 100 ? '...' : ''}"\n`;
      fs.appendFile(LOG_FILE, logEntry, (e)=>{ if(e) console.error(e); });
      
      // Broadcast deletion to all connected clients
      io.emit("deleteShip", { shipText });
      
      console.log(`[ADMIN] Deleted ship "${shipText.substring(0, 50)}..." from ${ip || 'unknown'}`);
      res.json({ ok: true, deleted: deletedCount });
    } else {
      res.json({ ok: true, deleted: 0, message: "Ship not found" });
    }
    
  } catch (err) {
    console.error("Error in admin delete-ship:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

app.post("/api/admin/clear-all", adminActionLimit, requireAdmin, (req, res) => {
  try {
    const ip = getIpFromReq(req);
    const time = new Date().toISOString();

    // CREATE BACKUP and save to disk
    const backupData = {
      messages: [...messages], // deep copy
      timestamp: time,
      clearedBy: ip || 'unknown'
    };
    saveBackup(backupData);

    // Log the clear operation
    const logEntry = `[ADMIN CLEAR] [${time}] IP: ${ip || 'unknown'} - cleared all ${messages.length} messages (backup saved to disk)\n`;
    fs.appendFile(LOG_FILE, logEntry, (e)=>{ if(e) console.error(e); });

    // Clear messages from memory
    const clearedCount = messages.length;
    messages = [];
    
    // Save empty state to file
    saveState();
    
    // Broadcast clear to all connected clients
    io.emit("clearAll");
    
    console.log(`[ADMIN] Cleared ${clearedCount} messages from ${ip || 'unknown'} (backup saved to disk)`);
    res.json({ ok: true, cleared: clearedCount, backupAvailable: true });
    
  } catch (err) {
    console.error("Error in admin clear-all:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

app.post("/api/admin/undo-clear", requireAdmin, (req, res) => {
  try {
    const ip = getIpFromReq(req);
    const time = new Date().toISOString();

    // Load backup from disk
    const backupData = loadBackup();
    if (!backupData || !backupData.messages) {
      return res.status(400).json({ ok: false, error: "no_backup_available" });
    }

    // Restore from backup
    messages = [...backupData.messages];
    saveState();

    // Log the restore operation
    const logEntry = `[ADMIN UNDO] [${time}] IP: ${ip || 'unknown'} - restored ${messages.length} messages from backup (${backupData.timestamp})\n`;
    fs.appendFile(LOG_FILE, logEntry, (e)=>{ if(e) console.error(e); });

    // Broadcast restore to all connected clients
    io.emit("restoreAll", messages.map(m => ({ text: m.text, time: m.time, hasEmail: !!m.email })));
    
    console.log(`[ADMIN] Restored ${messages.length} messages from backup by ${ip || 'unknown'}`);
    
    // Clear the backup file after successful restore
    clearBackup();
    
    res.json({ ok: true, restored: messages.length });
    
  } catch (err) {
    console.error("Error in admin undo-clear:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

app.post("/api/admin/backup-status", requireAdmin, (req, res) => {
  try {

    const backupData = loadBackup();
    const hasBackup = !!(backupData && backupData.messages);
    
    res.json({ 
      ok: true, 
      hasBackup,
      backupInfo: hasBackup ? {
        messageCount: backupData.messages.length,
        timestamp: backupData.timestamp,
        clearedBy: backupData.clearedBy
      } : null
    });
  } catch (err) {
    console.error("Error checking backup status:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

app.post("/api/admin/emails", requireAdmin, (req, res) => {
  try {
    const ip = getIpFromReq(req);
    const time = new Date().toISOString();

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

app.post("/api/admin/messages", requireAdmin, (req, res) => {
  try {
    const ip = getIpFromReq(req);
    const time = new Date().toISOString();
    
    fs.appendFile(LOG_FILE, `[ADMIN MESSAGES LIST] [${time}] IP: ${ip || 'unknown'} - fetched ${messages.length} messages\n`, (e) => { if(e) console.error(e); });
    
    // Return all messages with full details for admin
    res.json({
      ok: true,
      messages: messages.map((m, index) => ({
        id: index,
        text: m.text,
        email: m.email || null,
        time: m.time,
        hasEmail: !!m.email
      }))
    });
  } catch (err) {
    console.error("Error fetching admin messages:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

function isRateLimited(ip) {
  if (!ip) return false;
  
  const now = Date.now();
  const client = clientRateMap.get(ip);
  
  if (!client || now > client.resetTime) {
    // First request or window expired
    clientRateMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return false;
  }
  
  if (client.count >= RATE_LIMIT_MAX_MESSAGES) {
    return true; // Rate limited
  }
  
  client.count++;
  return false;
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of clientRateMap.entries()) {
    if (now > data.resetTime) {
      clientRateMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

const execAsync = promisify(exec);

// Generate fallback images from video files on server startup
async function generateVideoFallbackImages() {
  const videoFiles = [
    { video: "background.mp4", output: "video-fallback-1080.jpg", width: 1920 },
    { video: "background-720.mp4", output: "video-fallback-720.jpg", width: 1280 },
    { video: "background-480.mp4", output: "video-fallback-480.jpg", width: 854 }
  ];
  
  console.log("[FALLBACK] Generating video fallback images...");
  
  for (const { video, output, width } of videoFiles) {
    const videoPath = `./public/${video}`;
    const outputPath = `./public/${output}`;
    
    try {
      // Check if video file exists
      if (!fs.existsSync(videoPath)) {
        console.log(`[FALLBACK] Video file not found: ${videoPath}, skipping`);
        continue;
      }
      
      // Check if fallback already exists and is recent (within 24 hours)
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
        if (ageHours < 24) {
          console.log(`[FALLBACK] ${output} already exists and is recent, skipping`);
          continue;
        }
      }
      
      // Generate fallback image using ffmpeg
      // Capture frame at 2 seconds, apply slight blur for smoother loop transition appearance
      const command = `ffmpeg -y -ss 2 -i "${videoPath}" -vframes 1 -vf "gblur=sigma=0.5" -q:v 2 "${outputPath}"`;
      
      console.log(`[FALLBACK] Generating ${output} from ${video}...`);
      await execAsync(command);
      
      const outputStats = fs.statSync(outputPath);
      const sizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
      console.log(`[FALLBACK] Generated ${output} (${sizeMB} MB)`);
      
    } catch (e) {
      console.error(`[FALLBACK] Failed to generate ${output}:`, e.message);
      
      // If ffmpeg fails, try without blur filter
      try {
        const simpleCommand = `ffmpeg -y -ss 2 -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}"`;
        await execAsync(simpleCommand);
        console.log(`[FALLBACK] Generated ${output} (without blur)`);
      } catch (e2) {
        console.error(`[FALLBACK] Simple generation also failed for ${output}:`, e2.message);
      }
    }
  }
  
  console.log("[FALLBACK] Video fallback image generation complete");
}

// Call on server startup (after other initialization)
generateVideoFallbackImages().catch(e => {
  console.error("[FALLBACK] Error during fallback generation:", e);
});

// API to get appropriate fallback image path based on screen width
app.get("/api/video-fallback", async (req, res) => {
  const width = parseInt(req.query.width) || 1920;
  
  let fallbackFile;
  if (width <= 854) {
    fallbackFile = "video-fallback-480.jpg";
  } else if (width <= 1280) {
    fallbackFile = "video-fallback-720.jpg";
  } else {
    fallbackFile = "video-fallback-1080.jpg";
  }
  
  const filePath = `./public/${fallbackFile}`;
  
  // If file doesn't exist, try to generate it on-demand
  if (!fs.existsSync(filePath)) {
    console.log(`[FALLBACK] ${fallbackFile} not found, attempting on-demand generation...`);
    await generateVideoFallbackImages();
  }
  
  // Check again after potential generation
  if (fs.existsSync(filePath)) {
    res.json({ 
      ok: true, 
      fallback: fallbackFile,
      width: width
    });
  } else {
    // Fallback to any available image
    const fallbacks = ["video-fallback-1080.jpg", "video-fallback-720.jpg", "video-fallback-480.jpg"];
    for (const fb of fallbacks) {
      if (fs.existsSync(`./public/${fb}`)) {
        res.json({ ok: true, fallback: fb, width: width });
        return;
      }
    }
    res.json({ ok: false, error: "No fallback images available" });
  }
});