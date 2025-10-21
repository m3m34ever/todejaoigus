let adminMode = false;
let ADMIN_PASSWORD = "kylltulebarmastus"; // 🔒 change this!

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


const socket = io();
let ships = [];

// Create a new ship
function createShip(msg) {
  const div = document.createElement("div");
  div.className = "ship";

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

  const s = 80; // ship size

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `-${s*0.6} -${s*0.6} ${s*1.2} ${s*1.2}`);
  svg.setAttribute("width", s);
  svg.setAttribute("height", s);

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
  preview.innerText = msg.text.length > 10 ? msg.text.slice(0,10) + "…" : msg.text;
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
}

// Overlay for full text
function showOverlay(text){
  let overlay = document.getElementById("overlay");
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

// Input box logic
const textInput = document.getElementById("textInput");
const checkbox = document.getElementById("feedbackCheckbox");
const emailInput = document.getElementById("emailInput");

// Auto-expand textarea
textInput.addEventListener("input", () => {
  textInput.style.height = "auto";
  textInput.style.height = textInput.scrollHeight + "px";
});

// Show/hide email input
checkbox.addEventListener("change", () => {
  if(checkbox.checked){
    emailInput.style.display = "block";
  } else {
    emailInput.style.display = "none";
    emailInput.value = "";
  }
});

// Send text
function sendText(){
  const text = textInput.value.trim();
  const wantsFeedback = checkbox.checked;
  const email = wantsFeedback ? emailInput.value.trim() : null;

  if(text){
    socket.emit("newText", { text, email });
    textInput.value = "";
    textInput.style.height = "auto";
    checkbox.checked = false;
    emailInput.value = "";
    emailInput.style.display = "none";
  }
}

window.sendText = sendText;

// Socket.io events
socket.on("init", msgs => {
  msgs.forEach(m => {
    messages.push(m);
    createShip(m);
  });
  animateShips(); // start animation
  saveMessagesToLog();
});

socket.on("newText", (msg) => {
  messages.push(msg)
  saveMessagesToLog();
  createShip(msg);
});

// Toggle admin mode with Shift + A
document.removeEventListener("keydown", /* noop to ensure no duplicates */);
document.addEventListener("keydown", (e) => {
  if (e.shiftKey && e.key.toLowerCase() === "a") {
    const input = prompt("Enter admin password:");
    if (input === ADMIN_PASSWORD) {
      adminMode = true;
      document.body.classList.add("admin-mode");
      alert("Admin mode activated. You can now right-click ships to delete them.");
    } else {
      alert("Incorrect password.");
    }
  }
});