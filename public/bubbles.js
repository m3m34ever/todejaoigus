let adminMode = false;
let ships = [];
let circleShips = [];
let messages = [];
let circleOverlayEl = null;
let _savedInputDisplay = null;
let zResizeMode = false;

let circleState = {
  sizeVmin: 100,    // initial circle size in vmin (matches CSS)
  left: null,      // px from left of viewport
  top: null,       // px from top of viewport
  skewX: 0,        // deg
  skewY: 0         // deg
};

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

// ...existing code...

// in updateCircleStyles(), after applying styles add persistence:
  // apply dimensions and position
  circle.style.width = `${circleState.sizeVmin}vmin`;
  circle.style.height = `${circleState.sizeVmin}vmin`;
  circle.style.left = `${Math.round(circleState.left)}px`;
  circle.style.top = `${Math.round(circleState.top)}px`;
  // apply skew transform (keep center)
  circle.style.transform = `skew(${circleState.skewX}deg, ${circleState.skewY}deg)`;

  // persist circle state
  try {
    localStorage.setItem("circleState", JSON.stringify({
      sizeVmin: circleState.sizeVmin,
      left: Math.round(circleState.left),
      top: Math.round(circleState.top),
      skewX: circleState.skewX,
      skewY: circleState.skewY
    }));
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
  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!adminMode) return; // only allow if admin

    const confirmDelete = confirm("Delete this ship from view?");
    if (confirmDelete) {
      div.remove(); // remove from DOM
      ships = ships.filter(s => s !== div);
      circleShips = circleShips.filter(s => s !== div);
    }
  });

  // Random initial position
  const containerRect = (container === document.body) 
    ? { width: window.innerWidth, height: window.innerHeight } 
    : container.getBoundingClientRect();
  div.x = Math.random() * Math.max(1, containerRect.width - 100);
  div.y = Math.random() * Math.max(1, containerRect.height - 100);
  div.style.position = "absolute";
  if (container === document.body) {
    div.style.left = div.x + "px";
    div.style.top = div.y + "px";
  } else {
  // For circle container, ensure container is positioned
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    div.style.left = div.x + "px";
    div.style.top = div.y + "px";
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
  // apply initial styles
  if (typeof updateCircleStyles === "function") updateCircleStyles();

  overlay.appendChild(circle);

  const bgVideo = document.getElementById("bgVideo");
  if (bgVideo) {
    const videoVariants = [
      { src: "background.mp4", width: 1920 },      // high quality (index 0)
      { src: "background-720.mp4", width: 1280 },   // fallback (index 1)
      { src: "background-480.mp4",  width: 854  }
  ];

  // choose initial variant based on connection / device hints
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

  let currentVariant = chooseInitialVariantIndex();
  let switchedDueToChoppy = false;

  function setVideoVariant(idx) {
    if (!bgVideo) return;
    idx = Math.max(0, Math.min(videoVariants.length - 1, idx));
    if (currentVariant === idx) return;
    currentVariant = idx;
    const prevPaused = bgVideo.paused;
    try {
      bgVideo.pause();
      bgVideo.src = videoVariants[idx].src;
      bgVideo.load();
      // small delay then attempt play (user gesture restrictions apply)
      setTimeout(() => bgVideo.play().catch(()=>{}), 50);
      if (prevPaused) bgVideo.pause(); // respect previous paused state
    } catch (e) {
      console.error("Failed to switch video variant:", e);
    }
  }

  // initialize src if multiple variants present (pick initial)
  if (videoVariants && videoVariants.length > 0 && bgVideo) {
    bgVideo.src = videoVariants[currentVariant].src;
  }

  // Monitor playback quality and switch down once if choppy.
  (function startVideoQualityMonitor(){
  if (!bgVideo) return;
  const intervalMs = 3000;
  const lowFpsThreshold = 20; // adjust to taste
  let switched = false;

  // Primary: use getVideoPlaybackQuality if available (gives decoded/dropped frames)
  if (typeof bgVideo.getVideoPlaybackQuality === "function") {
    let lastTotal = 0;
    let lastDropped = 0;
    setInterval(() => {
      try {
        const q = bgVideo.getVideoPlaybackQuality();
        const total = q.totalVideoFrames || 0;
        const dropped = q.droppedVideoFrames || 0;
        const totalDelta = total - lastTotal;
        const droppedDelta = dropped - lastDropped;
        lastTotal = total; lastDropped = dropped;
        if (totalDelta > 0) {
          const fps = totalDelta / (intervalMs/1000);
          const dropRatio = droppedDelta / Math.max(1, totalDelta);
          if ((fps < lowFpsThreshold || dropRatio > 0.12) && !switched && currentVariant < videoVariants.length - 1) {
            switched = true;
            setVideoVariant(currentVariant + 1);
          }
        }
      } catch (e) { /* ignore */ }
    }, intervalMs);
    return;
  }

  // Secondary: requestVideoFrameCallback — compute FPS from timestamps
  if (typeof bgVideo.requestVideoFrameCallback === "function") {
    let frameCount = 0;
    let firstTs = null;
    function frameCb(now, meta) {
      frameCount++;
      if (!firstTs) firstTs = now;
      const elapsed = now - firstTs;
      if (elapsed >= intervalMs) {
        const fps = frameCount / (elapsed/1000);
        frameCount = 0; firstTs = null;
        if (fps < lowFpsThreshold && !switched && currentVariant < videoVariants.length - 1) {
          switched = true;
          setVideoVariant(currentVariant + 1);
        }
      }
      try { bgVideo.requestVideoFrameCallback(frameCb); } catch(e){ /* ignore */ }
    }
    try { bgVideo.requestVideoFrameCallback(frameCb); } catch(e){}
    return;
  }

  // Tertiary: webkitDecodedFrameCount fallback
  if ('webkitDecodedFrameCount' in bgVideo) {
    let last = bgVideo.webkitDecodedFrameCount || 0;
    setInterval(() => {
      try {
        const curr = bgVideo.webkitDecodedFrameCount || 0;
        const delta = curr - last;
        last = curr;
        const fps = delta / (intervalMs/1000);
        if (fps < lowFpsThreshold && !switched && currentVariant < videoVariants.length - 1) {
          switched = true;
          setVideoVariant(currentVariant + 1);
        }
      } catch(e){}
    }, intervalMs);
    return;
  }

  // Final fallback: rAF heuristic
  let rafCount = 0;
  let lastTime = bgVideo.currentTime || 0;
  function rafLoop() {
    rafCount++;
    const nowTime = bgVideo.currentTime || 0;
    const dt = nowTime - lastTime;
    if (dt >= 1.0) {
      const fps = rafCount / dt;
      rafCount = 0;
      lastTime = nowTime;
      if (fps < lowFpsThreshold && !switched && currentVariant < videoVariants.length - 1) {
        switched = true;
        setVideoVariant(currentVariant + 1);
      }
    }
    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);
  })();

  // Expose a debug function to force variant in console
  window.__setBackgroundVariant = (i) => { setVideoVariant(i); };
  }
  if (bgVideo && bgVideo instanceof HTMLVideoElement) {
    const v = document.createElement("video");
    try { v.src = bgVideo.currentSrc || (bgVideo.querySelector && bgVideo.querySelector('source')?.src) || ""; } catch (e) { v.src = ""; }
    v.autoplay = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.style.width = "100%";
    v.style.height = "100%";
    v.style.objectFit = "cover";
    circle.appendChild(v);
    v.play().catch(()=>{});
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
    const rect = circle.getBoundingClientRect();
    for (const s of circleShips) {
      if (!s) continue;
      // clamp by rect, keep a margin equal to element size
      const elW = s.offsetWidth || 40;
      const elH = s.offsetHeight || 40;
      s.x = (typeof s.x === "number") ? s.x : Math.random() * Math.max(1, rect.width - elW);
      s.y = (typeof s.y === "number") ? s.y : Math.random() * Math.max(1, rect.height - elH);
      s.x = Math.max(0, Math.min(rect.width - elW, s.x));
      s.y = Math.max(0, Math.min(rect.height - elH, s.y));
      s.style.left = Math.round(s.x) + "px";
      s.style.top = Math.round(s.y) + "px";
    }
  } catch (e) { /* non-critical */ }
}

// ...existing code...
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

    // create clones inside circle (after circle has correct size)
    for (const m of messages) {
      createShip(m, circle);
    }

    // start animation loop for circleShips
    if (!window._circleAnimating) {
      window._circleAnimating = true;
      (function animateCircleShips(){
        const rect = circle.getBoundingClientRect();
        for (let div of circleShips) {
          if (typeof div.x !== "number") {
            div.x = Math.random() * Math.max(1, rect.width - 60);
            div.y = Math.random() * Math.max(1, rect.height - 60);
          }
          div.x += div.vx + Math.sin(Date.now()*0.001 + div.x) * 0.2;
          div.y += div.vy + Math.cos(Date.now()*0.001 + div.y) * 0.2;

          if (div.x < -80) div.x = rect.width;
          if (div.x > rect.width) div.x = -80;
          if (div.y < -80) div.y = rect.height;
          if (div.y > rect.height) div.y = -80;

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
  const socket = io();
  window.socket = socket;
  socket.on("connect", () => console.log("socket connected", socket.id));
  socket.on("connect_error", (err) => console.error("socket connect_error", err));
  socket.on("disconnect", (reason) => console.log("socket disconnected", reason));
  const textInput = document.getElementById("textInput");
  const checkbox = document.getElementById("feedbackCheckbox");
  const emailInput = document.getElementById("emailInput");

  

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
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (v && emailPattern.test(v)) {
        email = v;
      } else {
        email = null;
      }
    }
    if(text){
      const payload = { text };
      if (email) payload.email = email; // only include email if valid
      console.log("client emit newText ->", payload);
      socket.emit("newText", payload);
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