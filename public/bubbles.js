let adminMode = false;
let ships = [];
let messages = [];

try {
  const saved = localStorage.getItem("messages");
  messages = saved ? JSON.parse(saved) : [];
} catch (e) {
  console.error("Error loading messages from localStorage:", e);
}

function saveMessagesToLog() {
  try {
    localStorage.setItem('messages', JSON.stringify(messages));
  } catch (e) { /* ignore */ }
}

function clearShips() {
  for (const s of ships) {
    if (s && s.remove) s.remove();
  }
  ships = [];
}

// Create a new ship
function createShip(msg) {
  const div = document.createElement("div");
  div.className = "ship";

  // store text for dedupe and admin handling 
  div.dataset.text = msg.text || "";
  div.dataset.hasEmail = msg.hasEmail ? "1" : "0";
  // safe preview text
  const previewText = (msg && msg.text) ? String(msg.text) : "";

  // Right-click to delete (only in admin mode)
  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!adminMode) return; // only allow if admin

    const confirmDelete = confirm("Delete this ship from view?");
    if (confirmDelete) {
      div.remove(); // remove from DOM
      ships = ships.filter(s => s !== div);
    }
  });

  // Random initial position
  div.x = Math.random() * (window.innerWidth - 100);
  div.y = Math.random() * (window.innerHeight - 100);
  div.style.left = div.x + "px";
  div.style.top = div.y + "px";

  // Random initial direction and speed
  const angle = Math.random() * 2 * Math.PI;
  const speed = 0.3 + Math.random() * 0.25;
  div.vx = Math.cos(angle) * speed;
  div.vy = Math.sin(angle) * speed;

  // Random rotation
  div.angle = Math.random() * 360;
  div.rotationSpeed = (Math.random() - 0.5) * 0.5;

  let s = 60;
  try {
    // element is not yet in layout if created off-DOM; use getBoundingClientRect when possible
    const rect = div.getBoundingClientRect();
    if (rect && rect.width && rect.height) {
      s = Math.round(Math.min(60, Math.max(28, Math.min(rect.width, rect.height))));
    } else {
      // fallback based on viewport for initial render (desktop default 60)
      if (window.innerWidth <= 720 || window.innerHeight > window.innerWidth) {
        // small / portrait devices -> smaller base size
        s = Math.round(Math.min(48, Math.max(28, Math.round(window.innerWidth * 0.06))));
      } else {
        s = 60;
      }
    }
  } catch (e) {
    s = 60;
  }

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `-${s*0.6} -${s*0.6} ${s*1.2} ${s*1.2}`);
  // make svg scale to its parent .ship size
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";

  // Origami ship shape
  const shipShape = document.createElementNS(svgNS, "polygon");
  shipShape.setAttribute("points", `
    0,-${s*0.5} 
    ${s*0.4},0 
    0,${s*0.5} 
    -${s*0.4},0
  `);
  shipShape.setAttribute("fill", "none");
  shipShape.setAttribute("stroke", "white");
  shipShape.setAttribute("stroke-width", "2");
  svg.appendChild(shipShape);

  // Internal fold lines
  function addLine(x1, y1, x2, y2){
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", "white");
    line.setAttribute("stroke-width", "1.5");
    svg.appendChild(line);
  }

  addLine(-s*0.4,0, s*0.4,0);
  addLine(0,-s*0.5, 0,s*0.5);
  addLine(-s*0.4,0, 0,-s*0.5);
  addLine(s*0.4,0, 0,-s*0.5);
  addLine(-s*0.4,0, 0,s*0.5);
  addLine(s*0.4,0, 0,s*0.5);

  div.appendChild(svg);

  // Text preview under the ship
  const preview = document.createElement("div");
  preview.className = "ship-preview";
  preview.innerText = previewText.length > 10 ? previewText.slice(0,10) + "…" : previewText;
  preview.style.position = "absolute";
  preview.style.top = s + "px";  // below the ship
  preview.style.left = "50%";
  preview.style.transform = "translateX(-50%)";
  preview.style.color = "white";
  preview.style.fontSize = "12px";
  preview.style.pointerEvents = "none"; // clicks go to ship
  div.appendChild(preview);

  // Click handler
  div.onclick = () => showOverlay(msg.text);

  document.body.appendChild(div);
  ships.push(div);
  return div;
}

// Overlay for full text
function showOverlay(text){
  let overlay = document.getElementById("overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "overlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(0,0,0,0.8)";
    overlay.style.color = "white";
    overlay.style.zIndex = 10000;
    overlay.style.padding = "20px";
    overlay.style.fontFamily = "monospace";
    overlay.style.whiteSpace = "pre-wrap";
    document.body.appendChild(overlay);
  }
  overlay.innerText = text;
  overlay.style.display = "flex";
  overlay.onclick = ()=> overlay.style.display="none";
}

// Animate floating ships
function animateShips(){
  for(let div of ships){
    div.x += div.vx + Math.sin(Date.now()*0.001 + div.x) * 0.2;
    div.y += div.vy + Math.cos(Date.now()*0.001 + div.y) * 0.2;

    // Wrap around edges
    if(div.x < -80) div.x = window.innerWidth;
    if(div.x > window.innerWidth) div.x = -80;
    if(div.y < -80) div.y = window.innerHeight;
    if(div.y > window.innerHeight) div.y = -80;

    // Apply position and rotation
    div.style.left = div.x + "px";
    div.style.top = div.y + "px";
    div.style.transform = `rotate(${div.angle}deg)`;
    div.angle += div.rotationSpeed;
  }
  requestAnimationFrame(animateShips);
}

document.addEventListener("DOMContentLoaded", () => {
  const socket = io();
  const textInput = document.getElementById("textInput");
  const checkbox = document.getElementById("feedbackCheckbox");
  const emailInput = document.getElementById("emailInput");

  const bg = document.getElementById("bgVideo");

  function nudgeVideoIntoChromeArea() {
    try {
      const vv = window.visualViewport;
      // compute how much UI chrome is taking vertically (positive if chrome reduces visible area)
      const chromeHeight = vv ? (window.innerHeight - vv.height - (vv.offsetTop || 0)) : 0;
      // convert to a small percent shift (clamp to avoid over-cropping)
      const pct = Math.max(-12, Math.min(12, (chromeHeight / window.innerHeight) * 100));
      // move the video down a bit (increase y) so more of the bottom is visible under chrome
      const base = 50 + pct;
      document.documentElement.style.setProperty("--video-y", base + "%");
      if (bg) {
        // small repaint hints
        bg.style.willChange = "object-position";
        // touch currentTime to force decoder / frame readiness on some iOS builds
        if (bg.readyState >= 1 && bg.currentTime < 0.05) {
          try { bg.currentTime = Math.min(0.05, bg.duration || 0.05); } catch(e) {}
        }
        // nudge a reflow
        void bg.offsetWidth;
      }
    } catch (e) { /* ignore */ }
  }

  // run on load and relevant events
  nudgeVideoIntoChromeArea();
  window.addEventListener("resize", nudgeVideoIntoChromeArea);
  window.addEventListener("orientationchange", nudgeVideoIntoChromeArea);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", nudgeVideoIntoChromeArea);
    window.visualViewport.addEventListener("scroll", nudgeVideoIntoChromeArea);
  }
  // also run once when video metadata is ready
  if (bg) bg.addEventListener("loadedmetadata", nudgeVideoIntoChromeArea);

  function updateCheckboxScale() {
    if (!checkbox) return;
    const labelEl = checkbox.closest("label");
    if (!labelEl) return;
    const scale = window.innerWidth > 1200 ? 1.08 : window.innerWidth > 800 ? 1.04 : 1.0;
    labelEl.style.transform = `scale(${scale})`;
  }
  window.addEventListener("resize", updateCheckboxScale);
  updateCheckboxScale();

  (function setupBgPlayButton(){
    const bg = document.getElementById("bgVideo");
    if (!bg) return;
    // prefer an existing button in HTML, otherwise create one
    let btn = document.getElementById("bgPlayBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "bgPlayBtn";
      btn.textContent = "Play background";
      Object.assign(btn.style, {
        display: "none",
        position: "fixed",
        right: "12px",
        top: "12px",
        zIndex: "10001",
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        border: "none",
        padding: "8px 12px",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "13px"
      });
      document.body.appendChild(btn);
    }

    // ensure muted to maximize autoplay chance
    try { bg.muted = true; } catch (e) { /* ignore */ }

    const isPlaying = () => !!(bg && !bg.paused && !bg.ended && bg.readyState > 2);
    const update = () => { btn.style.display = isPlaying() ? "none" : "block"; };

    const tryPlay = async () => {
      try {
        // ensure muted just before play attempt
        bg.muted = true;
        await bg.play();
      } catch (err) {
        // autoplay blocked — nothing to do, update will show button
      } finally {
        update();
      }
    };

    // keep visibility in sync with playback state
    ["play","playing","pause","ended","loadeddata","canplay"].forEach(ev => bg.addEventListener(ev, update));

    // initial attempt and UI update
    update();
    tryPlay();

    // try again after first user gesture (some browsers relax autoplay after gesture)
    const onFirstGesture = () => { tryPlay(); window.removeEventListener("pointerdown", onFirstGesture); window.removeEventListener("touchstart", onFirstGesture); };
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("touchstart", onFirstGesture, { once: true });

    // button triggers a user-gesture play attempt
    btn.addEventListener("click", async () => {
      try {
        await bg.play();
      } catch (e) {
        alert("Cannot play background due to browser restrictions.");
      } finally {
        update();
      }
    });
  })();

  if (textInput) {
    const resizeInput = () => {
      textInput.style.width = Math.min(window.innerWidth * 0.85, 900) + "px";
      textInput.style.fontSize = (window.innerWidth < 420) ? "14px" : "";
    };
    window.addEventListener("resize", resizeInput);
    resizeInput();
  }
  function updateVh() {
    try {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    } catch (e) { /* ignore */ }
  }
  updateVh();
  window.addEventListener("resize", updateVh);
  window.addEventListener("orientationchange", updateVh);

  // Auto-expand text area
  if (textInput) {
    textInput.addEventListener("input", () => {
      textInput.style.height = "auto";
      textInput.style.height = textInput.scrollHeight + "px";
    });
    textInput.dispatchEvent(new Event("input"));
  }

  // Show/hide email input
  if (checkbox && emailInput) {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        emailInput.style.display = "block";
      } else {
        emailInput.style.display = "none";
        emailInput.value = "";
      }
    });
  }

  // Send text
  function sendText(){
    const text = textInput.value.trim();
    const wantsFeedback = checkbox.checked;
    let email = null;
    if (wantsFeedback && emailInput) {
      const v = emailInput.value.trim();
      if (v) {
        email = v;
      } else {
        // no email provided — treat as no feedback requested
        if (checkbox) checkbox.checked = false;
        if (emailInput) { emailInput.value = ""; emailInput.style.display = "none"; }
      }
    }
    if(text){
      socket.emit("newText", { text, email });
      if (textInput) { textInput.value = ""; textInput.style.height = "auto"; }
      if (checkbox) checkbox.checked = false;
      if (emailInput) { emailInput.value = ""; emailInput.style.display = "none"; }
    }
  }
  window.sendText = sendText;

  // Socket.io events
  socket.on("init", msgs => {
    clearShips();
    messages = [];
    msgs.forEach(m => {
      messages.push(m);
      createShip(m);
    });
    if (!window._shipsAnimating) {
      window._shipsAnimating = true;
      animateShips();
    }
    saveMessagesToLog();
  });

  socket.on("newText", (msg) => {
    const last = messages[messages.length - 1];
    if (last && last.text === msg.text && last.hasEmail === msg.hasEmail) {
      return; // duplicate, ignore
    }

    const exists = ships.some(s => s.dataset && s.dataset.text === msg.text);
    if (exists) {
      messages.push(msg);
      saveMessagesToLog();
      return;
    }
    messages.push(msg);
    saveMessagesToLog();
      // keep text cached on element for duplicate checks
    const created = createShip(msg);
    if (created && created.dataset) created.dataset.text = msg.text;
  });

  // Toggle admin mode with Shift + A
  document.addEventListener("keydown", async (e) => {
    if (e.shiftKey && e.key.toLowerCase() === "a") {
      const input = prompt("Enter admin password:");
      if (!input) return;
      try {
        const res = await fetch("/api/admin-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: input }),
        });
        if (res.ok) {
          adminMode = true;
          window._adminPassword = input;
          document.body.classList.add("admin-mode");
          createAdminControls();
          alert("Admin mode activated. You can now right-click ships to delete them.");
        } else {
          alert("Incorrect password.");
        }
      } catch (err) {
        alert("Auth error, try again.");
      }
    }
  });
});

function createAdminControls() {
  // avoid duplicates
  if (document.getElementById("admin-email-panel")) return;

  // wrapper for button + panel
  const container = document.createElement("div");
  container.id = "admin-email-panel";
  container.style.position = "fixed";
  container.style.top = "12px";
  container.style.right = "12px";
  container.style.zIndex = 9999;
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "flex-end";
  document.body.appendChild(container);

  // toggle button
  const btn = document.createElement("button");
  btn.id = "admin-email-logs-button";
  btn.innerText = "Emails";
  btn.style.background = "#222";
  btn.style.color = "#fff";
  btn.style.border = "1px solid #444";
  btn.style.padding = "6px 10px";
  btn.style.borderRadius = "4px";
  btn.style.cursor = "pointer";
  btn.onclick = () => {
    const panel = document.getElementById("admin-email-panel-body");
    if (!panel) return;
    const visible = panel.style.display !== "none";
    if (visible) {
      // already open — refresh contents immediately
      fetchEmailLogs(panel, true);
      return;
    }
    // opening -> show and always fetch current state immediately
    panel.style.display = "block";
    fetchEmailLogs(panel, true);
  };
  container.appendChild(btn);

  // collapsible panel
  const panel = document.createElement("div");
  panel.id = "admin-email-panel-body";
  panel.style.display = "none";
  panel.style.marginTop = "8px";
  panel.style.width = "480px";
  panel.style.maxHeight = "60vh";
  panel.style.overflow = "auto";
  panel.style.background = "rgba(0,0,0,0.9)";
  panel.style.color = "#fff";
  panel.style.border = "1px solid #444";
  panel.style.borderRadius = "6px";
  panel.style.padding = "8px";
  panel.style.boxShadow = "0 4px 16px rgba(0,0,0,0.6)";
  panel.style.fontFamily = "monospace";
  panel.style.fontSize = "12px";
  container.appendChild(panel);

  // panel header (refresh + close)
  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "6px";
  panel.appendChild(header);

  const title = document.createElement("div");
  title.innerText = "Messages with emails attached";
  title.style.fontWeight = "600";
  title.style.marginRight = "8px";
  header.appendChild(title);

  const controls = document.createElement("div");
  header.appendChild(controls);

  const refreshBtn = document.createElement("button");
  refreshBtn.innerText = "Refresh";
  refreshBtn.style.marginRight = "6px";
  refreshBtn.onclick = () => fetchEmailLogs(panel, true);
  controls.appendChild(refreshBtn);

  const closeBtn = document.createElement("button");
  closeBtn.innerText = "Close";
  closeBtn.onclick = () => { panel.style.display = "none"; };
  controls.appendChild(closeBtn);

  // content area
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-word";
  pre.style.margin = "0";
  pre.style.padding = "4px 0";
  panel.appendChild(pre);

  // helper to show status while loading
  panel.dataset.loaded = "false";
}

async function fetchEmailLogs(panel, forceReload = false) {
  if (!window._adminPassword) { alert("Admin password missing — re-authenticate."); return; }
  const pre = panel.querySelector("pre");
  if (!pre) return;
  try {
    pre.innerText = "Loading...";
    const resp = await fetch("/api/admin/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: window._adminPassword }),
    });
    if (resp.status === 200) {
      const txt = await resp.text();
      const tz = "Europe/Tallinn";
      const formatted = txt.split("\n").map(line => {
        const m = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
        if (!m) return line;
        const iso = m[1];
        const rest = m[2] || "";
        const d = new Date(iso);
        if (isNaN(d)) return line;

        const parts = new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit", minute: "2-digit",
          day: "2-digit", month: "2-digit", year: "numeric",
          hour12: false,
          timeZone: tz
        }).formatToParts(d);
        const get = t => (parts.find(p => p.type === t) || {}).value || "";
        const formattedTs = `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}/${get("year")}`;
        if (rest === "") return `| ${formattedTs}`;
        return `${rest} | ${formattedTs}`;
      }).join("\n");

      pre.innerText = formatted || "(empty)";
      panel.dataset.loaded = "true";
    } else if (resp.status === 401) {
      pre.innerText = "Unauthorized. The password may be incorrect.";
    } else {
      pre.innerText = `Failed to load logs: ${resp.status}`;
    }
  } catch (err) {
    pre.innerText = "Fetch error: " + String(err);
  }
}