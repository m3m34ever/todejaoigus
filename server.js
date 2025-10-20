// server.js (ES module)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Log file path
const logFile = "messages.log";

// Store messages in memory
let messages = [];

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

    // Broadcast message text to all clients (email stays private)
    io.emit("newText", { text: msg.text });

    // Log to server console
    console.log(`[NEW MESSAGE] ${msg.text}`);
    if(msg.email){
      console.log(`  Feedback email: ${msg.email}`);
    }

    // Append message to log file
    const logEntry = `[${msg.time.toISOString()}] ${msg.text}`
                   + (msg.email ? ` | Email: ${msg.email}` : "")
                   + "\n";

    fs.appendFile(logFile, logEntry, (err) => {
      if(err) console.error("Error writing to log file:", err);
    });
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
