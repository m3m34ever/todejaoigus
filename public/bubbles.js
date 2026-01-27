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

const preloadedVideoBlobs = new Map();
let preloadingComplete = false;

let soundAudio = null;
let soundBlobUrl = null;
let soundPreloaded = false;
let soundAdminEnabled = false;
let streamingAudio = null;
let soundSwitching = false;

async function preloadSoundFully() {
  if (soundPreloaded) return;
  try {
    const resp = await fetch("/heli.mp3", { cache: 'force-cache' }).catch(() => null);
  if (resp && resp.ok) {
    const blob = await resp.blob();
    soundBlobUrl = URL.createObjectURL(blob);
    soundAudio = new Audio(soundBlobUrl);
  } else {
    soundAudio = new Audio("/heli.mp3");
  }
  soundAudio.preload = 'auto';
  soundAudio.loop = true;
  soundAudio.volume = 1.0;
  try { soundAudio.pause(); } catch (e) {}
    soundPreloaded = true;
    console.log("[SOUND PRELOAD] Sound preloaded and ready.");
  } catch (e) {
    console.error("[SOUND PRELOAD] Error preloading sound:", e);
    try {
      soundAudio = new Audio("/heli.mp3");
      soundAudio.loop = true;
      soundPreloaded = true;
    } catch (e2) { /* ignore */ }
  }
}
let _audioContext = null;
let _soundEnableBtn = null;

async function ensureAudioContextResumed() {
  try {
    if (!_audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) _audioContext = new AudioCtx();
    }
    if (_audioContext && _audioContext.state === 'suspended') {
      await _audioContext.resume();
    }
  } catch (e) {
    // ignore
  }
}

function playSound(force = false) {
  if (!soundPreloaded) preloadSoundFully().catch(() => {});
  if (!soundAudio) return;
  try {
    soundAudio.muted = false;
    soundAudio.loop = true;
    soundAudio.play().catch((err) => {
      console.error("[SOUND PLAY] Play rejected", err);
    });
  } catch (e) {
    console.error("[SOUND PLAY] Exception playing sound:", e);
  }
}

function showSoundEnableHint(container = document.body) {
  if (_soundEnableBtn) return;
  const btn = document.createElement('button');
  btn.id = 'sound-enable-btn';
  btn.innerText = 'Enable sound';
  btn.style.position = 'fixed';
  btn.style.bottom = '20px';
  btn.style.left = '50%';
  btn.style.transform = 'translateX(-50%)';
  btn.style.zIndex = 13000;
  btn.style.padding = '8px 12px';
  btn.style.borderRadius = '6px';
  btn.style.background = 'rgba(0,0,0,0.7)';
  btn.style.color = '#fff';
  btn.style.border = '1px solid rgba(255,255,255,0.08)';
  btn.style.cursor = 'pointer';
  btn.onclick = async () => {
    try {
      await ensureAudioContextResumed();
      if (streamingAudio) {
        await streamingAudio.play().catch(()=>{});
      }
      if (soundAudio && soundPreloaded) {
        await soundAudio.play().catch(()=>{});
      }
      // remove button on success
      try { btn.remove(); } catch (_) {}
      _soundEnableBtn = null;
    } catch (e) {
      console.warn('[SOUND] enable gesture failed', e);
    }
  };
  document.body.appendChild(btn);
  _soundEnableBtn = btn;
}

async function startSoundStreamIfNeeded(force = false) {
  if (!adminMode && !(circleOverlayEl && circleOverlayEl.classList.contains("active")) && !force) return;
  if (soundPreloaded && soundAudio) {
    try { playSound(); } catch (e) {}
    return;
  }
  
  if (streamingAudio || soundSwitching) {
    try { streamingAudio && streamingAudio.play().catch(()=>{}); } catch(e){}
    return;
  }

  try {
    // create streamingAudio but DO NOT fetch blob until needed (Audio() will stream)
    streamingAudio = new Audio("/heli.mp3");
    streamingAudio.preload = 'auto';
    streamingAudio.loop = true;
    streamingAudio.muted = false;
    streamingAudio.volume = 1.0;

    // try to resume audio context first (improves chance)
    await ensureAudioContextResumed();

    // attempt to play immediately
    await streamingAudio.play().catch(err => {
      console.warn("[SOUND STREAM] Play rejected", err);
      // show an enable hint when autoplay is blocked
      if (circleOverlayEl && circleOverlayEl.classList.contains("active")) {
        showSoundEnableHint(circleOverlayEl);
      } else {
        showSoundEnableHint();
      }
    });

    console.log("[SOUND STREAM] Started streaming audio fallback (or pending user gesture).");
  } catch (e) {
    console.error("[SOUND STREAM] Exception starting streaming audio:", e);
    streamingAudio = null;
  }

  // continue with preload+swap flow as before
  try {
    await preloadSoundFully();
    if (soundBlobUrl && streamingAudio) {
      soundSwitching = true;
      try {
        const currentTime = Math.max(0, streamingAudio.currentTime || 0);
        if (!soundAudio || soundAudio.src !== soundBlobUrl) {
          if (soundAudio) { try { soundAudio.pause(); } catch(e){}; soundAudio.src = soundBlobUrl; }
          else soundAudio = new Audio(soundBlobUrl);
          soundAudio.loop = true;
          soundAudio.preload = "auto";
          soundAudio.volume = streamingAudio.volume || 1.0;
        }
        try { soundAudio.currentTime = Math.min(currentTime, (soundAudio.duration || Infinity)); } catch (e) {}
        await ensureAudioContextResumed();
        await soundAudio.play().catch((err)=>{ console.warn('[SOUNDSTREAM] blob play rejected:', err); });
        try { streamingAudio.pause(); streamingAudio.src = ""; } catch (e) {}
        streamingAudio = null;
        try { if (_soundEnableBtn) { _soundEnableBtn.remove(); _soundEnableBtn = null; } } catch(_) {}
        console.log("[SOUNDSTREAM] Switched from network stream to preloaded blob audio");
      } finally {
        soundSwitching = false;
      }
    } else if (soundPreloaded && soundAudio) {
      try { await ensureAudioContextResumed(); playSound(); } catch (e) {}
    }
  } catch (e) {
    console.error("[SOUNDSTREAM] Preload+switch failed:", e);
  }
}



function stopSoundAll() {
  try {
    if (streamingAudio) {
      try { streamingAudio.pause(); streamingAudio.src = ""; } catch (e) {}
      streamingAudio = null;
    }
  } catch (e) {}
  try {
    if (soundAudio) {
      try { soundAudio.pause(); soundAudio.currentTime = 0; } catch (e) {}
    }
  } catch (e) {}
}

window.addEventListener("beforeunload", () => {
  try {
    if (soundBlobUrl && soundBlobUrl.startsWith("blob:")) {
      URL.revokeObjectURL(soundBlobUrl);
      soundBlobUrl = null;
    }
    if (soundAudio) {
      soundAudio.pause();
      soundAudio.src = "";
      soundAudio = null;
    }
  } catch (e) { /* ignore */ }
});

async function preloadVideoFully(src) {
  if (preloadedVideoBlobs.has(src)) {
    console.log(`[VIDEO PRELOAD] Already preloaded: ${src}`);
    return preloadedVideoBlobs.get(src);
  }

  // Detect iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  console.log(`[VIDEO PRELOAD] Preloading video: ${src}`);
  try {
    // Use lower priority fetch to not compete with streaming video
    const fetchOptions = {
      cache: 'force-cache'
    };
    
    // Only add priority hint if supported (not on older iOS)
    if (!isIOS) {
      fetchOptions.priority = 'low';
    }
    
    const response = await fetch(src, fetchOptions);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${src}: ${response.status}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    preloadedVideoBlobs.set(src, blobUrl);
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
    console.log(`[VIDEO PRELOAD] Preloaded ${src} (${sizeMB} MB)`);
    return blobUrl;
  } catch (e) {
    console.error(`[VIDEO PRELOAD] Error preloading ${src}:`, e);
    return null;
  }
}

// Preload all video variants into memory
async function preloadAllVideos() {
  console.log('[PRELOAD] Starting sequential video preload...');
  
  // Preload current variant first (highest priority)
  const currentSrc = videoVariants[currentBgVariant].src;
  await preloadVideoFully(currentSrc);
  
  // Then preload others sequentially (not in parallel) to avoid bandwidth competition
  for (const variant of videoVariants) {
    if (variant.src !== currentSrc) {
      await preloadVideoFully(variant.src);
      // Small delay between fetches to let streaming video breathe
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  preloadingComplete = true;
  console.log('[PRELOAD] All videos fully loaded into memory!');
}

// Get blob URL for a video source (returns original if not preloaded)
function getPreloadedVideoSrc(src) {
  return preloadedVideoBlobs.get(src) || src;
}

// Upgrade a playing video to use blob URL when available
function upgradeVideoToBlob(videoElement) {
  if (!videoElement || !videoElement.src) return;
  
  // Find original src from current video src
  let originalSrc = null;
  
  // Check if already using blob
  if (videoElement.src.startsWith('blob:')) {
    return; // Already using blob
  }
  
  // Find matching variant
  for (const variant of videoVariants) {
    if (videoElement.src.includes(variant.src) || videoElement.src.endsWith(variant.src)) {
      originalSrc = variant.src;
      break;
    }
  }
  
  if (!originalSrc) {
    // Try to extract filename from full URL
    try {
      const url = new URL(videoElement.src);
      originalSrc = url.pathname.split('/').pop();
    } catch (e) {
      return;
    }
  }
  
  const blobUrl = preloadedVideoBlobs.get(originalSrc);
  if (blobUrl && blobUrl !== videoElement.src) {
    const currentTime = videoElement.currentTime;
    const wasPaused = videoElement.paused;
    
    console.log(`[VIDEO UPGRADE] Upgrading ${originalSrc} to blob URL at ${currentTime.toFixed(2)}s`);
    
    videoElement.src = blobUrl;
    videoElement.currentTime = currentTime;
    
    if (!wasPaused) {
      videoElement.play().catch(() => {});
    }
  }
}

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
    const originalSrc = videoVariants[idx].src;
    const blobSrc = getPreloadedVideoSrc(originalSrc);
    bgVideo.src = blobSrc;
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
    console.log(`[VIDEO] Switched from ${videoVariants[prevVariant]?.src} to ${originalSrc} (${reason}) - using ${blobSrc.startsWith('blob:') ? 'preloaded blob' : 'network'}`);
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

  if (container !== document.body) {
    div.style.zIndex = "10";  // Ships above videos (which are at 0-1)
  }
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

let _originalVideoParent = null;
let _originalVideoNextSibling = null;
let _originalVideoStyles = null;
let _originalSecondaryVideoParent = null;
let _originalSecondaryVideoNextSibling = null;
let _originalSecondaryVideoStyles = null;

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
  if (circleState.left === null) {
    const moveStep = 24;
    const centerLeft = Math.round((window.innerWidth - sizePx) / 2);
    const centerTop = Math.round((window.innerHeight - sizePx) / 2);
    
    circleState.left = centerLeft - (moveStep * 2); // 2 presses left
    circleState.top = centerTop + moveStep;         // 1 press down
  } else if (circleState.top === null) {
    const moveStep = 24;
    const centerTop = Math.round((window.innerHeight - sizePx) / 2);
    circleState.top = centerTop + moveStep; // 1 press down
  }
  if (typeof updateCircleStyles === "function") updateCircleStyles();

  overlay.appendChild(circle);

  const videoContainer = document.createElement("div");
  videoContainer.id = "circleVideoContainer";
  videoContainer.style.width = "100%";
  videoContainer.style.height = "100%";
  videoContainer.style.position = "absolute";
  videoContainer.style.top = "0";
  videoContainer.style.left = "0";
  videoContainer.style.zIndex = "0"; // behind ships
  videoContainer.style.overflow = "hidden";
  circle.appendChild(videoContainer);


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
  const moveStep = 24;
  const centerLeft = Math.round((window.innerWidth - sizePx) / 2);
  const centerTop = Math.round((window.innerHeight - sizePx) / 2);

  circleState.left = centerLeft - (moveStep *2);
  circleState.top = centerTop + moveStep;
  updateCircleStyles();
}

async function toggleCircleMode(force) {
  const el = createCircleOverlay();
  const circle = el.querySelector(".circle");
  const isActive = el.classList.contains("active");
  const shouldActivate = (typeof force === "boolean") ? force : !isActive;
  const inputBox = document.getElementById("inputBox");
  const bgVideo = document.getElementById("bgVideo");
  const bgVideoSecondary = document.getElementById("bgVideoSecondary");

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

    try { startSoundStreamIfNeeded(); } catch (e) { console.warn('[SOUND] start request failed', e); }

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

    messages.forEach(m => {
      createShip(m, circle);
    });

    const videoContainer = circle.querySelector("#circleVideoContainer");

    if (bgVideo && videoContainer) {
      // Save original position info for restoration
      _originalVideoParent = bgVideo.parentNode;
      _originalVideoNextSibling = bgVideo.nextSibling;
      _originalVideoStyles = {
        position: bgVideo.style.position,
        inset: bgVideo.style.inset,
        top: bgVideo.style.top,
        left: bgVideo.style.left,
        width: bgVideo.style.width,
        height: bgVideo.style.height,
        objectFit: bgVideo.style.objectFit,
        zIndex: bgVideo.style.zIndex
      };
      
      // Restyle main video for circle display
      bgVideo.style.position = "absolute";
      bgVideo.style.inset = "0";
      bgVideo.style.top = "0";
      bgVideo.style.left = "0";
      bgVideo.style.width = "100%";
      bgVideo.style.height = "100%";
      bgVideo.style.objectFit = "cover";
      bgVideo.style.zIndex = "1";      
      
      videoContainer.appendChild(bgVideo);
      
      // Ensure video keeps playing
      if (bgVideo.paused) {
        bgVideo.play().catch(() => {});
      }
      
      console.log("[CIRCLE] Moved main video into circle");
    }
    
    // Move SECONDARY video into circle (if dual video system is active)
    if (bgVideoSecondary && videoContainer) {
      _originalSecondaryVideoParent = bgVideoSecondary.parentNode;
      _originalSecondaryVideoNextSibling = bgVideoSecondary.nextSibling;
      _originalSecondaryVideoStyles = {
        position: bgVideoSecondary.style.position,
        inset: bgVideoSecondary.style.inset,
        top: bgVideoSecondary.style.top,
        left: bgVideoSecondary.style.left,
        width: bgVideoSecondary.style.width,
        height: bgVideoSecondary.style.height,
        objectFit: bgVideoSecondary.style.objectFit,
        zIndex: bgVideoSecondary.style.zIndex
      };
      
      // Restyle secondary video for circle display
      bgVideoSecondary.style.position = "absolute";
      bgVideoSecondary.style.inset = "0";
      bgVideoSecondary.style.top = "0";
      bgVideoSecondary.style.left = "0";
      bgVideoSecondary.style.width = "100%";
      bgVideoSecondary.style.height = "100%";
      bgVideoSecondary.style.objectFit = "cover";
      bgVideoSecondary.style.zIndex = "0";      

      videoContainer.appendChild(bgVideoSecondary);
      
      console.log("[CIRCLE] Moved secondary video into circle - dual video system continues!");
    }

    // start animation loop for circleShips
    if (!window._circleAnimating) {
      window._circleAnimating = true;
      (function animateCircleShips(){
        const rect = circle.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const radius = Math.min(centerX, centerY) - 40;
        const shipSize = 150;
        const exitRadius = radius + shipSize;
        
        for (let div of circleShips) {
          if (typeof div.x !== "number" || typeof div.y !== "number") {
            const angle = Math.random() * 2 * Math.PI;
            const r = Math.random() * (radius - 30);
            div.x = centerX + Math.cos(angle) * r;
            div.y = centerY + Math.sin(angle) * r;
          }
          
          div.x += div.vx + Math.sin(Date.now()*0.001 + div.x) * 0.2;
          div.y += div.vy + Math.cos(Date.now()*0.001 + div.y) * 0.2;

          const dx = div.x - centerX;
          const dy = div.y - centerY;
          const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
          
          if (distanceFromCenter > exitRadius) {
            const exitAngle = Math.atan2(dy, dx);
            const entryAngle = exitAngle + Math.PI;
            const entryDistance = radius + (shipSize * 0.9);
            div.x = centerX + Math.cos(entryAngle) * entryDistance;
            div.y = centerY + Math.sin(entryAngle) * entryDistance;
          }

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

    try {
      if (!soundAdminEnabled) {
        stopSoundAll();
      } else {
        // if admin toggle left on, ensure preloaded blob plays (stop any streaming)
        if (streamingAudio) {
          try { streamingAudio.pause(); streamingAudio = null; } catch(e){}
        }
        if (soundPreloaded && soundAudio) {
          try { playSound(); } catch(e){}
        }
      }
    } catch (e) { console.warn('[SOUND] stop request failed', e); }
    if (bgVideo && _originalVideoParent) {
      // Restore original styles
      if (_originalVideoStyles) {
        bgVideo.style.position = _originalVideoStyles.position || "fixed";
        bgVideo.style.inset = _originalVideoStyles.inset || "0";
        bgVideo.style.top = _originalVideoStyles.top || "0";
        bgVideo.style.left = _originalVideoStyles.left || "0";
        bgVideo.style.width = _originalVideoStyles.width || "100vw";
        bgVideo.style.height = _originalVideoStyles.height || "100dvh";
        bgVideo.style.objectFit = _originalVideoStyles.objectFit || "cover";
        bgVideo.style.zIndex = _originalVideoStyles.zIndex || "0";
      } else {
        // Fallback to default styles
        bgVideo.style.position = "fixed";
        bgVideo.style.inset = "0";
        bgVideo.style.width = "100vw";
        bgVideo.style.height = "100dvh";
        bgVideo.style.objectFit = "cover";
        bgVideo.style.zIndex = "0";
      }
      
      if (_originalVideoNextSibling && _originalVideoNextSibling.parentNode === _originalVideoParent) {
        _originalVideoParent.insertBefore(bgVideo, _originalVideoNextSibling);
      } else {
        _originalVideoParent.appendChild(bgVideo);
      }
      
      // Ensure video keeps playing
      if (bgVideo.paused) {
        bgVideo.play().catch(() => {});
      }
      
      console.log("[CIRCLE] Moved background video back to original position");
      
      _originalVideoParent = null;
      _originalVideoNextSibling = null;
      _originalVideoStyles = null;
    }

    const bgVideoSecondaryNow = document.getElementById("bgVideoSecondary");
    if (bgVideoSecondaryNow && _originalSecondaryVideoParent) {
      // Restore original styles
      if (_originalSecondaryVideoStyles) {
        bgVideoSecondaryNow.style.position = _originalSecondaryVideoStyles.position || "fixed";
        bgVideoSecondaryNow.style.inset = _originalSecondaryVideoStyles.inset || "";
        bgVideoSecondaryNow.style.top = _originalSecondaryVideoStyles.top || "0";
        bgVideoSecondaryNow.style.left = _originalSecondaryVideoStyles.left || "0";
        bgVideoSecondaryNow.style.width = _originalSecondaryVideoStyles.width || "100vw";
        bgVideoSecondaryNow.style.height = _originalSecondaryVideoStyles.height || "100vh";
        bgVideoSecondaryNow.style.objectFit = _originalSecondaryVideoStyles.objectFit || "cover";
        bgVideoSecondaryNow.style.zIndex = _originalSecondaryVideoStyles.zIndex || "-1";
      } else {
        // Fallback to default styles
        bgVideoSecondaryNow.style.position = "fixed";
        bgVideoSecondaryNow.style.top = "0";
        bgVideoSecondaryNow.style.left = "0";
        bgVideoSecondaryNow.style.width = "100vw";
        bgVideoSecondaryNow.style.height = "100vh";
        bgVideoSecondaryNow.style.objectFit = "cover";
        bgVideoSecondaryNow.style.zIndex = "-1";
      }
      
      if (_originalSecondaryVideoNextSibling && _originalSecondaryVideoNextSibling.parentNode === _originalSecondaryVideoParent) {
        _originalSecondaryVideoParent.insertBefore(bgVideoSecondaryNow, _originalSecondaryVideoNextSibling);
      } else {
        _originalSecondaryVideoParent.appendChild(bgVideoSecondaryNow);
      }
      
      console.log("[CIRCLE] Moved secondary video back to original position");
      
      _originalSecondaryVideoParent = null;
      _originalSecondaryVideoNextSibling = null;
      _originalSecondaryVideoStyles = null;
    }

    // remove circle ships and stop animation
    for (const s of circleShips) if (s && s.remove) s.remove();
    circleShips = [];
    window._circleAnimating = false;

    // restore original ships and input UI
    for (const s of ships) s.style.display = "";
    if (inputBox) {
      inputBox.style.display = (_savedInputDisplay && _savedInputDisplay !== "none")
        ? _savedInputDisplay
        : "";
      _savedInputDisplay = null;
    } else {
      const t = document.getElementById("textInput");
      if (t) t.style.display = "";
    }
    
    const t2 = document.getElementById("textInput");
    if (t2) t2.style.display = "";
    disableCursorAutoHide();
    el.classList.remove("active");
  }
}

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
      reconnectionDelayMax: 30000,
      timeout: 30000,
      forceNew: forceNew,
      // additional resilience options
      upgrade: true,
      rememberUpgrade: false,
      transports: ['polling', 'websocket'],

      // render.com optimisations
      query: {
        t: Date.now(), // cache busting for server issues
        client: 'web'
      },

      // resilience for server restarts
      autoConnect: true,
      randomizationFactor: 0.5, // jitter to reconn attempts
    });
    
    window.socket = socket;
    setupSocketHandlers();
    return socket;
  }
  
  function setupSocketHandlers() {
    let serverDownStartTime = null;
    let lastSuccessfulConnection = Date.now();
    let heartbeatInterval = null;

    socket.on("connect", () => {
      console.log("socket connected", socket.id);
      
      if (serverDownStartTime) {
        const downDuration = Math.round((Date.now() - serverDownStartTime) / 1000);
        console.log(`[RECONNECT] Server back up after ${downDuration}s downtime`);
        serverDownStartTime = null;
      }
      
      if (wasConnected && reconnectAttempts > 0) {
        console.log(`[RECONNECT] Successfully reconnected after ${reconnectAttempts} attempts ${socket.io.opts.forceNew ? '(forced new connection)' : ''}`);
        reconnectAttempts = 0;
      } else if (!wasConnected) {
        console.log("[CONNECT] Initial connection established");
      }
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (socket.connected) {
          socket.emit('ping', Date.now());
        }
      }, 25000);
      
      lastSuccessfulConnection = Date.now();
      wasConnected = true;
    });

    socket.on("disconnect", (reason) => {
      console.log(`[DISCONNECT] Socket disconnected: ${reason}`);
      if (reason === "io server disconnect") {
        console.log("server intentionally disconnected - most probably restarting");
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    });

    socket.on("connect_error", (err) => {
      console.error("[CONNECT ERROR] Socket connect_error:", err);

      if (!serverDownStartTime) {
        serverDownStartTime = Date.now();
        console.log("[SERVER DOWN] Detected server outage, starting resilient reconnection");
      }

      if (err.message && err.message.includes("502")) {
        console.log("[RENDER 502] Server temporarily unavailable - this is normal for free tier");
      } else if (err.description && err.description.includes("502")) {
        console.log("[RENDER 502] Server returning 502 Bad Gateway - server restarting");
      }
    });

    socket.on("reconnect_attempt", (attemptNumber) => {
      reconnectAttempts = attemptNumber;
      console.log(`[RECONNECT] Attempt #${attemptNumber}`);
      const timeSinceLastSuccess = Date.now() - lastSuccessfulConnection;
      const minutesDown = Math.round(timeSinceLastSuccess / 60000);
      

      if (attemptNumber % 10 === 0) {
        console.log(`[RECONNECT] Extended outage: ${minutesDown}min down, attempt ${attemptNumber}`);
      }
      // Progressive escalation strategy
      if (attemptNumber === FORCE_NEW_THRESHOLD) {
        console.log(`[RECONNECT] ${FORCE_NEW_THRESHOLD} attempts failed - switching to forceNew: true`);
        createSocket(true); // Force new connection
        
      } else if (attemptNumber > 50 && attemptNumber % 20 === 0) {
        console.log(`[RECONNECT] Long outage detected (${minutesDown}min), trying cache-busting`);
        setTimeout(() => {
          createSocket(true);
        }, 5000);
      }
    });

    socket.on("reconnect", (attemptNumber) => {
      console.log(`[RECONNECT] Reconnected after ${attemptNumber} attempts`);
      reconnectAttempts = 0; // Reset counter on success
    });

    socket.on("reconnect_failed", () => {
      console.error("[RECONNECT] All reconnection attempts failed - this shouldn't happen with Infinity attempts");
    });

    socket.on("reconnect_error", (err) => {
      console.error(`[RECONNECT ERROR] Reconnection failed: ${err.message || err}`);
      
      // Detect common Render.com restart scenarios
      if (err.message && (err.message.includes("502") || err.message.includes("503") || err.message.includes("timeout"))) {
        console.log("[RENDER RESTART] Server appears to be restarting, will continue trying...");
      }
    });

    socket.on("error", (err) => {
      console.error(`[SOCKET ERROR] General socket error: ${err.message || err}`);
    });

    socket.on('pong', (timestamp) => {
      const latency = Date.now() - timestamp;
      console.log(`[HEARTBEAT] Pong received, latency: ${latency}ms`);
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
      }
      
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
    
    // Detect iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    // DELAY preloading more on iOS to let streaming video stabilize first
    const preloadDelay = isIOS ? 5000 : 3000;
    
    // preload videos first then set source
    if (!bg.src) {
      bg.src = videoVariants[currentBgVariant].src;
      console.log(`[VIDEO] Initial source set (streaming): ${videoVariants[currentBgVariant].src}`);
    }
    
    // Ensure video starts playing ASAP
    bg.preload = 'auto';
    bg.muted = true;
    bg.playsInline = true;
    bg.setAttribute('playsinline', ''); // for iOS
    bg.setAttribute('webkit-playsinline', ''); // for older iOS

    const tryPlayVideo = () => {
      if (bg.paused) {
        bg.play().catch(e => {
          console.log('[VIDEO] Autoplay attempt failed:', e);
        });
      }
    };

    tryPlayVideo();

    if (isIOS) {
      bg.addEventListener('canplaythrough', tryPlayVideo, { once: true });
      bg.addEventListener('loadeddata', tryPlayVideo, { once: true });
    }
    
    // Try to play immediately
    const playPromise = bg.play();
    if (playPromise) {
      playPromise.catch(e => {
        console.log('[VIDEO] Initial autoplay blocked, waiting for user gesture');
      });
    }
    
    setTimeout(() => {
      console.log('[PRELOAD] Starting background preload after video begins playing...');
      
      // On iOS, only preload current variant initially to reduce memory pressure
      if (isIOS) {
        preloadVideoFully(videoVariants[currentBgVariant].src).then(() => {
          upgradeVideoToBlob(bg);
          console.log('[VIDEO] Current video cached - iOS mode');
          
          // Preload others after a longer delay on iOS
          setTimeout(() => {
            preloadAllVideos().then(() => {
              const secondary = document.getElementById("bgVideoSecondary");
              if (secondary) {
                upgradeVideoToBlob(secondary);
              }
              console.log('[VIDEO] All videos cached - playback is now fully offline-capable');
            });
          }, 10000); // Wait 10 more seconds before loading other variants on iOS
        });
      } else {
        preloadAllVideos().then(() => {
          upgradeVideoToBlob(bg);
          
          const secondary = document.getElementById("bgVideoSecondary");
          if (secondary) {
            upgradeVideoToBlob(secondary);
          }
          
          console.log('[VIDEO] All videos cached - playback is now fully offline-capable');
        });
      }
    }, preloadDelay);
    
    let dualVideoSystem = null;
    let staticCanvas = null;
    let fallbackCache = null;

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
      
      // iOS-specific: ensure playsinline is set
      bg.playsInline = true;
      bg.setAttribute('playsinline', '');
      bg.setAttribute('webkit-playsinline', '');

      // Create canvas that's ALWAYS visible as background layer
      staticCanvas = document.createElement("canvas");
      staticCanvas.id = "safariStaticFallback";
      staticCanvas.style.position = "fixed";
      staticCanvas.style.top = "0";
      staticCanvas.style.left = "0";
      staticCanvas.style.width = "100vw";
      staticCanvas.style.height = "100vh";
      staticCanvas.style.objectFit = "cover";
      staticCanvas.style.zIndex = "-2";
      staticCanvas.style.display = "block";
      
      bg.parentNode.insertBefore(staticCanvas, bg);
      
      let safariResetInProgress = false;
      fallbackCache = new Map();
      let fallbackReady = false;
      
      // On iOS, load pre-generated fallback from server immediately
      if (isIOS) {
        console.log("[SAFARI iOS] Loading server-generated fallback image");
        
        // Get appropriate fallback based on screen width
        fetch(`/api/video-fallback?width=${window.innerWidth}`)
          .then(res => res.json())
          .then(data => {
            if (data.ok) {
              const fallbackImg = new Image();
              fallbackImg.onload = () => {
                staticCanvas.width = fallbackImg.naturalWidth;
                staticCanvas.height = fallbackImg.naturalHeight;
                const ctx = staticCanvas.getContext("2d");
                ctx.drawImage(fallbackImg, 0, 0);
                
                // Cache the image data
                const imageData = ctx.getImageData(0, 0, staticCanvas.width, staticCanvas.height);
                fallbackCache.set('server-generated', {
                  imageData: imageData,
                  width: staticCanvas.width,
                  height: staticCanvas.height
                });
                
                fallbackReady = true;
                console.log(`[SAFARI iOS] Server-generated fallback loaded: ${data.fallback}`);
              };
              fallbackImg.onerror = () => {
                console.error("[SAFARI iOS] Failed to load server fallback, using color");
                setFallbackColor();
              };
              fallbackImg.src = data.fallback;
            } else {
              console.error("[SAFARI iOS] No server fallback available, using color");
              setFallbackColor();
            }
          })
          .catch(e => {
            console.error("[SAFARI iOS] Error fetching fallback info:", e);
            setFallbackColor();
          });
        
        function setFallbackColor() {
          staticCanvas.width = window.innerWidth;
          staticCanvas.height = window.innerHeight;
          const ctx = staticCanvas.getContext("2d");
          ctx.fillStyle = "#313c34";
          ctx.fillRect(0, 0, staticCanvas.width, staticCanvas.height);
          fallbackReady = true;
        }
        
      } else {
        // macOS Safari - use dynamic generation (works fine)
        
        // Set initial background color
        const ctx = staticCanvas.getContext("2d");
        staticCanvas.width = window.innerWidth;
        staticCanvas.height = window.innerHeight;
        ctx.fillStyle = "#313c34";
        ctx.fillRect(0, 0, staticCanvas.width, staticCanvas.height);
        
        // IMMEDIATE fallback generation for macOS
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
              
              // Start progressive frame collection for enhanced fallback
              startProgressiveFrameCollection();
              
            } catch (e) {
              console.error("[SAFARI] Immediate fallback failed:", e);
              setTimeout(attemptGeneration, 1000);
            }
          };
          
          attemptGeneration();
        };
        
        // Progressive frame collection - captures frames during natural playback without seeking
        const collectedFrames = [];
        let frameCollectionComplete = false;
        
        const startProgressiveFrameCollection = () => {
          if (frameCollectionComplete) return;
          
          console.log("[SAFARI] Starting progressive frame collection (no seeking)");
          
          const targetFrameCount = 5;
          const videoDuration = bg.duration || 10;
          const frameInterval = videoDuration / targetFrameCount;
          let lastCaptureTime = -frameInterval;
          
          const captureFrame = () => {
            if (safariResetInProgress) return;
            if (frameCollectionComplete || !bg || bg.paused || bg.readyState < 2) {
              return;
            }
            
            const currentTime = bg.currentTime;
            
            if (currentTime - lastCaptureTime >= frameInterval || 
                (currentTime < lastCaptureTime && collectedFrames.length < targetFrameCount)) {
              
              try {
                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = bg.videoWidth;
                tempCanvas.height = bg.videoHeight;
                const tempCtx = tempCanvas.getContext("2d");
                tempCtx.drawImage(bg, 0, 0);
                
                const frameData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                collectedFrames.push({
                  time: currentTime,
                  data: frameData
                });
                
                lastCaptureTime = currentTime;
                tempCanvas.remove();
                
                console.log(`[SAFARI] Captured frame ${collectedFrames.length}/${targetFrameCount} at ${currentTime.toFixed(2)}s`);
                
                if (collectedFrames.length >= targetFrameCount) {
                  frameCollectionComplete = true;
                  createBlendedFallbackFromFrames();
                }
              } catch (e) {
                console.error("[SAFARI] Frame capture error:", e);
              }
            }
          };
          
          const frameCollectionHandler = () => {
            if (!frameCollectionComplete && !safariResetInProgress) {
              captureFrame();
            }
          };
          
          bg.addEventListener("timeupdate", frameCollectionHandler);
          
          setTimeout(() => {
            if (!frameCollectionComplete && collectedFrames.length >= 3) {
              console.log("[SAFARI] Frame collection timeout, using available frames");
              frameCollectionComplete = true;
              createBlendedFallbackFromFrames();
            }
            bg.removeEventListener("timeupdate", frameCollectionHandler);
          }, 30000);
        };
        
        const createBlendedFallbackFromFrames = () => {
          if (collectedFrames.length < 2) {
            console.log("[SAFARI] Not enough frames for blending, keeping simple fallback");
            return;
          }
          
          console.log(`[SAFARI] Creating blended fallback from ${collectedFrames.length} frames`);
          
          try {
            const ctx = staticCanvas.getContext("2d");
            const width = staticCanvas.width;
            const height = staticCanvas.height;
            const blendedData = ctx.createImageData(width, height);
            const blendedPixels = blendedData.data;
            
            const frameCount = collectedFrames.length;
            const weight = 1 / frameCount;
            
            for (let i = 0; i < blendedPixels.length; i += 4) {
              let totalR = 0, totalG = 0, totalB = 0, totalA = 0;
              
              for (const frame of collectedFrames) {
                totalR += frame.data.data[i] * weight;
                totalG += frame.data.data[i + 1] * weight;
                totalB += frame.data.data[i + 2] * weight;
                totalA += frame.data.data[i + 3] * weight;
              }
              
              blendedPixels[i] = Math.round(totalR);
              blendedPixels[i + 1] = Math.round(totalG);
              blendedPixels[i + 2] = Math.round(totalB);
              blendedPixels[i + 3] = Math.round(totalA);
            }
            
            ctx.putImageData(blendedData, 0, 0);
            
            fallbackCache.set(bg.src, {
              imageData: blendedData,
              width: staticCanvas.width,
              height: staticCanvas.height
            });
            
            collectedFrames.length = 0;
            
            console.log("[SAFARI] Blended fallback complete");
            
          } catch (e) {
            console.error("[SAFARI] Blended fallback creation failed:", e);
          }
        };
        
        bg.addEventListener("loadeddata", generateFallbackImmediately);
        bg.addEventListener("canplay", generateFallbackImmediately);
        generateFallbackImmediately();
      }
      
      // Safari reset handler - same for both iOS and macOS
      let videoLoopCount = 0;
      let initialStabilizationComplete = false;
      
      const stabilizationDelay = isIOS ? 2000 : 0;
      
      const enableResetHandler = () => {
        if (fallbackReady) {
          initialStabilizationComplete = true;
          console.log("[SAFARI] Initial stabilization complete, reset handler enabled");
        } else {
          console.log("[SAFARI] Waiting for fallback to be ready...");
          setTimeout(enableResetHandler, 500);
        }
      };
      
      setTimeout(enableResetHandler, stabilizationDelay);
      
      const safariResetHandler = () => {
        if (!initialStabilizationComplete) return;
        if (!fallbackReady) return;
        if (safariResetInProgress || bg.duration <= 0) return;
        
        const timeLeft = bg.duration - bg.currentTime;
        const resetThreshold = 0.15; // Tighter threshold - trigger closer to end
        
        if (timeLeft <= resetThreshold) {
          safariResetInProgress = true;
          videoLoopCount++;
          
          // Hide video - blended canvas shows underneath as seamless bridge
          bg.style.opacity = "0";
          bg.currentTime = 0;
          
          // Restore video as soon as it's ready to play
          const restoreVideo = () => {
            bg.style.opacity = "1";
            if (bg.paused) {
              bg.play().catch(() => {});
            }
            safariResetInProgress = false;
          };
          
          // Check if video is ready immediately
          if (bg.readyState >= 2) {
            // Video buffer is ready - restore immediately with minimal delay
            requestAnimationFrame(() => {
              restoreVideo();
            });
          } else {
            // Wait for video to be ready, but with a short timeout fallback
            const onCanPlay = () => {
              bg.removeEventListener('canplay', onCanPlay);
              clearTimeout(fallbackTimeout);
              restoreVideo();
            };
            
            bg.addEventListener('canplay', onCanPlay, { once: true });
            
            // Fallback timeout - restore after 50ms max even if not fully ready
            const fallbackTimeout = setTimeout(() => {
              bg.removeEventListener('canplay', onCanPlay);
              restoreVideo();
            }, 50);
          }
        }
      };
      
      bg.addEventListener("timeupdate", safariResetHandler);
      
      console.log("[SAFARI] Always-ready fallback initialized");
      
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
          const originalSrc = videoVariants[currentBgVariant].src;
          const srcToUse = getPreloadedVideoSrc(originalSrc);
          this.secondaryVideo.src = srcToUse;
          console.log(`[DUAL VIDEO] Secondary video source: ${srcToUse.startsWith('blob:') ? 'preloaded blob' : 'streaming'}`);
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

          if (!preloadingComplete) {
            const checkAndUpgrade = setInterval(() => {
              if (preloadingComplete) {
                clearInterval(checkAndUpgrade);
                upgradeVideoToBlob(this.mainVideo);
                upgradeVideoToBlob(this.secondaryVideo);
                console.log('[DUAL VIDEO] Upgraded both videos to blob URLs');
              }
            }, 1000);
          }
          
          this.setupEventListeners();
          this.isActive = true;
          
          console.log('[DUAL VIDEO] Blend mode secondary video created and positioned');
        }
        
        setupEventListeners() {
          // Main video timeupdate
          this.mainTimeUpdateHandler = () => {
            if (!this.isActive || this.switchInProgress) return;
            
            const timeLeft = this.mainVideo.duration - this.mainVideo.currentTime;
            
            if (timeLeft <= this.preloadBuffer && this.currentActive === 'main') {
              this.preloadSecondary();
            }
            
            if (timeLeft <= this.switchBuffer && this.currentActive === 'main') {
              this.switchToSecondary();
            }
          };
          
          this.secondaryTimeUpdateHandler = () => {
            if (!this.isActive || this.switchInProgress) return;
            
            const timeLeft = this.secondaryVideo.duration - this.secondaryVideo.currentTime;
            
            if (timeLeft <= this.preloadBuffer && this.currentActive === 'secondary') {
              this.preloadMain();
            }
            
            if (timeLeft <= this.switchBuffer && this.currentActive === 'secondary') {
              this.switchToMain();
            }
          };
          
          this.mainErrorHandler = (e) => {
            console.error('[DUAL VIDEO] Main video error:', e);
            this.handleError();
          };
          
          this.secondaryErrorHandler = (e) => {
            console.error('[DUAL VIDEO] Secondary video error:', e);
            this.handleError();
          };
          
          // Add all event listeners
          this.mainVideo.addEventListener('timeupdate', this.mainTimeUpdateHandler);
          this.mainVideo.addEventListener('error', this.mainErrorHandler);
          this.secondaryVideo.addEventListener('timeupdate', this.secondaryTimeUpdateHandler);
          this.secondaryVideo.addEventListener('error', this.secondaryErrorHandler);
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
          console.log('[DUAL VIDEO] Wave motion transition to secondary');
          
          if (this.secondaryVideo.readyState < 2) {
            console.warn('[DUAL VIDEO] Secondary not ready, forcing load');
            this.secondaryVideo.load();
          }
          
          // Determine if we're in circle mode (use positive z-indices, but keep them low)
          const inCircle = this.mainVideo.closest('#circleVideoContainer') !== null;
          const zBack = inCircle ? '0' : '-2';
          const zFront = inCircle ? '1' : '-1';
          
          // Start secondary video from beginning
          this.secondaryVideo.currentTime = 0;
          this.secondaryVideo.play().then(() => {
            
            // MOTION-PRESERVING TRANSITION - secondary plays underneath
            
            // Step 1: Secondary starts playing at full opacity underneath
            this.secondaryVideo.style.mixBlendMode = 'normal';
            this.secondaryVideo.style.opacity = '1';
            this.secondaryVideo.style.zIndex = zBack; // Behind main video
            
            // Step 2: Main video stays on top but gradually becomes transparent
            this.mainVideo.style.zIndex = zFront; // On top of secondary
            
            // Step 3: Quick fade out of main video (secondary waves visible underneath)
            let progress = 0;
            const steps = 6; // Fast transition to minimize any blending artifacts
            
            const motionStep = () => {
              progress++;
              const ratio = progress / steps;
              
              // Main video fades out, revealing secondary waves underneath
              this.mainVideo.style.opacity = (1 - ratio).toString();
              // Secondary stays at full opacity, providing continuous wave motion
              
              if (progress < steps) {
                requestAnimationFrame(motionStep);
              } else {
                // Transition complete - secondary is now the main visible video
                this.mainVideo.style.opacity = '0';
                this.mainVideo.pause();
                
                // Reset z-indices for next transition
                this.secondaryVideo.style.zIndex = zFront;
                
                this.currentActive = 'secondary';
                this.switchInProgress = false;
                console.log('[DUAL VIDEO] Wave motion transition complete');
              }
            };
            
            requestAnimationFrame(motionStep);
            
          }).catch(e => {
            console.error('[DUAL VIDEO] Failed to start secondary video:', e);
            this.switchInProgress = false;
            this.handleError();
          });
        }

        switchToMain() {
          if (this.switchInProgress || this.currentActive === 'main') return;
          
          this.switchInProgress = true;
          console.log('[DUAL VIDEO] Wave motion transition to main');
          
          // Determine if we're in circle mode (use positive z-indices, but keep them low)
          const inCircle = this.mainVideo.closest('#circleVideoContainer') !== null;
          const zBack = inCircle ? '0' : '-2';
          const zFront = inCircle ? '1' : '-1';
          
          // Start main video from beginning
          this.mainVideo.currentTime = 0;
          this.mainVideo.play().then(() => {
            
            // MOTION-PRESERVING TRANSITION - main plays underneath
            
            // Step 1: Main starts playing at full opacity underneath
            this.mainVideo.style.mixBlendMode = 'normal';
            this.mainVideo.style.opacity = '1';
            this.mainVideo.style.zIndex = zBack; // Behind secondary video
            
            // Step 2: Secondary video stays on top but gradually becomes transparent
            this.secondaryVideo.style.zIndex = zFront; // On top of main
            
            // Step 3: Quick fade out of secondary video (main waves visible underneath)
            let progress = 0;
            const steps = 6; // Fast transition
            
            const motionStep = () => {
              progress++;
              const ratio = progress / steps;
              
              // Secondary video fades out, revealing main waves underneath
              this.secondaryVideo.style.opacity = (1 - ratio).toString();
              // Main stays at full opacity, providing continuous wave motion
              
              if (progress < steps) {
                requestAnimationFrame(motionStep);
              } else {
                // Transition complete - main is now the main visible video
                this.secondaryVideo.style.opacity = '0';
                this.secondaryVideo.pause();
                
                // Reset z-indices for next transition
                this.mainVideo.style.zIndex = zFront;
                
                this.currentActive = 'main';
                this.switchInProgress = false;
                console.log('[DUAL VIDEO] Wave motion transition complete');
              }
            };
            
            requestAnimationFrame(motionStep);
            
          }).catch(e => {
            console.error('[DUAL VIDEO] Failed to start main video:', e);
            this.switchInProgress = false;
            this.handleError();
          });
        }
        
        updateSources(newSrc) {
          console.log(`[DUAL VIDEO] Updating blend-mode sources to ${newSrc}`);
          
          const wasPlaying = !this.mainVideo.paused || !this.secondaryVideo.paused;
          const blobSrc = getPreloadedVideoSrc(newSrc);

          // Update both video sources
          this.mainVideo.src = blobSrc;
          this.secondaryVideo.src = blobSrc;
          
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
          console.log(`[DUAL VIDEO] Sources updated to ${blobSrc.startsWith('blob:') ? 'preloaded blob' : 'network'}`);

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
          this.switchInProgress = false;
          
          // Remove all event listeners
          if (this.mainVideo && this.mainTimeUpdateHandler) {
            this.mainVideo.removeEventListener('timeupdate', this.mainTimeUpdateHandler);
            this.mainVideo.removeEventListener('error', this.mainErrorHandler);
          }
          
          if (this.secondaryVideo && this.secondaryTimeUpdateHandler) {
            this.secondaryVideo.removeEventListener('timeupdate', this.secondaryTimeUpdateHandler);
            this.secondaryVideo.removeEventListener('error', this.secondaryErrorHandler);
            
            // Force cleanup
            this.secondaryVideo.pause();
            this.secondaryVideo.src = '';
            this.secondaryVideo.load();
            
            if (this.secondaryVideo.parentNode) {
              this.secondaryVideo.parentNode.removeChild(this.secondaryVideo);
            }
          }
          
          // Restore main video
          if (this.mainVideo) {
            this.mainVideo.style.opacity = '1';
            this.mainVideo.style.transition = '';
            this.mainVideo.style.mixBlendMode = 'normal';
            this.mainVideo.style.zIndex = '';
            this.mainVideo.loop = true;
          }
          
          // Clear references
          this.mainTimeUpdateHandler = null;
          this.secondaryTimeUpdateHandler = null;
          this.mainErrorHandler = null;
          this.secondaryErrorHandler = null;
          this.secondaryVideo = null;
          this.mainVideo = null;
          
          currentVideoMode = 'single';
          
          console.log('[DUAL VIDEO] Cleanup complete');
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
        const maxSamples = 10; // limit sample history to prevent mem buildup
        const minSamplesBeforeDowngrade = 5;
        let monitorStarted = false;
        
        const monitorInterval = setInterval(() => {
          if (!bg || !bg.parentNode || bg.paused || bg.ended) {
            console.log("[DUAL VIDEO] Background video not active, skipping performance check");
            clearInterval(monitorInterval);
            if (window._performanceMonitorInterval === monitorInterval) {
              window._performanceMonitorInterval = null;
            }
            return;
          }
          if (!monitorStarted && bg.readyState >= 2) monitorStarted = true;
          if (!monitorStarted) return;
          
          try {
            const q = bg.getVideoPlaybackQuality();
            const total = q.totalVideoFrames || 0;
            const dropped = q.droppedVideoFrames || 0;
            const totalDelta = total - lastTotal;
            const droppedDelta = dropped - lastDropped;
            lastTotal = total; 
            lastDropped = dropped;
            
            if (totalDelta > 0) {
              const fps = totalDelta / 3;
              const dropRatio = droppedDelta / Math.max(1, totalDelta);
              
              samples.push({ fps, dropRatio });
              
              console.log(`[DUAL VIDEO] FPS: ${fps.toFixed(1)}, Drop ratio: ${(dropRatio*100).toFixed(1)}%, Mode: ${currentVideoMode}, Samples: ${samples.length}/${minSamplesBeforeDowngrade}`);
              
              // Limit samples array size to prevent memory growth
              if (samples.length > maxSamples) {
                samples = samples.slice(-maxSamples);
              }

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

        // store interval reference for cleanup
        window._performanceMonitorInterval = monitorInterval;
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

    setInterval(() => {
      // Try to keep main video playing
      const bgVideo = document.getElementById("bgVideo");
      if (bgVideo && bgVideo.paused && !bgVideo.ended) {
        bgVideo.play().catch(e => {
          // Silently fail if browser blocks background playback
        });
      }
      
      // Try to keep secondary video playing (if dual video system is active)
      const bgVideoSecondary = document.getElementById("bgVideoSecondary");
      if (bgVideoSecondary && bgVideoSecondary.paused && !bgVideoSecondary.ended) {
        bgVideoSecondary.play().catch(e => {
          // Silently fail if browser blocks background playback
        });
      }
    }, 1000);  // Check every 1 second

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        console.log('[VISIBILITY] Tab visible - resuming videos');
        
        // Resume main video
        const bgVideo = document.getElementById("bgVideo");
        if (bgVideo && bgVideo.paused) {
          bgVideo.play().catch(e => console.warn('[VISIBILITY] Error resuming main video:', e));
        }
        
        // Resume secondary video if dual video system is active
        const bgVideoSecondary = document.getElementById("bgVideoSecondary");
        if (bgVideoSecondary && bgVideoSecondary.paused) {
          bgVideoSecondary.play().catch(e => console.warn('[VISIBILITY] Error resuming secondary video:', e));
        }
      }
    });
    // ==================== GLOBAL CLEANUP ====================
    const cleanupHandler = () => {
      console.log('[CLEANUP] Page unloading, cleaning up video resources');
      
      try {
        // Clean up dual video system
        if (dualVideoSystem && typeof dualVideoSystem.destroy === 'function') {
          dualVideoSystem.destroy();
          dualVideoSystem = null;
        }
      } catch (e) {
        console.error('[CLEANUP] Error destroying dual video system:', e);
      }
      
      try {
        // Clean up performance monitoring
        if (window._performanceMonitorInterval) {
          clearInterval(window._performanceMonitorInterval);
          window._performanceMonitorInterval = null;
        }
      } catch (e) {
        console.error('[CLEANUP] Error clearing performance monitor:', e);
      }
      
      try {
        // Clean up Safari canvas
        if (staticCanvas && staticCanvas.parentNode) {
          staticCanvas.width = 1;
          staticCanvas.height = 1;
          staticCanvas.parentNode.removeChild(staticCanvas);
          staticCanvas = null;
        }
      } catch (e) {
        console.error('[CLEANUP] Error cleaning canvas:', e);
      }
      
      try {
        // Clean up Safari cache
        if (fallbackCache && typeof fallbackCache.clear === 'function') {
          fallbackCache.clear();
          fallbackCache = null;
        }
      } catch (e) {
        console.error('[CLEANUP] Error clearing fallback cache:', e);
      }

      try {
        // Revoke all preloaded blob URLs to free memory
        for (const [src, blobUrl] of preloadedVideoBlobs.entries()) {
          if (blobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(blobUrl);
            console.log(`[CLEANUP] Revoked blob URL for ${src}`);
          }
        }
        preloadedVideoBlobs.clear();
      } catch (e) {
        console.error('[CLEANUP] Error revoking blob URLs:', e);
      }
      
      try {
        // Clean up main video
        if (bg) {
          bg.pause();
          bg.src = '';
          bg.load();
        }
      } catch (e) {
        console.error('[CLEANUP] Error cleaning main video:', e);
      }
      
      // Stop all animations to prevent memory leaks
      try {
        if (window._circleAnimating) {
          window._circleAnimating = false;
        }
        if (window._shipsAnimating) {
          window._shipsAnimating = false;
        }
      } catch (e) {
        console.error('[CLEANUP] Error stopping animations:', e);
      }
      
      console.log('[CLEANUP] Video cleanup complete');
    };

    // Register cleanup handlers
    window.addEventListener('beforeunload', cleanupHandler);
    

    // Error handler  
    window.addEventListener('error', (e) => {
      if (e.error && e.error.message && e.error.message.includes('video')) {
        console.error('[CLEANUP] Video-related error detected, triggering cleanup');
        
        if (dualVideoSystem && dualVideoSystem.destroy) {
          try {
            dualVideoSystem.destroy();
          } catch (cleanupError) {
            console.error('[CLEANUP] Emergency cleanup failed:', cleanupError);
          }
        }
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

  // android browser keyboard and touch scroll fix
  (function setupMobileInputFix() {
    const inputBox = document.getElementById("inputBox");
    const textInput = document.getElementById("textInput");
    const emailInput = document.getElementById("emailInput");
    
    // Detect if this is Firefox Android
    const isFirefoxAndroid = /Android.*Firefox/i.test(navigator.userAgent);
    
    // Prevent touch scroll/drag on body (but allow on inputs)
    // Use a less aggressive approach for Firefox
    document.addEventListener('touchmove', function(e) {
      const target = e.target;
      // Allow scrolling inside text inputs and their containers
      if (target === textInput || target === emailInput || 
          (inputBox && inputBox.contains(target))) {
        return; // Allow default scroll in inputs
      }
      // Prevent page scroll/drag everywhere else
      e.preventDefault();
    }, { passive: false });
    
    // Prevent pull-to-refresh / pinch zoom (but only on multi-touch)
    document.addEventListener('touchstart', function(e) {
      if (e.touches.length > 1) {
        e.preventDefault(); // Prevent pinch zoom
      }
    }, { passive: false });
    
    // Keyboard repositioning - works on Chrome, Firefox, Samsung Browser
    if (window.visualViewport) {
      let pendingUpdate = false;
      
      function repositionInputBox() {
        if (!inputBox || pendingUpdate) return;
        pendingUpdate = true;
        
        requestAnimationFrame(() => {
          pendingUpdate = false;
          if (!inputBox) return;
          
          const viewport = window.visualViewport;
          const layoutHeight = window.innerHeight;
          const visualHeight = viewport.height;
          const keyboardHeight = layoutHeight - visualHeight;
          
          // Keyboard is likely open if there's a significant height difference
          if (keyboardHeight > 50) {
            // Account for viewport offset (scroll position within visual viewport)
            const offsetTop = viewport.offsetTop || 0;
            inputBox.style.position = 'fixed';
            inputBox.style.bottom = `${keyboardHeight - offsetTop + 10}px`;
            inputBox.style.transition = 'bottom 0.1s ease-out';
          } else {
            // Reset to CSS default
            inputBox.style.bottom = '';
            inputBox.style.transition = '';
          }
        });
      }
      
      window.visualViewport.addEventListener('resize', repositionInputBox);
      window.visualViewport.addEventListener('scroll', repositionInputBox);
      
      // Handle focus/blur with delays for keyboard animation
      [textInput, emailInput].forEach(input => {
        if (!input) return;
        
        input.addEventListener('focus', () => {
          // Multiple attempts to catch keyboard animation
          setTimeout(repositionInputBox, 50);
          setTimeout(repositionInputBox, 150);
          setTimeout(repositionInputBox, 300);
          setTimeout(repositionInputBox, 500);
        });
        
        input.addEventListener('blur', () => {
          setTimeout(() => {
            if (inputBox) {
              inputBox.style.bottom = '';
              inputBox.style.transition = '';
            }
          }, 100);
        });
      });
      
      // Firefox Android specific: force initial layout
      if (isFirefoxAndroid) {
        setTimeout(() => {
          if (inputBox) {
            inputBox.style.visibility = 'visible';
            inputBox.style.opacity = '1';
          }
        }, 100);
      }
    } else {
      // Fallback for browsers without visualViewport (old Firefox, etc.)
      let lastHeight = window.innerHeight;
      
      window.addEventListener('resize', () => {
        const newHeight = window.innerHeight;
        const heightDiff = lastHeight - newHeight;
        
        if (inputBox && heightDiff > 100) {
          inputBox.style.position = 'fixed';
          inputBox.style.bottom = `${heightDiff + 10}px`;
        } else if (inputBox && heightDiff < -100) {
          inputBox.style.bottom = '';
        }
        
        lastHeight = newHeight;
      });
    }
  })();
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
          document.body.classList.add("admin-mode");
          createAdminControls();
          checkBackupStatus();
          try { startSoundStreamIfNeeded(true); } catch (e) { 
            console.warn('[SOUNDSTREAM] start request failed', e); 
          }
          alert("Admin mode activated. You can now right-click ships to delete them.");
        } else {
          alert("Incorrect password.");
        }
      } catch (err) {
        console.error("Auth error:", err);
        alert("Auth error, try again.");
      }
    }
  });
});

async function checkBackupStatus() {
  try {
    const res = await fetch("/api/admin/backup-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  const soundBtn = document.createElement("button");
  soundBtn.id = "admin-sound-button";
  soundBtn.innerText = "Sound: OFF";
  soundBtn.style.background = "#444";
  soundBtn.style.color = "#fff";
  soundBtn.style.border = "1px solid #222";
  soundBtn.style.padding = "6px 10px";
  soundBtn.style.borderRadius = "4px";
  soundBtn.style.cursor = "pointer";
  soundBtn.style.fontSize = "12px";
  soundBtn.onclick = async () => {
    soundAdminEnabled = !soundAdminEnabled;
    if (soundAdminEnabled) {
      soundBtn.innerText = "Sound: ON";
      soundBtn.style.background = "#226622";
      // If circle is active start streaming->blob flow, else preload only
      if (circleOverlayEl && circleOverlayEl.classList.contains("active")) {
        startSoundStreamIfNeeded(true);
      } else {
        try { await preloadSoundFully(); } catch (e) { console.warn('[SOUND] preload failed', e); }
      }
    } else {
      soundBtn.innerText = "Sound: OFF";
      soundBtn.style.background = "#444";
      // stop any playing audio
      stopSoundAll();
    }
  };
  container.appendChild(soundBtn);

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

  const allMsgsBtn = document.createElement("button");
  allMsgsBtn.id = "admin-all-messages-button";
  allMsgsBtn.innerText = "All Messages";
  allMsgsBtn.style.background = "#224488";
  allMsgsBtn.style.color = "#fff";
  allMsgsBtn.style.border = "1px solid #113366";
  allMsgsBtn.style.padding = "6px 10px";
  allMsgsBtn.style.borderRadius = "4px";
  allMsgsBtn.style.cursor = "pointer";
  allMsgsBtn.style.fontSize = "12px";
  allMsgsBtn.onclick = () => {
    let msgPanel = document.getElementById("admin-all-messages-panel");
    if (!msgPanel) {
      msgPanel = createAllMessagesPanel();
      container.appendChild(msgPanel);
    }
    const visible = msgPanel.style.display !== "none";
    if (visible) {
      fetchAllMessages(msgPanel);
    } else {
      msgPanel.style.display = "block";
      fetchAllMessages(msgPanel);
    }
  };
  container.appendChild(allMsgsBtn);

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
  const pre = panel.querySelector("pre");
  if (!pre) return;
  try {
    pre.innerText = "Loading...";
    const resp = await fetch("/api/admin/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      window._adminToken = null;
      adminMode = false;
      document.body.classList.remove("admin-mode");
    } else {
      pre.innerText = `Failed to load logs: ${resp.status}`;
    }
  } catch (err) {
    pre.innerText = "Fetch error: " + String(err);
  }
}

function createAllMessagesPanel() {
  const panel = document.createElement("div");
  panel.id = "admin-all-messages-panel";
  panel.style.display = "none";
  panel.style.marginTop = "8px";
  panel.style.width = "600px";
  panel.style.maxWidth = "90vw";
  panel.style.maxHeight = "70vh";
  panel.style.overflow = "auto";
  panel.style.background = "rgba(0,0,0,0.95)";
  panel.style.color = "#fff";
  panel.style.border = "1px solid #444";
  panel.style.borderRadius = "6px";
  panel.style.padding = "12px";
  panel.style.boxShadow = "0 4px 16px rgba(0,0,0,0.6)";
  panel.style.fontFamily = "monospace";
  panel.style.fontSize = "12px";

  // Header
  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "10px";
  header.style.borderBottom = "1px solid #444";
  header.style.paddingBottom = "8px";
  panel.appendChild(header);

  const title = document.createElement("div");
  title.innerText = "All Messages";
  title.style.fontWeight = "700";
  title.style.fontSize = "14px";
  header.appendChild(title);

  const controls = document.createElement("div");
  header.appendChild(controls);

  const refreshBtn = document.createElement("button");
  refreshBtn.innerText = "Refresh";
  refreshBtn.style.marginRight = "6px";
  refreshBtn.style.padding = "4px 8px";
  refreshBtn.style.cursor = "pointer";
  refreshBtn.onclick = () => fetchAllMessages(panel);
  controls.appendChild(refreshBtn);

  const closeBtn = document.createElement("button");
  closeBtn.innerText = "Close";
  closeBtn.style.padding = "4px 8px";
  closeBtn.style.cursor = "pointer";
  closeBtn.onclick = () => { panel.style.display = "none"; };
  controls.appendChild(closeBtn);

  // Content area
  const content = document.createElement("div");
  content.id = "admin-all-messages-content";
  content.style.marginTop = "8px";
  panel.appendChild(content);

  return panel;
}

async function fetchAllMessages(panel) {
  const content = panel.querySelector("#admin-all-messages-content");
  if (!content) return;

  content.innerHTML = '<div style="color:#888;">Loading...</div>';

  try {
    const resp = await fetch("/api/admin/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (resp.status === 401) {
      content.innerHTML = '<div style="color:#f88;">Unauthorized. Please re-authenticate as admin.</div>';
      return;
    }

    if (!resp.ok) {
      content.innerHTML = `<div style="color:#f88;">Failed to load: ${resp.status}</div>`;
      return;
    }

    const data = await resp.json();
    if (!data.ok || !data.messages) {
      content.innerHTML = '<div style="color:#f88;">Invalid response from server.</div>';
      return;
    }

    if (data.messages.length === 0) {
      content.innerHTML = '<div style="color:#888;">No messages yet.</div>';
      return;
    }

    // Build message list
    content.innerHTML = "";
    
    const countDiv = document.createElement("div");
    countDiv.style.marginBottom = "10px";
    countDiv.style.color = "#aaa";
    countDiv.innerText = `Total: ${data.messages.length} message(s)`;
    content.appendChild(countDiv);

    // Reverse to show newest first
    const sortedMessages = [...data.messages].reverse();

    for (const msg of sortedMessages) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "flex-start";
      row.style.gap = "10px";
      row.style.padding = "8px";
      row.style.marginBottom = "6px";
      row.style.background = "rgba(255,255,255,0.05)";
      row.style.borderRadius = "4px";
      row.style.borderLeft = msg.hasEmail ? "3px solid #4a9" : "3px solid #666";

      // Delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.innerText = "🗑️";
      deleteBtn.title = "Delete this message";
      deleteBtn.style.background = "#c33";
      deleteBtn.style.color = "#fff";
      deleteBtn.style.border = "none";
      deleteBtn.style.borderRadius = "3px";
      deleteBtn.style.padding = "4px 8px";
      deleteBtn.style.cursor = "pointer";
      deleteBtn.style.fontSize = "12px";
      deleteBtn.style.flexShrink = "0";
      deleteBtn.onclick = async () => {
        await deleteMessageWithConfirmation(msg, panel);
      };
      row.appendChild(deleteBtn);

      // Message info container
      const info = document.createElement("div");
      info.style.flex = "1";
      info.style.minWidth = "0";

      // Timestamp
      const timeDiv = document.createElement("div");
      timeDiv.style.fontSize = "10px";
      timeDiv.style.color = "#888";
      timeDiv.style.marginBottom = "4px";
      const formattedTime = formatTimestamp(msg.time);
      timeDiv.innerText = formattedTime;
      info.appendChild(timeDiv);

      // Email (if present)
      if (msg.email) {
        const emailDiv = document.createElement("div");
        emailDiv.style.fontSize = "11px";
        emailDiv.style.color = "#4a9";
        emailDiv.style.marginBottom = "4px";
        emailDiv.innerText = `📧 ${msg.email}`;
        info.appendChild(emailDiv);
      }

      // Message text
      const textDiv = document.createElement("div");
      textDiv.style.wordBreak = "break-word";
      textDiv.style.whiteSpace = "pre-wrap";
      textDiv.style.color = "#fff";
      textDiv.innerText = msg.text.length > 500 ? msg.text.substring(0, 500) + "..." : msg.text;
      info.appendChild(textDiv);

      row.appendChild(info);
      content.appendChild(row);
    }

  } catch (err) {
    content.innerHTML = `<div style="color:#f88;">Error: ${err.message}</div>`;
  }
}

function formatTimestamp(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d)) return isoString;
    
    const tz = "Europe/Tallinn";
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", 
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit", 
      month: "2-digit", 
      year: "numeric",
      hour12: false,
      timeZone: tz
    }).formatToParts(d);
    
    const get = t => (parts.find(p => p.type === t) || {}).value || "";
    return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
  } catch (e) {
    return isoString;
  }
}

async function deleteMessageWithConfirmation(msg, panel) {
  // Create modal overlay for confirmation
  const modal = document.createElement("div");
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.background = "rgba(0,0,0,0.8)";
  modal.style.display = "flex";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.zIndex = "99999";

  const dialog = document.createElement("div");
  dialog.style.background = "#222";
  dialog.style.border = "1px solid #444";
  dialog.style.borderRadius = "8px";
  dialog.style.padding = "20px";
  dialog.style.maxWidth = "500px";
  dialog.style.width = "90%";
  dialog.style.color = "#fff";
  dialog.style.fontFamily = "monospace";

  const title = document.createElement("h3");
  title.style.margin = "0 0 15px 0";
  title.style.color = "#f88";
  title.innerText = "⚠️ Confirm Delete";
  dialog.appendChild(title);

  const msgPreview = document.createElement("div");
  msgPreview.style.background = "rgba(255,255,255,0.05)";
  msgPreview.style.padding = "10px";
  msgPreview.style.borderRadius = "4px";
  msgPreview.style.marginBottom = "15px";
  msgPreview.style.maxHeight = "150px";
  msgPreview.style.overflow = "auto";
  msgPreview.style.wordBreak = "break-word";
  msgPreview.innerHTML = `
    <div style="font-size:10px;color:#888;margin-bottom:4px;">${formatTimestamp(msg.time)}</div>
    ${msg.email ? `<div style="font-size:11px;color:#4a9;margin-bottom:4px;">📧 ${msg.email}</div>` : ''}
    <div style="color:#fff;">${escapeHtml(msg.text.length > 200 ? msg.text.substring(0, 200) + "..." : msg.text)}</div>
  `;
  dialog.appendChild(msgPreview);

  const warning = document.createElement("p");
  warning.style.color = "#f88";
  warning.style.fontSize = "12px";
  warning.style.margin = "0 0 15px 0";
  warning.innerText = "This action cannot be undone. The message will be permanently deleted from the server.";
  dialog.appendChild(warning);

  const btnContainer = document.createElement("div");
  btnContainer.style.display = "flex";
  btnContainer.style.justifyContent = "flex-end";
  btnContainer.style.gap = "10px";

  const cancelBtn = document.createElement("button");
  cancelBtn.innerText = "Cancel";
  cancelBtn.style.padding = "8px 16px";
  cancelBtn.style.background = "#444";
  cancelBtn.style.color = "#fff";
  cancelBtn.style.border = "none";
  cancelBtn.style.borderRadius = "4px";
  cancelBtn.style.cursor = "pointer";
  cancelBtn.onclick = () => modal.remove();
  btnContainer.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.innerText = "OK - Delete Permanently";
  confirmBtn.style.padding = "8px 16px";
  confirmBtn.style.background = "#c33";
  confirmBtn.style.color = "#fff";
  confirmBtn.style.border = "none";
  confirmBtn.style.borderRadius = "4px";
  confirmBtn.style.cursor = "pointer";
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.innerText = "Deleting...";
    
    try {
      const res = await fetch("/api/admin/delete-ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipText: msg.text })
      });

      if (res.ok) {
        modal.remove();
        // Refresh the panel
        fetchAllMessages(panel);
      } else if (res.status === 401) {
        alert("Unauthorized. Please re-authenticate as admin.");
        modal.remove();
      } else {
        alert(`Failed to delete: ${res.status}`);
        confirmBtn.disabled = false;
        confirmBtn.innerText = "OK - Delete Permanently";
      }
    } catch (err) {
      alert("Error: " + err.message);
      confirmBtn.disabled = false;
      confirmBtn.innerText = "OK - Delete Permanently";
    }
  };
  btnContainer.appendChild(confirmBtn);

  dialog.appendChild(btnContainer);
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  // Close on escape
  const escHandler = (e) => {
    if (e.key === "Escape") {
      modal.remove();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}