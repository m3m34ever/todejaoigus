let adminMode = false;
let ships = [];
let circleShips = [];
let messages = [];
let circleOverlayEl = null;
let _savedInputDisplay = null;
let zResizeMode = false;
let loopResetInProgress = false;

let circleState = {
  sizeVmin: 100,    // initial circle size in vmin (matches CSS)
  left: null,      // px from left of viewport
  top: null,       // px from top of viewport
  skewX: 0,        // deg
  skewY: 0         // deg
};
const videoVariants = [
  { src: "background.mp4", width: 1920 },
  { src: "background-720.mp4", width: 1280 },
  { src: "background-480.mp4", width: 854 }
];

function chooseInitialVariantIndex() {
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const eff = conn && conn.effectiveType ? conn.effectiveType : null;
    const deviceMem = navigator.deviceMemory || 4;
    if (eff && (eff.includes("2g") || eff.includes("3g") || eff === "slow-2g")) return 2;
    if (deviceMem <= 1) return 1;
    return 0;
  } catch (e) { return 0; }
}

let currentBgVariant = chooseInitialVariantIndex();
let switchedDueToChoppy = false;

function setBgVideoVariant(idx, reason = "manual") {
  const bgVideo = document.getElementById("bgVideo");
  if (!bgVideo) return;
  idx = Math.max(0, Math.min(videoVariants.length - 1, idx));
  if (currentBgVariant === idx) return;
  const prevVariant = currentBgVariant;
  currentBgVariant = idx;
  const wasPaused = bgVideo.paused;
  try {
    bgVideo.pause();
    bgVideo.src = videoVariants[idx].src;
    bgVideo.load();
    if (!wasPaused) {
      setTimeout(() => bgVideo.play().catch(()=>{}), 50);
    }
    
    if (window.socket && window.socket.connected) {
      window.socket.emit("videoQualityChange", {
        from: videoVariants[prevVariant]?.src || "unknown",
        to: videoVariants[idx].src,
        reason: reason,
        timestamp: new Date().toISOString()
      });
    }
    console.log(`[VIDEO] Switched from ${videoVariants[prevVariant]?.src} to ${videoVariants[idx].src} (${reason})`);
  } catch (e) {
    console.error("Failed to switch video variant:", e);
  }
}

let _cursorHideTimer = null;
let _cursorAutoHideListeners = null;
function _showCursor() {
  try { document.body.style.cursor = ""; } catch (e) {}
}
function _hideCursor() {
  try { document.body.style.cursor = "none"; } catch (e) {}
}
function _activityHandler() {
  // always show on activity
  _showCursor();
  if (_cursorHideTimer) clearTimeout(_cursorHideTimer);
  // only schedule hide if circle overlay is active and we're fullscreen
  if (circleOverlayEl && circleOverlayEl.classList.contains("active") && document.fullscreenElement) {
    _cursorHideTimer = setTimeout(() => {
      _hideCursor();
    }, 3000);
  }
}
function enableCursorAutoHide() {
  // avoid duplicate listeners
  if (_cursorAutoHideListeners) return;
  _activityHandler(); // start visible then schedule hide
  _cursorAutoHideListeners = {
    move: _activityHandler,
    down: _activityHandler,
    touch: _activityHandler,
    key: _activityHandler
  };
  window.addEventListener("mousemove", _cursorAutoHideListeners.move, { passive: true });
  window.addEventListener("pointerdown", _cursorAutoHideListeners.down, { passive: true });
  window.addEventListener("touchstart", _cursorAutoHideListeners.touch, { passive: true });
  window.addEventListener("keydown", _cursorAutoHideListeners.key, { passive: true });
}
function disableCursorAutoHide() {
  if (_cursorHideTimer) { clearTimeout(_cursorHideTimer); _cursorHideTimer = null; }
  if (_cursorAutoHideListeners) {
    window.removeEventListener("mousemove", _cursorAutoHideListeners.move);
    window.removeEventListener("pointerdown", _cursorAutoHideListeners.down);
    window.removeEventListener("touchstart", _cursorAutoHideListeners.touch);
    window.removeEventListener("keydown", _cursorAutoHideListeners.key);
    _cursorAutoHideListeners = null;
  }
  _showCursor();
}

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

try {
  const savedCS = localStorage.getItem("circleState");
  if (savedCS) {
    const parsed = JSON.parse(savedCS);
    if (parsed && typeof parsed === "object") {
      // only accept numeric fields to avoid bad values
      if (typeof parsed.sizeVmin === "number") circleState.sizeVmin = parsed.sizeVmin;
      if (typeof parsed.left === "number") circleState.left = parsed.left;
      if (typeof parsed.top === "number") circleState.top = parsed.top;
      if (typeof parsed.skewX === "number") circleState.skewX = parsed.skewX;
      if (typeof parsed.skewY === "number") circleState.skewY = parsed.skewY;
    }
  }
} catch (e) { /* ignore */ }

// Create a new ship
function createShip(msg, container = document.body) {
  const div = document.createElement("div");
  div.className = "ship";

  // store text for dedupe and admin handling 
  div.dataset.text = msg.text || "";
  div.dataset.hasEmail = msg.hasEmail ? "1" : "0";
  // safe preview text
  const previewText = (msg && msg.text) ? String(msg.text) : "";

  // Right-click to delete (only in admin mode)
  div.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    if (!adminMode) return; // only allow if admin

    const shipText = div.dataset.text;
    const confirmDelete = confirm(`Delete this ship from everywhere?\n\nText: "${shipText.length > 100 ? shipText.substring(0, 100) + '...' : shipText}"\n\nThis will remove it from all clients and the server.`);
    if (!confirmDelete) return;

    try {
      // Send deletion request to server
      const res = await fetch("/api/admin/delete-ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          password: window._adminPassword, 
          shipText: shipText 
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.deleted > 0) {
          console.log(`[ADMIN] Successfully deleted ship from server: "${shipText.substring(0, 50)}..."`);
          // Local removal will happen via the deleteShip socket event
        } else {
          console.log(`[ADMIN] Ship not found on server, removing locally only`);
          // Remove locally anyway
          div.remove();
          ships = ships.filter(s => s !== div);
          circleShips = circleShips.filter(s => s !== div);
        }
      } else if (res.status === 401) {
        alert("Unauthorized. Please re-authenticate as admin.");
      } else {
        alert(`Failed to delete ship from server: ${res.status}`);
      }
    } catch (err) {
      console.error("Error deleting ship:", err);
      alert("Error deleting ship: " + err.message);
      // Still remove locally as fallback
      div.remove();
      ships = ships.filter(s => s !== div);
      circleShips = circleShips.filter(s => s !== div);
    }
  });

  // Random initial position
  const containerRect = (container === document.body) 
    ? { width: window.innerWidth, height: window.innerHeight } 
    : container.getBoundingClientRect();
    
  if (container === document.body) {
    div.x = Math.random() * Math.max(1, containerRect.width - 100);
    div.y = Math.random() * Math.max(1, containerRect.height - 100);
  } else {
    // For circle container, position within circular area
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;
    const radius = Math.min(centerX, centerY) - 40;
    
    // Generate random position within circle
    const angle = Math.random() * 2 * Math.PI;
    const r = Math.random() * radius;
    div.x = centerX + Math.cos(angle) * r;
    div.y = centerY + Math.sin(angle) * r;
  }
  
  div.style.position = "absolute";
  div.style.left = div.x + "px";
  div.style.top = div.y + "px";
  
  // For circle container, ensure container is positioned
  if (container !== document.body && getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

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

  div.style.width = s + "px";
  div.style.height = s + "px";
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

  container.appendChild(div);
  if (container === document.body) ships.push(div); else circleShips.push(div);
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

function createCircleOverlay() {
  if (circleOverlayEl) return circleOverlayEl;
  const overlay = document.createElement("div");
  overlay.id = "circleOverlay";
  const circle = document.createElement("div");
  circle.className = "circle";

  circle.style.position = "absolute";
  circle.style.left = circle.style.left || "0px";
  circle.style.top = circle.style.top || "0px";
  circle.style.boxSizing = "border-box";
  circle.style.borderRadius = "50%";
  circle.style.overflow = "hidden";
  
  // initialize circleState positions if not set
  const vminPx = Math.min(window.innerWidth, window.innerHeight) / 100;
  const sizePx = circleState.sizeVmin * vminPx;
  if (circleState.left === null) circleState.left = Math.round((window.innerWidth - sizePx) / 2);
  if (circleState.top === null) circleState.top = Math.round((window.innerHeight - sizePx) / 2);
  if (typeof updateCircleStyles === "function") updateCircleStyles();

  overlay.appendChild(circle);

  const bgVideo = document.getElementById("bgVideo");
  if (bgVideo && bgVideo instanceof HTMLVideoElement) {
    const v = document.createElement("video");
    try { 
      v.src = bgVideo.currentSrc || videoVariants[currentBgVariant].src || "";
    } catch (e) { 
      v.src = videoVariants[currentBgVariant].src || "";
    }
    v.autoplay = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.style.width = "100%";
    v.style.height = "100%";
    v.style.objectFit = "cover";
    circle.appendChild(v);
    v.play().catch(()=>{});

    // Monitor the circle video performance
    (function startCircleVideoQualityMonitor(){
      const intervalMs = 3000;
      const lowFpsThreshold = 20;
      let switched = false;

      console.log("[CIRCLE VIDEO] Starting quality monitor...");

      if (typeof v.getVideoPlaybackQuality === "function") {
        console.log("[CIRCLE VIDEO] Using getVideoPlaybackQuality");
        let lastTotal = 0;
        let lastDropped = 0;
        setInterval(() => {
          try {
            const q = v.getVideoPlaybackQuality();
            const total = q.totalVideoFrames || 0;
            const dropped = q.droppedVideoFrames || 0;
            const totalDelta = total - lastTotal;
            const droppedDelta = dropped - lastDropped;
            lastTotal = total; lastDropped = dropped;
            
            if (totalDelta > 0) {
              const fps = totalDelta / (intervalMs/1000);
              const dropRatio = droppedDelta / Math.max(1, totalDelta);
              console.log(`[CIRCLE VIDEO] FPS: ${fps.toFixed(1)}, Drop ratio: ${(dropRatio*100).toFixed(1)}%, Current: ${videoVariants[currentBgVariant].src}`);
              
              if ((fps < lowFpsThreshold || dropRatio > 0.12) && !switched && currentBgVariant < videoVariants.length - 1) {
                console.log(`[CIRCLE VIDEO] Performance issue detected - switching down from variant ${currentBgVariant}`);
                switched = true;
                setBgVideoVariant(currentBgVariant + 1, "performance");
                // Update circle video source too
                setTimeout(() => {
                  try {
                    v.src = videoVariants[currentBgVariant].src;
                    v.load();
                    v.play().catch(()=>{});
                  } catch (e) { console.error("[CIRCLE VIDEO] Failed to update circle video src:", e); }
                }, 100);
              }
            }
          } catch (e) { 
            console.error("[CIRCLE VIDEO] Quality monitoring error:", e);
          }
        }, intervalMs);
      }
    })();
  } else {
    const p = document.createElement("div");
    p.style.color = "#fff";
    p.style.padding = "24px";
    p.innerText = "Preview unavailable";
    circle.appendChild(p);
  }

  overlay.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(overlay);
  circleOverlayEl = overlay;
  return overlay;
}

function updateCircleStyles(){
  if (!circleOverlayEl) return;
  const circle = circleOverlayEl.querySelector(".circle");
  if (!circle) return;
  const vminPx = Math.min(window.innerWidth, window.innerHeight) / 100;
  const sizePx = Math.max(10, Math.min(200, circleState.sizeVmin)) * vminPx;
  // enforce bounds: keep circle within viewport
  circleState.left = Math.max(0, Math.min(window.innerWidth - sizePx, circleState.left));
  circleState.top = Math.max(0, Math.min(window.innerHeight - sizePx, circleState.top));
  // apply dimensions and position
  circle.style.width = `${circleState.sizeVmin}vmin`;
  circle.style.height = `${circleState.sizeVmin}vmin`;
  circle.style.left = `${Math.round(circleState.left)}px`;
  circle.style.top = `${Math.round(circleState.top)}px`;
  // apply skew transform (keep center)
  circle.style.transform = `skew(${circleState.skewX}deg, ${circleState.skewY}deg)`;

  try {
    localStorage.setItem("circleState", JSON.stringify({
      sizeVmin: circleState.sizeVmin,
      left: Math.round(circleState.left),
      top: Math.round(circleState.top),
      skewX: circleState.skewX,
      skewY: circleState.skewY
    }));
  } catch (e) { /* ignore */ }

  try {
    const rect = circle.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const radius = Math.min(centerX, centerY) - 40; // Visible circle boundary
    const shipSize = 150; // Match the animation logic
    const safeRadius = radius - 20; // Safe zone inside circle
    const maxDistance = radius + (shipSize * 2); // Much larger tolerance for "lost" ships
    
    for (const s of circleShips) {
      if (!s) continue;

      const dx = s.x - centerX;
      const dy = s.y - centerY;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      
      // If ship doesn't have position, place it within visible circle
      if (typeof s.x !== "number" || typeof s.y !== "number" || distanceFromCenter > safeRadius) {
        // Generate random position within visible circle
        console.log(`[CIRCLE] Repositioning ship due to resize - distance: ${distanceFromCenter.toFixed(1)}, radius: ${radius.toFixed(1)}`);
        
        // Generate random position within safe circle area
        const angle = Math.random() * 2 * Math.PI;
        const r = Math.random() * safeRadius;
        s.x = centerX + Math.cos(angle) * r;
        s.y = centerY + Math.sin(angle) * r;
        
        // Reset ship position immediately
        s.style.left = Math.round(s.x) + "px";
        s.style.top = Math.round(s.y) + "px";
      } else if (distanceFromCenter > maxDistance) {
        console.log(`[CIRCLE] Repositioning lost ship at distance ${distanceFromCenter.toFixed(1)} (max: ${maxDistance.toFixed(1)})`);
        // Move ship to a random position within visible circle
        const angle = Math.random() * 2 * Math.PI;
        const r = Math.random() * safeRadius;
        s.x = centerX + Math.cos(angle) * r;
        s.y = centerY + Math.sin(angle) * r;
        
        // Reset ship position immediately
        s.style.left = Math.round(s.x) + "px";
        s.style.top = Math.round(s.y) + "px";
      } else {
        // Check if ship is WAY too far outside (truly lost ships only)
        s.style.left = Math.round(s.x) + "px";
        s.style.top = Math.round(s.y) + "px";
      }
    }
  } catch (e) { /* non-critical */ }
}

function centerCircle() {
  const vminPx = Math.min(window.innerWidth, window.innerHeight) / 100;
  const sizePx = circleState.sizeVmin * vminPx;
  circleState.left = Math.round((window.innerWidth - sizePx) / 2);
  circleState.top = Math.round((window.innerHeight - sizePx) / 2);
  updateCircleStyles();
}

async function toggleCircleMode(force) {
  const el = createCircleOverlay();
  const circle = el.querySelector(".circle");
  const isActive = el.classList.contains("active");
  const shouldActivate = (typeof force === "boolean") ? force : !isActive;
  const inputBox = document.getElementById("inputBox");

  if (shouldActivate) {

    // request fullscreen
    let fsPromise = null;
    if (document.documentElement.requestFullscreen) {
      fsPromise = document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
      fsPromise = new Promise(r => setTimeout(r, 120));
    }
    try { await fsPromise; } catch (_) { /* ignore if denied */ }

    if (inputBox) {
      _savedInputDisplay = inputBox.style.display || "";
      inputBox.style.display = "none";
    }

    // mark overlay active and ensure circle gets correct inline sizing/position
    el.classList.add("active");
    if (typeof centerCircle === "function") centerCircle();
    if (typeof updateCircleStyles === "function") updateCircleStyles();
    enableCursorAutoHide();

    // hide original ships
    for (const s of ships) s.style.display = "none";


    // Add from current ships that might not be in messages yet
    // SIMPLE APPROACH: Sync current ships to messages, then create from messages
    ships.forEach(ship => {
      if (ship.dataset && ship.dataset.text) {
        const shipText = ship.dataset.text;
        const shipHasEmail = ship.dataset.hasEmail === "1";
        
        const exists = messages.some(m => 
          m.text === shipText && (!!m.hasEmail) === shipHasEmail
        );
        
        if (!exists) {
          console.log(`[CIRCLE] Adding recent ship to messages: "${shipText.substring(0, 30)}..."`);
          messages.push({
            text: shipText,
            hasEmail: shipHasEmail,
            time: new Date().toISOString()
          });
        }
      }
    });
    
    saveMessagesToLog();

    // Create all ships in circle from the complete messages array
    messages.forEach(m => {
      createShip(m, circle);
    });

    // start animation loop for circleShips
    if (!window._circleAnimating) {
      window._circleAnimating = true;
      (function animateCircleShips(){
        const rect = circle.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const radius = Math.min(centerX, centerY) - 40;
        const shipSize = 150; // INCREASED - ships must be completely hidden before wrapping
        const exitRadius = radius + shipSize;
        
        for (let div of circleShips) {
          // Initialize position within circle if not set
          if (typeof div.x !== "number" || typeof div.y !== "number") {
            const angle = Math.random() * 2 * Math.PI;
            const r = Math.random() * (radius - 30); // Keep ships well inside initially
            div.x = centerX + Math.cos(angle) * r;
            div.y = centerY + Math.sin(angle) * r;
          }
          
          // Update position
          div.x += div.vx + Math.sin(Date.now()*0.001 + div.x) * 0.2;
          div.y += div.vy + Math.cos(Date.now()*0.001 + div.y) * 0.2;

          // Check if ship is COMPLETELY outside the visible circle
          const dx = div.x - centerX;
          const dy = div.y - centerY;
          const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
          
          if (distanceFromCenter > exitRadius) {
            // Ship is completely hidden - wrap to opposite side
            const exitAngle = Math.atan2(dy, dx);
            const entryAngle = exitAngle + Math.PI;
            
            // Place ship well outside on opposite side
            const entryDistance = radius + (shipSize * 0.9);
            div.x = centerX + Math.cos(entryAngle) * entryDistance;
            div.y = centerY + Math.sin(entryAngle) * entryDistance;
            
            console.log(`[CIRCLE] Ship wrapped at distance ${distanceFromCenter.toFixed(1)} -> ${entryDistance.toFixed(1)}`);
          }

          // Apply position and rotation
          div.style.left = div.x + "px";
          div.style.top = div.y + "px";
          div.style.transform = `rotate(${div.angle}deg)`;
          div.angle += div.rotationSpeed;
        }
        if (window._circleAnimating) requestAnimationFrame(animateCircleShips);
      })();
    }
  } else {
    // exit fullscreen
    let exitPromise = null;
    if (document.exitFullscreen) {
      exitPromise = document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
      exitPromise = new Promise(r => setTimeout(r, 120));
    } else {
      exitPromise = Promise.resolve();
    }
    try { await exitPromise; } catch (_) { /* ignore */ }

    // remove circle ships and stop animation
    for (const s of circleShips) if (s && s.remove) s.remove();
    circleShips = [];
    window._circleAnimating = false;

    // restore original ships and input UI
    for (const s of ships) s.style.display = "";
    if (inputBox) {
      // If we saved an explicit non-"none" display value, restore it.
      // Otherwise fall back to empty string to allow CSS to show it.
      inputBox.style.display = (_savedInputDisplay && _savedInputDisplay !== "none")
        ? _savedInputDisplay
        : "";
      _savedInputDisplay = null;
    } else {
      // fallback: ensure the main text input is visible if wrapper missing
      const t = document.getElementById("textInput");
      if (t) t.style.display = "";
    }
    // also ensure textInput is shown (defensive)
    const t2 = document.getElementById("textInput");
    if (t2) t2.style.display = "";
    disableCursorAutoHide();
    el.classList.remove("active");
  }
}
// ...existing code...

document.addEventListener('keydown', (e) => {
  // Accept Ctrl+Q on Windows/Linux, Cmd+Q on macOS (avoid OS quit on mac if possible)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'q' || e.key === 'Q')) {
    e.preventDefault();
    toggleCircleMode();
    // Some browsers change viewport after fullscreen; reapply sizes shortly after
    setTimeout(() => { if (typeof updateCircleStyles === 'function') updateCircleStyles(); }, 60);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key && e.key.toLowerCase() === "z") zResizeMode = true;
});
document.addEventListener("keyup", (e) => {
  if (e.key && e.key.toLowerCase() === "z") zResizeMode = false;
});

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = document.fullscreenElement !== null;
  const circleActive = circleOverlayEl && circleOverlayEl.classList.contains("active");
  
  // If fullscreen was exited but circle mode is still active, deactivate circle mode
  if (!isFullscreen && circleActive) {
    toggleCircleMode(false);
  }
});

window.addEventListener("resize", () => {
  // recompute top/left relative to new vmin if desired (keep px values, just clamp)
  updateCircleStyles();
});

document.addEventListener("keydown", (e) => {
  if (!circleOverlayEl || !circleOverlayEl.classList.contains("active")) return;
  const arrowKeys = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"];
  if (!arrowKeys.includes(e.key)) return;
  // prevent page scroll
  e.preventDefault();

  const moveStep = 24;       // px per arrow
  const resizeStepVmin = 2;  // vmin per ctrl+arrow
  const skewStep = 3;        // degrees per shift+arrow

  if (zResizeMode) {
    const delta = (e.key === "ArrowUp" || e.key === "ArrowRight") ? resizeStepVmin : -resizeStepVmin;
    circleState.sizeVmin = Math.max(10, Math.min(200, circleState.sizeVmin + delta));
    updateCircleStyles();
    return;
  }

  if (e.shiftKey) {
    // Skew: Left/Right adjust skewX, Up/Down adjust skewY
    if (e.key === "ArrowLeft") circleState.skewX = Math.max(-45, circleState.skewX - skewStep);
    if (e.key === "ArrowRight") circleState.skewX = Math.min(45, circleState.skewX + skewStep);
    if (e.key === "ArrowUp") circleState.skewY = Math.max(-45, circleState.skewY - skewStep);
    if (e.key === "ArrowDown") circleState.skewY = Math.min(45, circleState.skewY + skewStep);
    updateCircleStyles();
    return;
  }

  // Move mode: arrow keys move the circle
  if (e.key === "ArrowLeft") circleState.left -= moveStep;
  if (e.key === "ArrowRight") circleState.left += moveStep;
  if (e.key === "ArrowUp") circleState.top -= moveStep;
  if (e.key === "ArrowDown") circleState.top += moveStep;
  updateCircleStyles();
});

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

  const textInput = document.getElementById("textInput");
  const checkbox = document.getElementById("feedbackCheckbox");
  const emailInput = document.getElementById("emailInput");

  let reconnectAttempts = 0;
  let wasConnected = false;
  let socket = null;
  
  // Progressive reconnection thresholds
  const FORCE_NEW_THRESHOLD = 10; // Force new connection after 10 failed attempts
  const ESCALATION_THRESHOLD = 20; // More aggressive tactics after 20 attempts
  
  function createSocket(forceNew = false) {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    
    socket = io({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: forceNew // This is the key change
    });
    
    window.socket = socket;
    setupSocketHandlers();
    return socket;
  }
  
  function setupSocketHandlers() {
    socket.on("connect", () => {
      console.log("socket connected", socket.id);
      
      if (wasConnected && reconnectAttempts > 0) {
        console.log(`[RECONNECT] Successfully reconnected after ${reconnectAttempts} attempts ${socket.io.opts.forceNew ? '(forced new connection)' : ''}`);
        
        // Reset escalation after successful connection
        reconnectAttempts = 0;
      } else if (!wasConnected) {
        console.log("[CONNECT] Initial connection established");
      }
      
      wasConnected = true;
    });

    socket.on("disconnect", (reason) => {
      console.log(`[DISCONNECT] Socket disconnected: ${reason}`);
    });

    socket.on("connect_error", (err) => {
      console.error("[CONNECT ERROR] Socket connect_error:", err);
    });

    socket.on("reconnect_attempt", (attemptNumber) => {
      reconnectAttempts = attemptNumber;
      console.log(`[RECONNECT] Attempt #${attemptNumber}`);
      
      // Progressive escalation strategy
      if (attemptNumber === FORCE_NEW_THRESHOLD) {
        console.log(`[RECONNECT] ${FORCE_NEW_THRESHOLD} attempts failed - switching to forceNew: true`);
        createSocket(true); // Force new connection
        
      } else if (attemptNumber === ESCALATION_THRESHOLD) {
        console.log(`[RECONNECT] ${ESCALATION_THRESHOLD} attempts failed - trying complete reset`);
        // Even more aggressive: wait longer then force new
        setTimeout(() => {
          createSocket(true);
        }, 10000); // Wait 10 seconds before trying again
        
      } else if (attemptNumber > ESCALATION_THRESHOLD && attemptNumber % 30 === 0) {
        // Every 30 attempts after escalation, try a complete reset
        console.log(`[RECONNECT] Attempt ${attemptNumber} - periodic complete reset`);
        setTimeout(() => {
          createSocket(true);
        }, 15000); // Wait 15 seconds
      }
    });

    socket.on("reconnect", (attemptNumber) => {
      console.log(`[RECONNECT] Reconnected after ${attemptNumber} attempts`);
      reconnectAttempts = 0; // Reset counter on success
    });

    socket.on("reconnect_failed", () => {
      console.error("[RECONNECT] All reconnection attempts failed - this shouldn't happen with Infinity attempts");
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
      const created = createShip(msg);
      if (created && created.dataset) created.dataset.text = msg.text;

      if (circleOverlayEl && circleOverlayEl.classList.contains("active")) {
        const circle = circleOverlayEl.querySelector(".circle");
        if (circle) {
          console.log(`[CIRCLE MODE] Adding new ship to circle: ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`);
          createShip(msg, circle);
        }
      }  // ← FIXED: Added missing closing brace
      
      console.log(`[NEW MESSAGE] Received: ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`);
    });

    

    // Rest of your existing socket handlers (init, clearAll, restoreAll)...
    socket.on("init", msgs => {
      const wasEmpty = messages.length === 0;
      const newCount = msgs.length;
      const oldCount = messages.length;
      
      console.log(`[STATE SYNC] Received ${newCount} messages from server (had ${oldCount} locally)`);
      
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
      
      if (wasConnected && newCount !== oldCount) {
        const diff = newCount - oldCount;
        if (diff > 0) {
          console.log(`[STATE SYNC] ${diff} new messages added during disconnection`);
        } else if (diff < 0) {
          console.log(`[STATE SYNC] ${Math.abs(diff)} messages were removed during disconnection`);
        }
      }
    });

    socket.on("clearAll", () => {
      console.log("[ADMIN] All ships cleared by admin");
      clearShips();
      for (const s of circleShips) if (s && s.remove) s.remove();
      circleShips = [];
      messages = [];
      
      try {
        localStorage.removeItem("messages");
      } catch (e) { /* ignore */ }
      if (circleOverlayEl && circleOverlayEl.classList.contains("active")) {
        console.log("[CIRCLE MODE] All ships cleared from circle view");
      }
    });

    socket.on("restoreAll", (msgs) => {
      console.log(`[ADMIN] All ships restored by admin (${msgs.length} messages)`);
      clearShips();
      for (const s of circleShips) if (s && s.remove) s.remove();
      circleShips = [];
      messages = [];
      
      msgs.forEach(m => {
        messages.push(m);
        createShip(m);
      });
      if (circleOverlayEl && circleOverlayEl.classList.contains("active")) {
        const circle = circleOverlayEl.querySelector(".circle");
        if (circle) {
          console.log(`[CIRCLE MODE] Restoring ${msgs.length} ships to circle view`);
          msgs.forEach(m => {
            createShip(m, circle);
          });
        }
      }
      try {
        localStorage.setItem("messages", JSON.stringify(messages));
      } catch (e) { /* ignore */ }
    });

    socket.on("deleteShip", (data) => {
      const shipText = data.shipText;
      console.log(`[ADMIN] Ship deleted by admin: "${shipText.substring(0, 50)}${shipText.length > 50 ? '...' : ''}"`);
      
      // Remove from main view ships
      const mainShipsToRemove = ships.filter(s => s.dataset && s.dataset.text === shipText);
      mainShipsToRemove.forEach(ship => {
        ship.remove();
        ships = ships.filter(s => s !== ship);
      });
      
      // Remove from circle view ships
      const circleShipsToRemove = circleShips.filter(s => s.dataset && s.dataset.text === shipText);
      circleShipsToRemove.forEach(ship => {
        ship.remove();
        circleShips = circleShips.filter(s => s !== ship);
      });
      
      // Remove from local messages array
      messages = messages.filter(m => m.text !== shipText);
      saveMessagesToLog();
      
      console.log(`[ADMIN] Removed ${mainShipsToRemove.length} ships from main view and ${circleShipsToRemove.length} ships from circle view`);
    });
  }

  // Initialize with normal connection first
  createSocket(false);

  

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
    
    // Set video source FIRST
    if (!bg.src) bg.src = videoVariants[currentBgVariant].src;

    // ensure muted to maximize autoplay chance
    try { bg.muted = true; } catch (e) { /* ignore */ }

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

    const isPlaying = () => !!(bg && !bg.paused && !bg.ended && bg.readyState > 2);
    const update = () => { btn.style.display = isPlaying() ? "none" : "block"; };

    const tryPlay = async () => {
      try {
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
  if (!bg) return;

  bg.addEventListener("loadstart", () => {
    try {
      bg.preload = "auto";
      bg.crossOrigin = "anonymous";
      bg.playsInline = true;
      bg.setAttribute("webkit-playsinline", "true");
      bg.setAttribute("x-webkit-airplay", "allow");
    } catch (e) {}
  });

  // 2. Buffer optimization
  bg.addEventListener("progress", () => {
    try {
      const buffered = bg.buffered;
      if (buffered.length > 0) {
        const bufferedEnd = buffered.end(buffered.length - 1);
        const duration = bg.duration;
        if (duration > 0 && bufferedEnd >= duration - 1) {
          // Video is almost fully buffered - good for smooth looping
          console.log("[SAFARI] Video buffer optimized for smooth looping");
        }
      }
    } catch (e) {}
  });

  // Force seamless looping for Chrome/Safari
  bg.addEventListener("timeupdate", () => {
    // More aggressive reset for Safari - catch it earlier
    if (bg.duration > 0 && bg.currentTime >= bg.duration - 1.0 && bg.currentTime < bg.duration - 0.8) {
      try {
        // Hint to browser to prepare for loop restart
        if (bg.buffered.length > 0 && bg.buffered.start(0) > 0.5) {
          // Buffer doesn't include start - preload it
          const tempTime = bg.currentTime;
          bg.currentTime = 0.1;
          setTimeout(() => { if (bg.currentTime < 1) bg.currentTime = tempTime; }, 50);
        }
      } catch (e) {}
    }
  });

  // Additional Safari-specific loop handling
  bg.addEventListener("ended", () => {
    if (!loopResetInProgress) {
      loopResetInProgress = true;
      bg.currentTime = 0;
      bg.play().catch(() => {});
      setTimeout(() => { loopResetInProgress = false; }, 100);
    }
  });

  // Safari sometimes fires 'stalled' during loop transitions
  bg.addEventListener("stalled", () => {
    if (bg.readyState >= 2 && !bg.paused) {
      // Video has data but playback stalled - try to resume
      setTimeout(() => {
        if (!bg.paused && bg.currentTime === bg.duration) {
          bg.currentTime = 0;
          bg.play().catch(() => {});
        }
      }, 50);
    }
  });

  // Ensure smooth playback settings for Safari
  bg.addEventListener("loadeddata", () => {
    try {
      bg.playbackRate = 1.0;
      // Safari-specific: ensure the video is ready for seamless looping
      const preloadTime = Math.max(0, bg.duration - 2);
      bg.currentTime = preloadTime;
      
      setTimeout(() => {
        bg.currentTime = 0; // Reset to beginning
        if (!bg.paused) bg.play().catch(() => {});
      }, 200);
    } catch (e) {}
  });

  // Safari sometimes benefits from manual loop detection
  bg.addEventListener("loadedmetadata", () => {
    // Ensure loop attribute is properly set for Safari
    bg.loop = true;
  });
  let lastTime = 0;
  let frameCount = 0;

  function safariLoopMonitor() {
    if (bg && bg.duration > 0 && !bg.paused && !bg.ended) {
    const currentTime = bg.currentTime;
    frameCount++;
    
    // Multiple detection strategies for better coverage
    const nearEnd = currentTime >= bg.duration - 0.1;
    const timeStuck = Math.abs(currentTime - lastTime) < 0.005 && currentTime > bg.duration - 0.5;
    const frameStuck = frameCount % 60 === 0 && currentTime > bg.duration - 0.3;
    
    // Trigger reset if any condition is met
    if ((nearEnd || timeStuck || frameStuck) && !loopResetInProgress) {
      console.log("[SAFARI] Enhanced loop reset triggered");
      loopResetInProgress = true;
      
      // Smoother reset with easing (optional - test if it helps)
      bg.currentTime = 0;
          setTimeout(() => { loopResetInProgress = false; }, 150);
      }
      
      lastTime = currentTime;
    }
    
    requestAnimationFrame(safariLoopMonitor);
  }
  
  // Start Safari monitoring when video is playing
  bg.addEventListener("playing", () => {
    if (!bg.dataset.safariMonitorStarted) {
      bg.dataset.safariMonitorStarted = "true";
      safariLoopMonitor();
    }
  });

    setTimeout(() => {
      if (typeof bg.getVideoPlaybackQuality === "function") {
        console.log("[BG VIDEO] Will start quality monitor in 10 seconds...");
        
        // Wait 10 seconds before starting monitoring
        setTimeout(() => {
          console.log("[BG VIDEO] Starting quality monitor...");
          let lastTotal = 0;
          let lastDropped = 0;
          let monitorStarted = false;
          let samples = [];
          const minSamplesBeforeSwitch = 3; // At least 3 samples (30 seconds) before switching
          
          const monitorInterval = setInterval(() => {
            if (!bg || bg.paused || bg.ended) return;
            if (!monitorStarted && bg.readyState >= 2) monitorStarted = true;
            if (!monitorStarted) return;
            
            try {
              const q = bg.getVideoPlaybackQuality();
              const total = q.totalVideoFrames || 0;
              const dropped = q.droppedVideoFrames || 0;
              const totalDelta = total - lastTotal;
              const droppedDelta = dropped - lastDropped;
              lastTotal = total; lastDropped = dropped;
              
              if (totalDelta > 0) {
                const fps = totalDelta / 3;
                const dropRatio = droppedDelta / Math.max(1, totalDelta);
                
                // Store sample for averaging
                samples.push({ fps, dropRatio });
                
                console.log(`[BG VIDEO] FPS: ${fps.toFixed(1)}, Drop ratio: ${(dropRatio*100).toFixed(1)}%, Samples: ${samples.length}/${minSamplesBeforeSwitch}, Current: ${videoVariants[currentBgVariant].src}`);
                
                // Only consider switching after we have enough samples (at least 30 seconds of data)
                if (samples.length >= minSamplesBeforeSwitch) {
                  // Calculate averages over the collected samples
                  const avgFps = samples.reduce((sum, s) => sum + s.fps, 0) / samples.length;
                  const avgDropRatio = samples.reduce((sum, s) => sum + s.dropRatio, 0) / samples.length;
                  
                  console.log(`[BG VIDEO] Average over ${samples.length} samples: FPS: ${avgFps.toFixed(1)}, Drop ratio: ${(avgDropRatio*100).toFixed(1)}%`);
                  
                  if ((avgFps < 17 || avgDropRatio > 0.24) && !switchedDueToChoppy && currentBgVariant < videoVariants.length - 1) {
                    console.log(`[BG VIDEO] Performance issue detected based on averages - switching down`);
                    switchedDueToChoppy = true;
                    setBgVideoVariant(currentBgVariant + 1, "performance");
                    // Reset samples after switching
                    samples = [];
                  }
                  
                  // Keep only the last 10 samples (sliding window of ~30 seconds)
                  if (samples.length > 10) {
                    samples = samples.slice(-10);
                  }
                }
              }
            } catch (e) { 
              console.error("[BG VIDEO] Quality monitoring error:", e);
            }
          }, 3000); // Still check every 3 seconds

        }, 5000); // Wait 5 seconds before starting monitoring
      }
    }, 1000); // delay to ensure bg is ready

    window.__setBgVideoVariant = (i) => { setBgVideoVariant(i, "manual"); };
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
    const wantsFeedback = checkbox ? checkbox.checked : false;
    let email = null;
    
    if (wantsFeedback && emailInput) {
      const v = emailInput.value.trim();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (v && emailPattern.test(v)) {
        email = v;
      }
    }
    
    if(text){
      if (!socket.connected) {
        console.error("[SEND] Socket not connected - cannot send message");
        alert("Connection lost - your message will be sent when reconnected. Please wait...");
        return;
      }
      
      const payload = { text };
      if (email) payload.email = email;
      console.log("[SEND] client emit newText ->", payload);
      socket.emit("newText", payload);
      
      // Clear form
      if (textInput) { textInput.value = ""; textInput.style.height = "auto"; }
      if (checkbox) checkbox.checked = false;
      if (emailInput) { emailInput.value = ""; emailInput.style.display = "none"; }
    }
  }
  window.sendText = sendText;

  

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
            checkBackupStatus();
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

  async function checkBackupStatus() {
    if (!window._adminPassword) return;
    try {
      const res = await fetch("/api/admin/backup-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: window._adminPassword }),
      });
      if (res.ok) {
        const data = await res.json();
        const undoBtn = document.getElementById("admin-undo-button");
        if (undoBtn && data.hasBackup) {
          undoBtn.style.display = "block";
          // Optionally show backup info in button text
          const count = data.backupInfo?.messageCount || 0;
          undoBtn.innerText = `Undo Clear All (${count} ships)`;
        }
      }
    } catch (err) {
      console.error("Error checking backup status:", err);
    }
}

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
  container.style.gap = "8px"; 
  document.body.appendChild(container);

  const undoBtn = document.createElement("button");
  undoBtn.id = "admin-undo-button";
  undoBtn.innerText = "Undo Clear All";
  undoBtn.style.background = "#228822";
  undoBtn.style.color = "#fff";
  undoBtn.style.border = "1px solid #116611";
  undoBtn.style.padding = "6px 10px";
  undoBtn.style.borderRadius = "4px";
  undoBtn.style.cursor = "pointer";
  undoBtn.style.fontSize = "12px";
  undoBtn.style.display = "none"; // hidden initially
    undoBtn.onclick = async () => {
    const confirmed = confirm("Restore all previously cleared ships?");
    if (!confirmed) return;

    try {
      undoBtn.innerText = "Restoring...";
      undoBtn.disabled = true;
      
      const res = await fetch("/api/admin/undo-clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: window._adminPassword }),
      });
      
      if (res.ok) {
        const data = await res.json();
        alert(`Successfully restored ${data.restored} ships!`);
        undoBtn.style.display = "none"; // hide after successful undo
      } else if (res.status === 400) {
        alert("No backup available to restore from.");
        undoBtn.style.display = "none";
      } else if (res.status === 401) {
        alert("Unauthorized. Please re-authenticate as admin.");
      } else {
        alert(`Failed to restore ships: ${res.status}`);
      }
    } catch (err) {
      alert("Error restoring ships: " + err.message);
    } finally {
      undoBtn.innerText = "Undo Clear All";
      undoBtn.disabled = false;
      // Refresh backup status in case of errors
      setTimeout(() => checkBackupStatus(), 500);
    }
  };
  container.appendChild(undoBtn);

  // clear all button
  const clearBtn = document.createElement("button");
  clearBtn.id = "admin-clear-all-button";
  clearBtn.innerText = "Clear All Ships";
  clearBtn.style.background = "#cc3333";
  clearBtn.style.color = "#fff";
  clearBtn.style.border = "1px solid #aa2222";
  clearBtn.style.padding = "6px 10px";
  clearBtn.style.borderRadius = "4px";
  clearBtn.style.cursor = "pointer";
  clearBtn.style.fontSize = "12px";
  clearBtn.onclick = async () => {
    const confirmed = confirm(
      `Are you sure you want to delete ALL ships?\n\n` +
      `This will:\n` +
      `• Remove all ${ships.length} visible ships from the screen\n` +
      `• Clear all ${messages.length} stored messages from server\n` +
      `• You can UNDO this action until the server restarts\n\n` +
      `Continue?`
    );
    
    if (!confirmed) return;
    
    const confirmation = prompt("Type exactly: DELETE ALL");
    if (confirmation !== "DELETE ALL") {
      alert("Confirmation text didn't match. Operation cancelled.");
      return;
    }

    try {
      clearBtn.innerText = "Clearing...";
      clearBtn.disabled = true;
      
      const res = await fetch("/api/admin/clear-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: window._adminPassword }),
      });
      
      if (res.ok) {
        const data = await res.json();
        clearShips();
        for (const s of circleShips) if (s && s.remove) s.remove();
        circleShips = [];
        messages = [];
        
        try {
          localStorage.removeItem("messages");
        } catch (e) { /* ignore */ }
        
        // Show undo button if backup was created
        if (data.backupAvailable) {
          undoBtn.style.display = "block";
        }
        
        alert("All ships cleared successfully! You can undo this action if needed.");
      } else if (res.status === 401) {
        alert("Unauthorized. Please re-authenticate as admin.");
      } else {
        alert(`Failed to clear ships: ${res.status}`);
      }
    } catch (err) {
      alert("Error clearing ships: " + err.message);
    } finally {
      clearBtn.innerText = "Clear All Ships";
      clearBtn.disabled = false;
    }
  };
  container.appendChild(clearBtn);

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