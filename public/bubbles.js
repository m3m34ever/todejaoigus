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

// comprehensive safari detection
function detectSafari() {
  // Method 1: Feature detection for video issues
  const testVideo = document.createElement('video');
  testVideo.muted = true;
  testVideo.style.display = 'none';
  
  const videoIndicators = [
    'webkitPlaysinline' in testVideo,
    !('requestPictureInPicture' in testVideo),
    typeof testVideo.requestVideoFrameCallback !== 'function'
  ].filter(Boolean).length;
  
  testVideo.remove();
  
  // Method 2: Check for Safari-specific globals
  const hasWebkitGlobals = !!(
    window.webkitURL || 
    window.webkitRequestAnimationFrame ||
    (window.safari && window.safari.pushNotification)
  );
  
  // Method 3: Check for Safari's unique audio context behavior
  const hasWebkitAudio = !!(
    window.webkitAudioContext && 
    !window.AudioContext
  );
  
  // Method 4: User agent as fallback (cleaned up)
  const userAgentSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  
  // Method 5: Check for Safari's unique touch behavior (mobile)
  const hasWebkitTouch = 'ontouchforcechange' in window;
  
  // Calculate confidence score
  const indicators = [
    videoIndicators >= 2,
    hasWebkitGlobals,
    hasWebkitAudio,
    userAgentSafari,
    hasWebkitTouch
  ].filter(Boolean).length;
  
  const isSafari = indicators >= 2; // Need at least 2 indicators
  
  if (isSafari) {
    console.log(`[SAFARI DETECTION] Detected Safari with ${indicators}/5 indicators:`, {
      videoFeatures: videoIndicators >= 2,
      webkitGlobals: hasWebkitGlobals,
      webkitAudio: hasWebkitAudio,
      userAgent: userAgentSafari,
      touchForce: hasWebkitTouch
    });
  }
  
  return isSafari;
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
    

    const isSafari = detectSafari();
    
    // ensure muted to maximize autoplay chance
    try { bg.muted = true; } catch (e) { /* ignore */ }

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

    const update = () => {
      // No button to update, just ensure video plays
      if (bg.paused) {
      bg.play().catch(() => {});
      }
    };

    // keep visibility in sync with playback state
    ["play","playing","pause","ended","loadeddata","canplay"].forEach(ev => bg.addEventListener(ev, update));

    // initial attempt and UI update
    update();
    tryPlay();

    // try again after first user gesture
    const onFirstGesture = () => { tryPlay(); window.removeEventListener("pointerdown", onFirstGesture); window.removeEventListener("touchstart", onFirstGesture); };
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("touchstart", onFirstGesture, { once: true });

    // ==================== SAFARI-ONLY SECTION ====================
    // because safari is broken and cannot handle video loops properly -_-
    if (isSafari) {
      console.log("[SAFARI] Using always-ready cached fallback");

      bg.loop = false;
      bg.removeAttribute("loop");
      
      // Create canvas that's ALWAYS visible as background layer
      const staticCanvas = document.createElement("canvas");
      staticCanvas.id = "safariStaticFallback";
      staticCanvas.style.position = "fixed";
      staticCanvas.style.top = "0";
      staticCanvas.style.left = "0";
      staticCanvas.style.width = "100vw";
      staticCanvas.style.height = "100vh";
      staticCanvas.style.objectFit = "cover";
      staticCanvas.style.zIndex = "-2"; // Force behind video
      staticCanvas.style.display = "block";
      
      // Set initial background color
      const ctx = staticCanvas.getContext("2d");
      staticCanvas.width = window.innerWidth;
      staticCanvas.height = window.innerHeight;
      ctx.fillStyle = "#313c34";
      ctx.fillRect(0, 0, staticCanvas.width, staticCanvas.height);
      
      bg.parentNode.insertBefore(staticCanvas, bg);
      
      let safariResetInProgress = false;
      let fallbackCache = new Map();
      let fallbackReady = false;
      
      // IMMEDIATE fallback generation
      const generateFallbackImmediately = () => {
        console.log("[SAFARI] Starting immediate fallback generation");
        
        const attemptGeneration = async () => {
          if (fallbackReady) return;
          
          try {
            if (bg.readyState < 2 || bg.videoWidth === 0) {
              console.log("[SAFARI] Video not ready yet, retrying in 500ms...");
              setTimeout(attemptGeneration, 500);
              return;
            }
            
            console.log("[SAFARI] Video ready, generating fallback now");
            
            // Set canvas to match video dimensions
            staticCanvas.width = bg.videoWidth;
            staticCanvas.height = bg.videoHeight;
            
            // Simple approach: capture current frame
            const ctx = staticCanvas.getContext("2d");
            ctx.drawImage(bg, 0, 0);
            
            // Store in cache
            const imageData = ctx.getImageData(0, 0, staticCanvas.width, staticCanvas.height);
            fallbackCache.set(bg.src, {
              imageData: imageData,
              width: staticCanvas.width,
              height: staticCanvas.height
            });
            
            fallbackReady = true;
            console.log("[SAFARI] Simple fallback generated and cached");
            
            // Enhanced version with blending
            setTimeout(generateEnhancedFallback, 1000);
            
          } catch (e) {
            console.error("[SAFARI] Immediate fallback failed:", e);
            setTimeout(attemptGeneration, 1000);
          }
        };
        
        attemptGeneration();
      };
      
      // Enhanced fallback with blending
      const generateEnhancedFallback = async () => {
        if (!bg || bg.readyState < 2) return;
        
        try {
          console.log("[SAFARI] Generating enhanced blended fallback");
          
          const originalTime = bg.currentTime;
          const wasPlaying = !bg.paused;
          
          // Capture first frame
          bg.currentTime = 0.1;
          await new Promise(resolve => {
            const onSeeked = () => {
              bg.removeEventListener('seeked', onSeeked);
              resolve();
            };
            bg.addEventListener('seeked', onSeeked);
            setTimeout(resolve, 500);
          });
          
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = bg.videoWidth;
          tempCanvas.height = bg.videoHeight;
          const tempCtx = tempCanvas.getContext("2d");
          
          tempCtx.drawImage(bg, 0, 0);
          const firstFrameData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          
          // Capture last frame
          bg.currentTime = Math.max(0, bg.duration - 0.5);
          await new Promise(resolve => {
            const onSeeked = () => {
              bg.removeEventListener('seeked', onSeeked);
              resolve();
            };
            bg.addEventListener('seeked', onSeeked);
            setTimeout(resolve, 500);
          });
          
          tempCtx.drawImage(bg, 0, 0);
          const lastFrameData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          
          // Blend frames
          const ctx = staticCanvas.getContext("2d");
          const blendedData = ctx.createImageData(tempCanvas.width, tempCanvas.height);
          const firstPixels = firstFrameData.data;
          const lastPixels = lastFrameData.data;
          const blendedPixels = blendedData.data;
          
          for (let i = 0; i < firstPixels.length; i += 4) {
            blendedPixels[i] = Math.round((firstPixels[i] + lastPixels[i]) / 2);
            blendedPixels[i + 1] = Math.round((firstPixels[i + 1] + lastPixels[i + 1]) / 2);
            blendedPixels[i + 2] = Math.round((firstPixels[i + 2] + lastPixels[i + 2]) / 2);
            blendedPixels[i + 3] = Math.round((firstPixels[i + 3] + lastPixels[i + 3]) / 2);
          }
          
          ctx.putImageData(blendedData, 0, 0);
          
          // Update cache
          fallbackCache.set(bg.src, {
            imageData: blendedData,
            width: staticCanvas.width,
            height: staticCanvas.height
          });
          
          // Restore video state
          bg.currentTime = originalTime;
          if (wasPlaying && bg.paused) {
            bg.play().catch(() => {});
          }
          
          console.log("[SAFARI] Enhanced blended fallback complete");
          tempCanvas.remove();
          
        } catch (e) {
          console.error("[SAFARI] Enhanced fallback failed:", e);
        }
      };
      
      // Start generation immediately
      generateFallbackImmediately();
      
      // Also trigger on video events
      bg.addEventListener("loadeddata", generateFallbackImmediately);
      bg.addEventListener("canplay", generateFallbackImmediately);
      
      // Safari reset handler
      const safariResetHandler = () => {
        if (safariResetInProgress || bg.duration <= 0) return;
        
        const timeLeft = bg.duration - bg.currentTime;
        
        if (timeLeft <= 1.0) {
          safariResetInProgress = true;
          console.log("[SAFARI] Reset triggered - video opacity to 0");
          
          // Hide video - canvas shows underneath
          bg.style.opacity = "0";
          bg.currentTime = 0;
          
          setTimeout(() => {
            bg.style.opacity = "1";
            console.log("[SAFARI] Video restored - opacity to 1");
            
            if (bg.paused) {
              bg.play().catch(() => {});
            }
            
            safariResetInProgress = false;
          }, 100);
        }
      };
      
      bg.addEventListener("timeupdate", safariResetHandler);
      
      // Handle video quality changes
      const originalSetBgVideoVariant = window.setBgVideoVariant || setBgVideoVariant;
      window.setBgVideoVariant = (idx, reason) => {
        const newSrc = videoVariants[idx].src;
        
        // Update video source
        bg.src = newSrc;
        bg.load();
        
        // Check cache
        if (fallbackCache.has(newSrc)) {
          const cached = fallbackCache.get(newSrc);
          staticCanvas.width = cached.width;
          staticCanvas.height = cached.height;
          const ctx = staticCanvas.getContext("2d");
          ctx.putImageData(cached.imageData, 0, 0);
          console.log("[SAFARI] Applied cached fallback for", newSrc);
        } else {
          // Generate for new video
          fallbackReady = false;
          bg.addEventListener("loadeddata", generateFallbackImmediately, { once: true });
        }
        
        // Continue with original function
        if (originalSetBgVideoVariant) {
          originalSetBgVideoVariant(idx, reason);
        }
        
        console.log(`[SAFARI] Updated video to ${newSrc}`);
      };
      
      console.log("[SAFARI] Always-ready fallback initialized - canvas always visible");
      
    } else {
      // ==================== NON-SAFARI SECTION ====================
      console.log("[NON-SAFARI] Using advanced dual video system with fallbacks");

      bg.loop = true;
      
      let dualVideoSystem = null;
      let currentVideoMode = 'single'; // 'dual' or 'single'
      let performanceDowngrades = 0;
      
      // Dual video system class
      class DualVideoSystem {
        constructor(bgVideo, quality) {
          this.mainVideo = bgVideo;
          this.quality = quality;
          this.secondaryVideo = null;
          this.currentActive = 'main';
          this.switchInProgress = false;
          this.preloadBuffer = 1.0; // seconds before end to start preloading
          this.switchBuffer = 0.2; // seconds before end to switch
          this.isActive = false;
          
          console.log(`[DUAL VIDEO] Initializing dual video system for ${quality}`);
          this.init();
        }
        
        init() {
          // Create secondary video element
          this.secondaryVideo = document.createElement('video');
          this.secondaryVideo.id = 'bgVideoSecondary';
          this.secondaryVideo.src = this.mainVideo.src;
          this.secondaryVideo.muted = true;
          this.secondaryVideo.playsInline = true;
          this.secondaryVideo.preload = 'auto';
          
          // Match main video styles
          this.secondaryVideo.style.position = 'fixed';
          this.secondaryVideo.style.top = '0';
          this.secondaryVideo.style.left = '0';
          this.secondaryVideo.style.width = '100vw';
          this.secondaryVideo.style.height = '100vh';
          this.secondaryVideo.style.objectFit = 'cover';
          this.secondaryVideo.style.zIndex = this.mainVideo.style.zIndex || '-1';
          this.secondaryVideo.style.opacity = '0';
          this.secondaryVideo.style.mixBlendMode = 'normal';
          this.secondaryVideo.style.transition = 'none';
          
          // Insert secondary video next to main video
          this.mainVideo.parentNode.insertBefore(this.secondaryVideo, this.mainVideo.nextSibling);
          
          // Disable native loop on both videos
          this.mainVideo.loop = false;
          this.secondaryVideo.loop = false;

          this.mainVideo.style.mixBlendMode = 'normal';
          
          this.setupEventListeners();
          this.isActive = true;
          
          console.log('[DUAL VIDEO] Blend mode secondary video created and positioned');
        }
        
        setupEventListeners() {
          // Main video timeupdate
          this.mainVideo.addEventListener('timeupdate', () => {
            if (!this.isActive || this.switchInProgress) return;
            
            const timeLeft = this.mainVideo.duration - this.mainVideo.currentTime;
            
            // Preload secondary video
            if (timeLeft <= this.preloadBuffer && this.currentActive === 'main') {
              this.preloadSecondary();
            }
            
            // Switch to secondary
            if (timeLeft <= this.switchBuffer && this.currentActive === 'main') {
              this.switchToSecondary();
            }
          });
          
          // Secondary video timeupdate
          this.secondaryVideo.addEventListener('timeupdate', () => {
            if (!this.isActive || this.switchInProgress) return;
            
            const timeLeft = this.secondaryVideo.duration - this.secondaryVideo.currentTime;
            
            // Preload main video
            if (timeLeft <= this.preloadBuffer && this.currentActive === 'secondary') {
              this.preloadMain();
            }
            
            // Switch to main
            if (timeLeft <= this.switchBuffer && this.currentActive === 'secondary') {
              this.switchToMain();
            }
          });
          
          // Error handlers
          this.mainVideo.addEventListener('error', (e) => {
            console.error('[DUAL VIDEO] Main video error:', e);
            this.handleError();
          });
          
          this.secondaryVideo.addEventListener('error', (e) => {
            console.error('[DUAL VIDEO] Secondary video error:', e);
            this.handleError();
          });
        }
        
        preloadSecondary() {
          if (this.secondaryVideo.readyState < 2) {
            console.log('[DUAL VIDEO] Preloading secondary video');
            this.secondaryVideo.currentTime = 0;
            this.secondaryVideo.load();
          }
        }
        
        preloadMain() {
          if (this.mainVideo.readyState < 2) {
            console.log('[DUAL VIDEO] Preloading main video');
            this.mainVideo.currentTime = 0;
            this.mainVideo.load();
          }
        }
        
        switchToSecondary() {
          if (this.switchInProgress || this.currentActive === 'secondary') return;
          
          this.switchInProgress = true;
          console.log('[DUAL VIDEO] Textured dissolve to secondary');
          
          if (this.secondaryVideo.readyState < 2) {
            console.warn('[DUAL VIDEO] Secondary not ready, forcing load');
            this.secondaryVideo.load();
          }
          
          // Start secondary video from beginning
          this.secondaryVideo.currentTime = 0;
          this.secondaryVideo.play().then(() => {
            
            // TEXTURED DISSOLVE - maintains visual complexity
            this.secondaryVideo.style.mixBlendMode = 'overlay'; // Preserves texture
            this.secondaryVideo.style.opacity = '0';
            
            // Animate opacity while maintaining texture
            let progress = 0;
            const steps = 10;
            
            const dissolveStep = () => {
              progress++;
              const ratio = progress / steps;
              
              // Secondary fades in with texture blending
              this.secondaryVideo.style.opacity = ratio.toString();
              // Main fades out but stays textured
              this.mainVideo.style.opacity = (1 - ratio).toString();
              
              if (progress < steps) {
                requestAnimationFrame(dissolveStep);
              } else {
                // Finalize transition
                this.secondaryVideo.style.mixBlendMode = 'normal';
                this.secondaryVideo.style.opacity = '1';
                this.mainVideo.style.opacity = '0';
                this.mainVideo.pause();
                this.currentActive = 'secondary';
                this.switchInProgress = false;
                console.log('[DUAL VIDEO] Textured dissolve complete');
              }
            };
            
            requestAnimationFrame(dissolveStep);
            
          }).catch(e => {
            console.error('[DUAL VIDEO] Failed to start secondary video:', e);
            this.switchInProgress = false;
            this.handleError();
          });
        }

        switchToMain() {
          if (this.switchInProgress || this.currentActive === 'main') return;
          
          this.switchInProgress = true;
          console.log('[DUAL VIDEO] Textured dissolve to main');
          
          // Start main video from beginning
          this.mainVideo.currentTime = 0;
          this.mainVideo.play().then(() => {
            
            // TEXTURED DISSOLVE
            this.mainVideo.style.mixBlendMode = 'overlay'; // Preserves texture
            this.mainVideo.style.opacity = '0';
            
            // Animate opacity while maintaining texture
            let progress = 0;
            const steps = 10;
            
            const dissolveStep = () => {
              progress++;
              const ratio = progress / steps;
              
              // Main fades in with texture blending
              this.mainVideo.style.opacity = ratio.toString();
              // Secondary fades out but stays textured
              this.secondaryVideo.style.opacity = (1 - ratio).toString();
              
              if (progress < steps) {
                requestAnimationFrame(dissolveStep);
              } else {
                // Finalize transition
                this.mainVideo.style.mixBlendMode = 'normal';
                this.mainVideo.style.opacity = '1';
                this.secondaryVideo.style.opacity = '0';
                this.secondaryVideo.pause();
                this.currentActive = 'main';
                this.switchInProgress = false;
                console.log('[DUAL VIDEO] Textured dissolve complete');
              }
            };
            
            requestAnimationFrame(dissolveStep);
            
          }).catch(e => {
            console.error('[DUAL VIDEO] Failed to start main video:', e);
            this.switchInProgress = false;
            this.handleError();
          });
        }
        
        updateSources(newSrc) {
          console.log(`[DUAL VIDEO] Updating blend-mode sources to ${newSrc}`);
          
          const wasPlaying = !this.mainVideo.paused || !this.secondaryVideo.paused;
          
          // Update both video sources
          this.mainVideo.src = newSrc;
          this.secondaryVideo.src = newSrc;
          
          // Reset to main video
          this.currentActive = 'main';
          this.mainVideo.style.opacity = '1';
          this.secondaryVideo.style.opacity = '0';
          
          // Reset blend modes
          this.mainVideo.style.mixBlendMode = 'normal';
          this.secondaryVideo.style.mixBlendMode = 'normal';
          
          // Load both videos
          this.mainVideo.load();
          this.secondaryVideo.load();
          
          if (wasPlaying) {
            setTimeout(() => {
              this.mainVideo.play().catch(() => {});
            }, 100);
          }
        }
        
        handleError() {
          console.error('[DUAL VIDEO] Blend-mode error occurred, falling back to single video');
          this.destroy();
          
          // Trigger performance downgrade
          if (window.downgradeDualVideo) {
            window.downgradeDualVideo();
          }
        }
        
        destroy() {
          console.log('[DUAL VIDEO] Destroying blend-mode dual video system');
          
          this.isActive = false;
          
          // Restore main video
          this.mainVideo.style.opacity = '1';
          this.mainVideo.style.transition = '';
          this.mainVideo.style.mixBlendMode = 'normal';
          this.mainVideo.loop = true;
          
          // Remove secondary video
          if (this.secondaryVideo && this.secondaryVideo.parentNode) {
            this.secondaryVideo.parentNode.removeChild(this.secondaryVideo);
          }
          
          this.secondaryVideo = null;
          currentVideoMode = 'single';
        }
      }
      
      // Performance monitoring for dual video
      function startDualVideoPerformanceMonitor() {
        if (typeof bg.getVideoPlaybackQuality !== "function") {
          console.log('[DUAL VIDEO] getVideoPlaybackQuality not available, skipping performance monitoring');
          return;
        }
        
        console.log("[DUAL VIDEO] Starting performance monitor...");
        let lastTotal = 0;
        let lastDropped = 0;
        let samples = [];
        const minSamplesBeforeDowngrade = 5;
        let monitorStarted = false;
        
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
              
              samples.push({ fps, dropRatio });
              
              console.log(`[DUAL VIDEO] FPS: ${fps.toFixed(1)}, Drop ratio: ${(dropRatio*100).toFixed(1)}%, Mode: ${currentVideoMode}, Samples: ${samples.length}/${minSamplesBeforeDowngrade}`);
              
              if (samples.length >= minSamplesBeforeDowngrade) {
                const avgFps = samples.reduce((sum, s) => sum + s.fps, 0) / samples.length;
                const avgDropRatio = samples.reduce((sum, s) => sum + s.dropRatio, 0) / samples.length;
                
                console.log(`[DUAL VIDEO] Average over ${samples.length} samples: FPS: ${avgFps.toFixed(1)}, Drop ratio: ${(avgDropRatio*100).toFixed(1)}%`);
                
                // More aggressive thresholds for dual video (since it uses more resources)
                if ((avgFps < 20 || avgDropRatio > 0.15) && currentVideoMode === 'dual') {
                  console.log(`[DUAL VIDEO] Performance issue detected - downgrading from dual video`);
                  downgradeDualVideo();
                  samples = [];
                } else if ((avgFps < 17 || avgDropRatio > 0.24) && currentVideoMode === 'single' && currentBgVariant < videoVariants.length - 1) {
                  console.log(`[DUAL VIDEO] Performance issue detected - switching to lower quality`);
                  downgradeDualVideo();
                  samples = [];
                }
                
                // Keep only recent samples
                if (samples.length > 10) {
                  samples = samples.slice(-5);
                }
              }
            }
          } catch (e) { 
            console.error("[DUAL VIDEO] Performance monitoring error:", e);
          }
        }, 3000);
        
        return monitorInterval;
      }
      
      // Progressive downgrade system
      window.downgradeDualVideo = () => {
        performanceDowngrades++;
        console.log(`[DUAL VIDEO] Performance downgrade #${performanceDowngrades}`);
        
        // Current state: dual 1080p
        if (performanceDowngrades === 1 && currentVideoMode === 'dual' && currentBgVariant === 0) {
          console.log('[DUAL VIDEO] 1080p dual → 1080p single');
          if (dualVideoSystem) {
            dualVideoSystem.destroy();
            dualVideoSystem = null;
          }
          initializeSingleVideo();
          
        // Current state: single 1080p
        } else if (performanceDowngrades === 2 && currentVideoMode === 'single' && currentBgVariant === 0) {
          console.log('[DUAL VIDEO] 1080p single → 720p dual');
          setBgVideoVariant(1, "performance-dual");
          setTimeout(() => initializeDualVideo(), 500);
          
        // Current state: dual 720p
        } else if (performanceDowngrades === 3 && currentVideoMode === 'dual' && currentBgVariant === 1) {
          console.log('[DUAL VIDEO] 720p dual → 720p single');
          if (dualVideoSystem) {
            dualVideoSystem.destroy();
            dualVideoSystem = null;
          }
          initializeSingleVideo();
          
        // Current state: single 720p
        } else if (performanceDowngrades === 4 && currentVideoMode === 'single' && currentBgVariant === 1) {
          console.log('[DUAL VIDEO] 720p single → 480p dual');
          setBgVideoVariant(2, "performance-dual");
          setTimeout(() => initializeDualVideo(), 500);
          
        // Current state: dual 480p
        } else if (performanceDowngrades === 5 && currentVideoMode === 'dual' && currentBgVariant === 2) {
          console.log('[DUAL VIDEO] 480p dual → 480p single');
          if (dualVideoSystem) {
            dualVideoSystem.destroy();
            dualVideoSystem = null;
          }
          initializeSingleVideo();
          
        } else {
          console.log('[DUAL VIDEO] No valid downgrade path or already at minimum');
        }
      };
      
      // Initialize dual video system
      function initializeDualVideo() {
        if (dualVideoSystem) {
          dualVideoSystem.destroy();
        }
        
        const qualityName = videoVariants[currentBgVariant].src;
        dualVideoSystem = new DualVideoSystem(bg, qualityName);
        currentVideoMode = 'dual';
        
        console.log(`[DUAL VIDEO] Initialized dual video system with ${qualityName}`);
      }
      
      // Initialize single video system
      function initializeSingleVideo() {
        if (dualVideoSystem) {
          dualVideoSystem.destroy();
          dualVideoSystem = null;
        }
        
        currentVideoMode = 'single';
        console.log(`[DUAL VIDEO] Using single video mode with ${videoVariants[currentBgVariant].src}`);
        
        // Standard single video setup
        bg.loop = true;
        
        // Enhanced metadata setup
        bg.addEventListener("loadedmetadata", () => {
          try {
            bg.removeAttribute("poster");
            bg.poster = "";
            bg.preload = "auto";
            bg.loop = true;
          } catch (e) {
            console.error("[VIDEO] Metadata setup error:", e);
          }
        });
        
        // Enhanced seeking/seeked handlers
        bg.addEventListener("timeupdate", () => {
          if (bg.duration > 0) {
            const timeRemaining = bg.duration - bg.currentTime;
            
            // Pure visual effect - no currentTime manipulation
            if (timeRemaining <= 0.08 && timeRemaining > 0.02) {
              bg.style.transition = "filter 0.06s ease-out";
              bg.style.filter = "blur(0.8px) brightness(0.96) contrast(1.02)";
              
              setTimeout(() => {
                bg.style.filter = "none";
                setTimeout(() => {
                  bg.style.transition = "";
                }, 70);
              }, 60);
            }
          }
        });

        // Simple backup handlers - minimal intervention
        bg.addEventListener("ended", () => {
          if (!loopResetInProgress && bg.loop) {
            loopResetInProgress = true;
            console.log("[SINGLE VIDEO] Simple ended handler reset");
            bg.currentTime = 0;
            bg.play().catch(() => {});
            setTimeout(() => { loopResetInProgress = false; }, 100);
          }
        });

        // Basic loadstart attributes
        bg.addEventListener("loadstart", () => {
          try {
            bg.preload = "auto";
            bg.playsInline = true;
          } catch (e) {}
        });
      }
      
      // Override setBgVideoVariant to handle dual video
      const originalSetBgVideoVariant = window.setBgVideoVariant;
      window.setBgVideoVariant = (idx, reason) => {
        const prevVariant = currentBgVariant;
        
        // Call original function
        originalSetBgVideoVariant(idx, reason);
        
        // Update dual video system if active
        if (dualVideoSystem && dualVideoSystem.isActive) {
          const newSrc = videoVariants[idx].src;
          dualVideoSystem.updateSources(newSrc);
          console.log(`[DUAL VIDEO] Updated sources from ${videoVariants[prevVariant]?.src} to ${newSrc} (${reason})`);
        }
      };
      
      // Detect if machine can handle dual video (high-end check)
      function canHandleDualVideo() {
        const deviceMemory = navigator.deviceMemory || 4;
        const hardwareConcurrency = navigator.hardwareConcurrency || 4;
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const effectiveType = conn?.effectiveType || '4g';
        
        // High-end device indicators
        const hasGoodMemory = deviceMemory >= 4;
        const hasGoodCPU = hardwareConcurrency >= 4;
        const hasGoodConnection = effectiveType === '4g' || !effectiveType.includes('g');
        
        const score = [hasGoodMemory, hasGoodCPU, hasGoodConnection].filter(Boolean).length;
        
        console.log(`[DUAL VIDEO] Device capability check: Memory: ${deviceMemory}GB, CPU: ${hardwareConcurrency} cores, Connection: ${effectiveType}, Score: ${score}/3`);
        
        return score >= 2; // Need at least 2/3 indicators
      }
      function initializeVideoSystem() {
        const initSystem = () => {
          if (canHandleDualVideo() && currentBgVariant <= 1) {
            initializeDualVideo();
          } else {
            console.log('[DUAL VIDEO] Lower-end device detected, starting with single video');
            initializeSingleVideo();
          }
          setTimeout(startDualVideoPerformanceMonitor, 3000);
        };
        if (bg.readyState >= 2) {
          initSystem();
        } else {
          bg.addEventListener("loadeddata", initSystem, { once: true });
        }
      }
      setTimeout(initializeVideoSystem, 1000);
    }
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