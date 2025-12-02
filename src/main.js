import "./style.css";
import { heicTo, isHeic } from "heic-to"; // <-- NPM package

// 1. Build the UI inside #app
document.querySelector("#app").innerHTML = `
  <div class="container">
    <h1>HEIC → JPEG</h1>
    <p class="subheading">Client-side conversion. HEIC files use a dedicated decoder, others go via canvas.</p>

    <div class="input-row">
      <label for="fileInput">➕ Select images</label>
      <span class="hint">HEIC, PNG, JPEG, WebP…</span>
    </div>

    <input id="fileInput" type="file" accept="image/*" multiple />

    <div id="dropZone" class="drop-zone">
      Or drag & drop image files here
    </div>

    <div id="status"></div>

    <canvas id="canvas" style="display:none;"></canvas>

    <div id="output"></div>
  </div>
`;

// 2. Grab DOM elements
const fileInput = document.getElementById("fileInput");
const statusEl = document.getElementById("status");
const canvas = document.getElementById("canvas");
const output = document.getElementById("output");
const ctx = canvas.getContext("2d");  
const dropZone = document.getElementById("dropZone");

// Track Object URLs for cleanup
const objectUrls = new Set();

function setStatus(msg) {
  statusEl.textContent = msg;
  console.log(msg);
}

// 3. Handle file selection via file input
fileInput.addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  processFiles(files);
});

// 4. Set up drag and drop event listeners (must be outside processFiles!)
["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("drag-over");
  });
});

dropZone.addEventListener("dragleave", (e) => {
  // Only remove class if we're actually leaving the drop zone (not just a child element)
  if (!dropZone.contains(e.relatedTarget)) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("drag-over");
  }
});

dropZone.addEventListener("dragend", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove("drag-over");

  const dt = e.dataTransfer;
  if (!dt) return;

  const files = Array.from(dt.files || []);
  processFiles(files);
});

// 5. Process files function
async function processFiles(files) {
  if (!files.length) {
    setStatus("No files selected.");
    return;
  }

  // Optional: filter only images if you want to ignore random files
  files = files.filter(
    (file) =>
      file.type.startsWith("image/") ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif")
  );

  if (!files.length) {
    setStatus("No supported image files found.");
    return;
  }

  setStatus(`Processing ${files.length} file(s)...`);
  
  // Cleanup: revoke all previous Object URLs before clearing output
  objectUrls.forEach(url => URL.revokeObjectURL(url));
  objectUrls.clear();
  output.innerHTML = "";

  for (const file of files) {
    try {
      const heic = await safeIsHeic(file);
      if (heic) {
        await convertHeicFileToJpeg(file);
      } else {
        await convertImageFileToJpeg(file);
      }
    } catch (err) {
      console.error(err);
      appendMessage(`Error converting ${file.name}: ${err.message || err}`);
    }
  }

  setStatus("Done.");
}


// 4a. HEIC → JPEG via heic-to
async function convertHeicFileToJpeg(file) {
  appendMessage(`(HEIC) Converting ${file.name}...`);

  // 1. Convert HEIC → JPEG blob
  const jpegBlob = await heicTo({
    blob: file,
    type: "image/jpeg",
    quality: 0.9,
  });

  // 2. Create thumbnail from the resulting JPEG
  const thumbDataUrl = await createThumbnailFromBlob(jpegBlob);

  // 3. Add link with optional thumbnail
  addDownloadLink(file.name, jpegBlob, thumbDataUrl);
}
// 4b. Non-HEIC images → JPEG via canvas (fallback path)
async function convertImageFileToJpeg(file) {
  appendMessage(`(Standard image) Reading ${file.name}...`);

  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  // Create thumbnail from the canvas before converting to blob
  const thumbDataUrl = createThumbnailDataUrl(canvas);

  const jpegBlob = await canvasToJpegBlob(canvas, 0.9);
  addDownloadLink(file.name, jpegBlob, thumbDataUrl);
}

// Helper: wrap isHeic so if it explodes, we don't kill the entire loop
async function safeIsHeic(file) {
  try {
    return await isHeic(file);
  } catch (e) {
    console.warn("isHeic failed, treating as non-HEIC", e);
    return false;
  }
}

// Helper: load <img>
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

// Helper: canvas.toBlob → Promise
function canvasToJpegBlob(canvas, quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create JPEG blob"));
        } else {
          resolve(blob);
        }
      },
      "image/jpeg",
      quality
    );
  });
}

// Helper: add download link
function addDownloadLink(originalName, blob, thumbDataUrl = null) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url); // Track for cleanup
  
  const baseName = originalName.replace(/\.[^.]+$/, "");

  const wrapper = document.createElement("div");
  wrapper.className = "output-item";

  const left = document.createElement("div");
  left.className = "output-left";

  if (thumbDataUrl) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = thumbDataUrl;
    img.alt = baseName;
    left.appendChild(img);
  }

  const label = document.createElement("span");
  label.textContent = `${baseName}.jpg`;
  left.appendChild(label);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.jpg`;
  a.textContent = "Download";
  
  // Cleanup: revoke Object URL after download completes
  a.addEventListener("click", () => {
    // Revoke after a delay to ensure download starts
    setTimeout(() => {
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
    }, 1000);
  });

  wrapper.appendChild(left);
  wrapper.appendChild(a);
  output.appendChild(wrapper);
}

// Helper: log messages
function appendMessage(text) {
  const p = document.createElement("p");
  p.className = "output-log";
  p.textContent = text;
  output.appendChild(p);
}


// Thumbnail directly from an existing canvas (for non-HEIC path)
function createThumbnailDataUrl(sourceCanvas, maxWidth = 240) {
  const { width, height } = sourceCanvas;

  if (!width || !height) {
    return null;
  }

  const scale = Math.min(maxWidth / width, 1);
  const thumbWidth = Math.round(width * scale);
  const thumbHeight = Math.round(height * scale);

  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = thumbWidth;
  thumbCanvas.height = thumbHeight;

  const tctx = thumbCanvas.getContext("2d");
  tctx.drawImage(sourceCanvas, 0, 0, thumbWidth, thumbHeight);

  return thumbCanvas.toDataURL("image/jpeg", 0.7);
}

// Thumbnail from a Blob (for HEIC path, after converting to JPEG)
async function createThumbnailFromBlob(blob, maxWidth = 240) {
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);

    const scale = Math.min(maxWidth / img.naturalWidth, 1);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;

    const tctx = tempCanvas.getContext("2d");
    tctx.drawImage(img, 0, 0, w, h);

    return tempCanvas.toDataURL("image/jpeg", 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  objectUrls.forEach(url => URL.revokeObjectURL(url));
  objectUrls.clear();
});