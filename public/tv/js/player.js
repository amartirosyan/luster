import {
  STYLES,
  SPEED,
  buildStops,
  easeGlide,
  easeDissolve,
  placeContain,
  portraitKeys,
  sampleKeys,
  shotSpan,
} from "./engine.js?v=9";
import { createDetector } from "./detect.js?v=12";
import { createGooglePhotos, explainGoogleError } from "./google.js?v=25";
import { deleteAlbum, listAlbums, loadAlbum, renameAlbum, saveAlbum, screensaverId, setScreensaver } from "./albums.js?v=3";
import qrcode from "./qrcode.js?v=2";

const REV = "1.2.13";
const BLURS = [
  { id: "none", label: "None" },
  { id: "smooth", label: "Smooth", radius: 8, passes: 2, sat: 1.05, dark: 0.22 },
  { id: "cinema", label: "Cinema", radius: 12, passes: 2, sat: 1.08, dark: 0.38, vignette: 0.55 },
  { id: "feathered", label: "Feathered", radius: 12, passes: 2, sat: 1.06, dark: 0.32, vignette: 0.4 },
  { id: "wash", label: "Color wash", radius: 18, passes: 3, sat: 0.85, dark: 0.5 },
];

function storedBlur() {
  try {
    const saved = localStorage.getItem("lustre.blur");
    if (BLURS.some((item) => item.id === saved)) return saved;
  } catch {
    /* the television kept the choice private */
  }
  return "wash";
}

function newerVersion(remote, local) {
  const parts = (value) => String(value || "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(remote);
  const b = parts(local);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function drawQr(canvas, text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const scale = 8;
  const size = (n + quiet * 2) * scale;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4efe6";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#090909";
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!qr.isDark(row, col)) continue;
      ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
    }
  }
}

function quietStatus(text) {
  if (/^Checking with Google|^Not saved yet/.test(text)) return "Waiting for Done in Google Photos.";
  return text;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not open a photo"));
    img.src = src;
  });
}

function styleById(id) {
  return STYLES.find((s) => s.id === id) ?? STYLES[2];
}

export function mountPlayer(root, options = {}) {
  const base = options.base ?? "";
  let dead = false;
  let raf = 0;
  let photos = [];
  let index = 0;
  let style = "portrait";
  let speed = "normal";
  let paused = false;
  let userZoom = 1;
  let clock = 0;
  let lastNow = 0;
  let fading = false;
  let fadeFrom = 0;
  let fadeU = 0;
  let stripPos = 0;
  let started = false;
  let loading = false;
  let prepareGen = 0;
  let detectorNote = "";
  let downloadNote = "";
  let reel = "";
  let sheetOpen = false;
  let codeUrl = "";
  let albumMode = false;
  let screensaverMode = false;
  let currentAlbumId = "";
  let photosSaved = false;
  let savedName = "";
  let idleAt = performance.now();
  let saverAlbumId = "";
  let saverWatch = false;
  const google = createGooglePhotos();
  let cancelPick = () => {};
  let hudUntil = 0;
  let hudSig = "";
  let stageW = 0;
  let stageH = 0;
  const plates = new Map();
  const motions = new Map();
  const useGpu = typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.animate === "function";
  let blurStyle = storedBlur();
  let updateOffer = null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduced) style = "still";

  root.innerHTML = "";
  root.classList.add("nl-root");
  const stage = document.createElement("div");
  stage.className = "nl-stage";
  stage.dataset.blur = blurStyle;
  const hud = document.createElement("div");
  hud.className = "nl-hud";
  const status = document.createElement("div");
  status.className = "nl-status";
  const statusLabel = document.createElement("p");
  statusLabel.className = "nl-status-label";
  const progress = document.createElement("div");
  progress.className = "nl-progress";
  progress.hidden = true;
  const progressBar = document.createElement("div");
  progressBar.className = "nl-progress-bar";
  progress.append(progressBar);
  const pct = document.createElement("p");
  pct.className = "nl-status-pct";
  status.append(statusLabel, progress, pct);
  root.append(stage, status, hud);
  status.hidden = true;

  function setStatus(text, ratio) {
    status.hidden = false;
    statusLabel.textContent = text;
    if (ratio == null || !Number.isFinite(ratio)) {
      progress.hidden = true;
      pct.hidden = true;
      pct.textContent = "";
      return;
    }
    const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    progress.hidden = false;
    pct.hidden = false;
    progressBar.style.width = `${percent}%`;
    pct.textContent = `${percent}%`;
  }

  const nodes = new Map();

  function bumpHud() {
    hudUntil = performance.now() + 4200;
    hud.classList.add("is-on");
  }

  function ensureNode(key, kind) {
    let node = nodes.get(key);
    if (node && node.dataset.kind !== kind) {
      node.remove();
      nodes.delete(key);
      node = undefined;
    }
    if (!node) {
      node = document.createElement("div");
      node.dataset.kind = kind;
      node.className = kind === "print" ? "nl-print" : kind === "blur" ? "nl-blur" : "nl-frame";
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      node.append(img);
      if (kind === "print") {
        const cap = document.createElement("p");
        cap.className = "nl-cap";
        node.append(cap);
      }
      stage.append(node);
      nodes.set(key, node);
    }
    return node;
  }

  function retire(keep) {
    for (const [key, node] of nodes) {
      if (!keep.has(key)) {
        node.remove();
        motions.get(node)?.anim?.cancel();
        motions.delete(node);
        nodes.delete(key);
      }
    }
  }


  function stageSize() {
    if (stageW > 0 && stageH > 0) return { sw: stageW, sh: stageH };
    const rect = stage.getBoundingClientRect();
    stageW = rect.width || 1920;
    stageH = rect.height || 1080;
    return { sw: stageW, sh: stageH };
  }

  function dropMotion() {
    for (const rec of motions.values()) rec.anim?.cancel();
    motions.clear();
  }

  function blurPixels(canvas, radius) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx || radius < 1) return;
    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h);
    const src = img.data;
    const tmp = new Uint8ClampedArray(src.length);
    const div = radius * 2 + 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          const i = (y * w + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
        }
        const o = (y * w + x) * 4;
        tmp[o] = r / div;
        tmp[o + 1] = g / div;
        tmp[o + 2] = b / div;
        tmp[o + 3] = 255;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          const i = (yy * w + x) * 4;
          r += tmp[i];
          g += tmp[i + 1];
          b += tmp[i + 2];
        }
        const o = (y * w + x) * 4;
        src[o] = r / div;
        src[o + 1] = g / div;
        src[o + 2] = b / div;
        src[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function bakePlate(img) {
    const src = img?.currentSrc || img?.src || "";
    if (!src) return "";
    if (!img.complete || !img.naturalWidth) return "";
    const look = BLURS.find((item) => item.id === blurStyle) || BLURS[4];
    const key = `${look.id}:${src}`;
    if (plates.has(key)) return plates.get(key);
    const tiny = document.createElement("canvas");
    tiny.width = 400;
    tiny.height = 225;
    const tctx = tiny.getContext("2d", { alpha: false });
    if (!tctx) return "";
    const cover = Math.max(tiny.width / img.naturalWidth, tiny.height / img.naturalHeight);
    const dw = img.naturalWidth * cover;
    const dh = img.naturalHeight * cover;
    tctx.drawImage(img, (tiny.width - dw) / 2, (tiny.height - dh) / 2, dw, dh);
    for (let pass = 0; pass < look.passes; pass += 1) blurPixels(tiny, look.radius);
    const ctx = tctx;
    const frame = ctx.getImageData(0, 0, tiny.width, tiny.height);
    const data = frame.data;
    const sat = look.sat;
    for (let i = 0; i < data.length; i += 4) {
      const y = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      data[i] = Math.max(0, Math.min(255, y + (data[i] - y) * sat));
      data[i + 1] = Math.max(0, Math.min(255, y + (data[i + 1] - y) * sat));
      data[i + 2] = Math.max(0, Math.min(255, y + (data[i + 2] - y) * sat));
    }
    ctx.putImageData(frame, 0, 0);
    ctx.fillStyle = `rgba(0, 0, 0, ${look.dark})`;
    ctx.fillRect(0, 0, tiny.width, tiny.height);
    if (look.vignette) {
      const shade = ctx.createRadialGradient(
        tiny.width / 2,
        tiny.height / 2,
        tiny.width * 0.2,
        tiny.width / 2,
        tiny.height / 2,
        tiny.width * 0.75,
      );
      shade.addColorStop(0, "rgba(0, 0, 0, 0)");
      shade.addColorStop(1, `rgba(0, 0, 0, ${look.vignette})`);
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, tiny.width, tiny.height);
    }
    let url = "";
    try {
      url = tiny.toDataURL("image/jpeg", 0.82);
    } catch {
      return "";
    }
    plates.set(key, url);
    return url;
  }

  function basePlace(photoIndex, sw, sh) {
    const photo = photos[photoIndex];
    return placeContain(photo.natW, photo.natH, sw, sh, { zoom: 1, ax: 0.5, ay: 0.5 });
  }

  function frameTransform(photoIndex, t, sw, sh, base) {
    const place = placeContain(photos[photoIndex].natW, photos[photoIndex].natH, sw, sh, poseAt(photoIndex, t));
    const scale = base.width > 0 ? place.width / base.width : 1;
    return `translate3d(${place.left.toFixed(2)}px, ${place.top.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
  }

  function startMotion(node, photoIndex, sw, sh, at) {
    motions.get(node)?.anim?.cancel();
    const span = spanFor(photoIndex);
    const base = basePlace(photoIndex, sw, sh);
    node.style.width = `${base.width}px`;
    node.style.height = `${base.height}px`;
    node.style.transformOrigin = "0 0";
    const steps = 24;
    const frames = [];
    for (let i = 0; i < steps; i++) {
      const t = (span.play * i) / (steps - 1);
      frames.push({
        transform: frameTransform(photoIndex, t, sw, sh, base),
        offset: i / (steps - 1),
      });
    }
    const anim = node.animate(frames, {
      duration: Math.max(1, span.play),
      easing: "linear",
      fill: "forwards",
    });
    anim.currentTime = Math.min(span.play, Math.max(0, at));
    if (paused) anim.pause();
    motions.set(node, { anim, photo: photoIndex, sw, sh, play: span.play });
  }

  function holdMotion(node, photoIndex, sw, sh, at) {
    const span = spanFor(photoIndex);
    const rec = motions.get(node);
    if (rec?.anim && rec.photo === photoIndex && rec.sw === sw && rec.sh === sh && rec.play === span.play) {
      if (paused && rec.anim.playState === "running") rec.anim.pause();
      else if (!paused && rec.anim.playState === "paused") rec.anim.play();
      return;
    }
    startMotion(node, photoIndex, sw, sh, at);
  }

  function paintLayer(layer, sw, sh, extras) {
    const node = ensureNode(layer.key, layer.kind);
    const img = node.querySelector("img");
    if (img.getAttribute("src") !== layer.src) img.src = layer.src;
    if (node.style.opacity !== String(layer.opacity)) node.style.opacity = String(layer.opacity);
    node.style.zIndex = String(layer.kind === "frame" ? layer.z * 2 : layer.z);
    if (layer.kind === "print") {
      node.style.width = `${layer.box.w}px`;
      node.style.height = `${layer.box.h}px`;
      node.style.transform = `translate3d(${layer.box.x}px, ${layer.box.y}px, 0) rotate(${layer.rotate}deg)`;
      const cap = node.querySelector(".nl-cap");
      if (cap) cap.textContent = layer.caption || "";
      return;
    }
    const photo = photos[layer.photo];
    const base = placeContain(photo.natW, photo.natH, sw, sh, { zoom: 1, ax: 0.5, ay: 0.5 });
    const place = placeContain(photo.natW, photo.natH, sw, sh, layer.pose);
    const scale = base.width > 0 ? place.width / base.width : 1;
    const gpu = useGpu && style === "portrait" && !layer.slide;
    if (node.dataset.bw !== String(base.width) || node.dataset.bh !== String(base.height)) {
      node.dataset.bw = String(base.width);
      node.dataset.bh = String(base.height);
      node.style.width = `${base.width}px`;
      node.style.height = `${base.height}px`;
      node.style.transformOrigin = "0 0";
    }
    if (gpu) holdMotion(node, layer.photo, sw, sh, layer.motionAt || 0);
    else {
      motions.get(node)?.anim?.cancel();
      motions.delete(node);
      node.style.transform = `translate3d(${(place.left + (layer.slide || 0)).toFixed(2)}px, ${place.top.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    }
    if (blurStyle !== "none") {
      const bkey = `blur-${layer.key}`;
      extras.add(bkey);
      const blur = ensureNode(bkey, "blur");
      const bimg = blur.querySelector("img");
      const plate = bakePlate(img);
      const shown = plate || layer.src;
      if (bimg.getAttribute("src") !== shown) bimg.src = shown;
      blur.style.opacity = plate ? String(layer.opacity) : "0";
      blur.style.zIndex = String(layer.z * 2 - 1);
    }
  }

  function poseAt(photoIndex, t) {
    const photo = photos[photoIndex];
    if (!photo) return { zoom: 1, ax: 0.5, ay: 0.5 };
    if (style !== "portrait") return { zoom: 1, ax: 0.5, ay: 0.5 };
    const factor = SPEED[speed] ?? 1;
    return sampleKeys(photo.keys, t / factor);
  }

  function spanFor(photoIndex) {
    const photo = photos[photoIndex];
    return shotSpan(style, photo?.keys ?? [], speed);
  }

  function rebuildKeys() {
    const aspect = stageAspect();
    for (const photo of photos) {
      photo.stops = buildStops(photo.faces, photo.natW, photo.natH, aspect);
      photo.keys = portraitKeys(photo.stops, photo.i, photo.natW, photo.natH, aspect);
      photo.move = photo.keys.move;
      photo.zoom = photo.keys.zoom;
    }
  }

  function stageAspect() {
    const r = stage.getBoundingClientRect();
    return r.width / Math.max(1, r.height);
  }

  function advance() {
    index = (index + 1) % photos.length;
    clock = 0;
    fading = false;
    fadeU = 0;
  }

  function jump(delta) {
    if (!photos.length) return;
    index = (index + delta + photos.length) % photos.length;
    clock = 0;
    fading = false;
    fadeU = 0;
    userZoom = 1;
    bumpHud();
  }

  function cycleStyle(delta) {
    const i = STYLES.findIndex((s) => s.id === style);
    style = STYLES[(i + delta + STYLES.length) % STYLES.length].id;
    clock = 0;
    fading = false;
    userZoom = 1;
    bumpHud();
  }

  function cycleSpeed() {
    speed = speed === "fast" ? "normal" : speed === "normal" ? "slow" : "fast";
    bumpHud();
  }

  function setStyle(id) {
    if (!STYLES.some((s) => s.id === id)) return;
    style = id;
    clock = 0;
    fading = false;
    userZoom = 1;
    bumpHud();
  }

  function onKey(e) {
    const code = e.keyCode;
    const key = e.key;
    const known =
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Left", "Right", "Up", "Down", "Enter", " ", "Escape"].includes(key) ||
      ["1", "2", "3", "4", "5"].includes(key) ||
      [37, 38, 39, 40, 13, 461, 415, 19, 413, 403, 404, 405, 406, 427, 428].includes(code);
    if (sheetOpen) {
      if (key === "Escape" || code === 461 || code === 413) {
        e.preventDefault();
        if (albumMode) showMenu("");
        else closeSheet();
        return;
      }
      const typing = document.activeElement instanceof HTMLInputElement;
      const down = key === "ArrowDown" || key === "Down" || key === "ArrowRight" || key === "Right" || code === 40 || code === 39 || code === 428;
      const up = key === "ArrowUp" || key === "Up" || key === "ArrowLeft" || key === "Left" || code === 38 || code === 37 || code === 427;
      if (typing && (key === "ArrowLeft" || key === "ArrowRight" || code === 37 || code === 39)) return;
      if (down || up) {
        e.preventDefault();
        moveFocus(sheetControls(), down ? 1 : -1);
        return;
      }
      if (key === "Enter" || key === " " || code === 13) {
        const current = document.activeElement;
        if (current instanceof HTMLButtonElement || current instanceof HTMLInputElement) return;
        e.preventDefault();
        sheetControls()[0]?.focus();
      }
      return;
    }
    if (!known) return;
    const hudOn = document.activeElement instanceof Element && !!document.activeElement.closest(".nl-controls");
    if (hudOn) {
      const down = key === "ArrowDown" || key === "Down" || key === "ArrowRight" || key === "Right" || code === 40 || code === 39 || code === 428;
      const up = key === "ArrowUp" || key === "Up" || key === "ArrowLeft" || key === "Left" || code === 38 || code === 37 || code === 427;
      if (code === 461 || key === "Escape" || code === 413) {
        e.preventDefault();
        document.activeElement.blur();
        return;
      }
      if (down || up) {
        e.preventDefault();
        bumpHud();
        moveFocus(hudControls(), down ? 1 : -1);
        return;
      }
      if (key === "Enter" || key === " " || code === 13) return;
    }
    const fromButton = e.target instanceof Element && !!e.target.closest("button");
    if (fromButton && (key === "Enter" || key === " " || code === 13)) {
      bumpHud();
      return;
    }
    e.preventDefault();
    if (code === 461) {
      if (screensaverMode) {
        if (!hud.classList.contains("is-on")) bumpHud();
        else openSheet();
        return;
      }
      if (hud.classList.contains("is-on")) {
        const back = globalThis.webOS?.platformBack;
        if (typeof back === "function") back();
      } else {
        bumpHud();
      }
      return;
    }
    if (key === "ArrowLeft" || key === "Left" || code === 37) jump(-1);
    else if (key === "ArrowRight" || key === "Right" || code === 39) jump(1);
    else if (key === "ArrowUp" || key === "Up" || code === 38 || code === 427) {
      e.preventDefault();
      bumpHud();
      moveFocus(hudControls(), -1);
    } else if (key === "ArrowDown" || key === "Down" || code === 40 || code === 428) {
      e.preventDefault();
      bumpHud();
      moveFocus(hudControls(), 1);
    } else if (key === "Enter" || key === " " || code === 13 || code === 415 || code === 19) {
      paused = !paused;
      bumpHud();
    } else if (code === 413 || key === "Escape") {
      paused = true;
      bumpHud();
    } else if (code === 403 || key === "1") setStyle("still");
    else if (code === 404 || key === "2") setStyle("slide");
    else if (code === 405 || key === "3") setStyle("portrait");
    else if (code === 406 || key === "4") setStyle("prints");
    else if (key === "5") setStyle("strip");
  }

  function cardBox(photo, sw, sh, zoom) {
    const maxW = sw * 0.56 * zoom;
    const maxH = sh * 0.68 * zoom;
    const ar = photo.natW / photo.natH;
    let w = maxW;
    let h = w / ar;
    if (h > maxH) {
      h = maxH;
      w = h * ar;
    }
    const mat = Math.max(10, w * 0.035);
    const cap = Math.max(22, sh * 0.04);
    return { w: w + mat * 2, h: h + mat * 2 + cap, mat };
  }

  function printLayers(sw, sh, tInShot) {
    const span = spanFor(index);
    const dropT = 900 * (span.play / 5600);
    const u = Math.min(1, tInShot / dropT);
    const ease = 1 - Math.pow(1 - u, 3);
    const layers = [];
    const order = [index];
    if (photos.length > 1) order.push((index - 1 + photos.length) % photos.length);
    order.forEach((pi, depth) => {
      const photo = photos[pi];
      const box = cardBox(photo, sw, sh, userZoom);
      const rot = ((pi * 47) % 11) - 5;
      const restX = (sw - box.w) / 2 + (depth === 0 ? 0 : -box.w * 0.28);
      const restY = (sh - box.h) / 2 + (depth === 0 ? sh * 0.012 : sh * 0.05);
      const y = depth === 0 ? (1 - ease) * (-sh * 0.45) + ease * restY : restY;
      const rotNow = depth === 0 ? rot + (1 - ease) * 8 : -8;
      layers.push({
        key: `p-${pi}`,
        kind: "print",
        src: photo.src,
        photo: pi,
        opacity: depth === 0 ? 1 : 0.92,
        z: 10 - depth,
        rotate: rotNow,
        caption: depth === 0 ? `${photo.date}  ·  ${photo.title}` : "",
        box: { x: restX, y, w: box.w, h: box.h },
      });
    });
    return layers;
  }

  function stripLayers(sw, sh) {
    const layers = [];
    const zoom = userZoom;
    const cardW = sw * 0.34 * zoom;
    const gap = sw * 0.028;
    photos.forEach((photo, pi) => {
      const ar = photo.natW / photo.natH;
      const dist = Math.abs(pi - stripPos);
      const focus = Math.max(0, 1 - dist);
      const w = cardW * (1 + 0.16 * focus);
      const h = w / ar;
      const mat = Math.max(8, w * 0.03);
      const bw = w + mat * 2;
      const bh = h + mat * 2 + 8;
      const x = sw / 2 + (pi - stripPos) * (cardW * 1.08 + gap) - bw / 2;
      const y = (sh - bh) / 2 - focus * sh * 0.02;
      layers.push({
        key: `s-${pi}`,
        kind: "print",
        src: photo.src,
        photo: pi,
        opacity: dist > 2.15 ? 0 : 0.62 + 0.38 * focus,
        z: 20 - Math.round(dist),
        rotate: ((pi * 13) % 5) - 2,
        caption: "",
        box: { x, y, w: bw, h: bh },
      });
    });
    return layers;
  }

  function frameLayers(sw, sh) {
    const span = spanFor(index);
    const local = clock;
    if (!fading && !paused && local >= span.play) {
      fading = true;
      fadeFrom = clock;
    }
    if (fading) {
      fadeU = (clock - fadeFrom) / span.fade;
      if (fadeU >= 1) {
        const carried = span.fade;
        advance();
        clock = carried;
        return frameLayers(sw, sh);
      }
    } else {
      fadeU = 0;
    }

    if (style === "prints") return printLayers(sw, sh, Math.min(clock, span.play));
    if (style === "strip") return stripLayers(sw, sh);

    const layers = [];
    const cur = photos[index];
    const nxt = photos[(index + 1) % photos.length];
    const pose = poseAt(index, Math.min(clock, span.play));
    const fadeEase = fading ? easeDissolve(Math.min(1, fadeU)) : 0;

    if (style === "slide" && fading) {
      const u = easeGlide(fadeU);
      layers.push({
        key: `f-${index}`,
        kind: "frame",
        src: cur.src,
        photo: index,
        opacity: 1,
        z: 2,
        pose,
        slide: -u * sw,
        motionAt: 0,
      });
      layers.push({
        key: `f-${(index + 1) % photos.length}`,
        kind: "frame",
        src: nxt.src,
        photo: (index + 1) % photos.length,
        opacity: 1,
        z: 3,
        pose: { zoom: 1, ax: 0.5, ay: 0.5 },
        slide: (1 - u) * sw,
        motionAt: 0,
      });
      return layers;
    }

    layers.push({
      key: `f-${index}`,
      kind: "frame",
      src: cur.src,
      photo: index,
      opacity: fading ? 1 - fadeEase : 1,
      z: 2,
      pose,
      slide: 0,
      motionAt: Math.min(clock, span.play),
    });
    if (fading) {
      layers.push({
        key: `f-${(index + 1) % photos.length}`,
        kind: "frame",
        src: nxt.src,
        photo: (index + 1) % photos.length,
        opacity: fadeEase,
        z: 3,
        pose: poseAt((index + 1) % photos.length, fadeU * span.fade),
        slide: 0,
        motionAt: fadeU * span.fade,
      });
    }
    return layers;
  }

  function faceLine() {
    if (style !== "portrait") return "";
    const photo = photos[index];
    if (!photo) return "";
    const move = {
      ltr: "left to right",
      rtl: "right to left",
    }[photo.move];
    const zoom = photo.zoom === "out" ? "zoom out" : "zoom in";
    const n = photo.faces.length;
    const g = photo.stops?.length ?? 0;
    let who = "No face";
    if (n === 1) who = "1 face";
    else if (n > 1 && g <= 1) who = `${n} faces · one frame`;
    else if (n > 1) who = `${n} faces`;
    return move ? `${who} · ${move} · ${zoom}` : who;
  }

  const titleEl = document.createElement("div");
  titleEl.className = "nl-hud-title";
  const metaEl = document.createElement("div");
  metaEl.className = "nl-hud-meta";
  const controls = document.createElement("div");
  controls.className = "nl-controls";
  const pauseBtn = document.createElement("button");
  const buttons = [
    ["Prev", () => jump(-1)],
    [pauseBtn, null],
    ["Next", () => jump(1)],
    ["Style", () => cycleStyle(1)],
    ["Speed", () => cycleSpeed()],
    ["Photos", () => openSheet({ pair: photos.length > 0 && !picking })],
  ];
  for (const [label, fn] of buttons) {
    const b = typeof label === "string" ? document.createElement("button") : label;
    b.type = "button";
    if (typeof label === "string") b.textContent = label;
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (b === pauseBtn) {
        paused = !paused;
        bumpHud();
      } else if (fn) fn();
    });
    controls.append(b);
  }
  const row = document.createElement("div");
  row.className = "nl-hud-row";
  row.append(titleEl, metaEl);
  hud.append(row, controls);

  function paintHud() {
    const photo = photos[index];
    const show = performance.now() < hudUntil || paused;
    const faces = faceLine();
    const sig = [
      show ? 1 : 0,
      index,
      photos.length,
      style,
      speed,
      paused ? 1 : 0,
      photo?.title || "",
      faces,
      downloadNote,
      detectorNote,
    ].join("|");
    hud.classList.toggle("is-on", show);
    stage.classList.toggle("is-album", style === "prints" || style === "strip");
    if (sig === hudSig) return;
    hudSig = sig;
    titleEl.replaceChildren();
    for (const text of ["Lustre", REV, styleById(style).label, speed]) {
      const span = document.createElement("span");
      if (text === "Lustre") span.className = "nl-mark";
      if (text === REV) span.className = "nl-rev";
      span.textContent = text;
      titleEl.append(span);
    }
    const bits = [`${index + 1} / ${Math.max(photos.length, 1)}`];
    if (photo) bits.push(photo.title);
    if (paused) bits.push("Paused");
    if (faces) bits.push(faces);
    if (downloadNote) bits.push(downloadNote);
    if (detectorNote) bits.push(detectorNote);
    metaEl.textContent = bits.join("  ·  ");
    pauseBtn.textContent = paused ? "Play" : "Pause";
    stage.classList.toggle("is-album", style === "prints" || style === "strip");
  }

  function tick(now) {
    if (dead) return;
    if (loading) {
      hud.classList.remove("is-on");
      raf = requestAnimationFrame(tick);
      return;
    }
    if (!lastNow) lastNow = now;
    const dt = Math.min(80, now - lastNow);
    lastNow = now;
    if (started && !paused) {
      const node = nodes.get(`f-${index}`);
      const rec = style === "portrait" && useGpu ? motions.get(node) : null;
      if (rec?.anim && !fading) clock = Number(rec.anim.currentTime) || 0;
      else clock += dt;
    }
    if (photos.length) {
      const delta = index - stripPos;
      stripPos += delta * Math.min(1, dt / 320);
    }
    const { sw, sh } = stageSize();
    if (photos.length) {
      const layers = frameLayers(sw, sh);
      const extras = new Set();
      const keep = new Set(layers.map((l) => l.key));
      for (const layer of layers) paintLayer(layer, sw, sh, extras);
      for (const key of extras) keep.add(key);
      retire(keep);
      status.hidden = true;
    }
    paintHud();
    globalThis.__nlBeat?.();
    raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (raf || dead) return;
    lastNow = performance.now();
    raf = requestAnimationFrame(tick);
  }

  const sheet = document.createElement("div");
  sheet.className = "nl-sheet";
  sheet.hidden = true;
  const card = document.createElement("div");
  card.className = "nl-sheet-card";
  const heading = document.createElement("h2");
  const blurb = document.createElement("p");
  blurb.className = "nl-sheet-blurb";
  const qrWrap = document.createElement("div");
  qrWrap.className = "nl-qr";
  qrWrap.hidden = true;
  const qrCanvas = document.createElement("canvas");
  qrCanvas.className = "nl-qr-canvas";
  qrCanvas.setAttribute("aria-label", "Code for this television");
  qrWrap.append(qrCanvas);
  const originLabel = document.createElement("p");
  originLabel.className = "nl-sheet-origin-label";
  originLabel.hidden = true;
  originLabel.textContent = "If Google says origin_mismatch, add this JavaScript origin:";
  const originValue = document.createElement("p");
  originValue.className = "nl-sheet-origin";
  originValue.hidden = true;
  originValue.textContent = location.origin;
  const actions = document.createElement("div");
  actions.className = "nl-sheet-actions";
  const signBtn = document.createElement("button");
  signBtn.type = "button";
  signBtn.textContent = "Sign in on this screen";
  const chooseBtn = document.createElement("button");
  chooseBtn.type = "button";
  chooseBtn.className = "is-primary";
  chooseBtn.textContent = "New code";
  const albumsBtn = document.createElement("button");
  albumsBtn.type = "button";
  albumsBtn.textContent = "Albums";
  const prefsBtn = document.createElement("button");
  prefsBtn.type = "button";
  prefsBtn.textContent = "Preferences";
  const updateBtn = document.createElement("button");
  updateBtn.type = "button";
  updateBtn.hidden = true;
  updateBtn.textContent = "Update";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.hidden = true;
  saveBtn.textContent = "Save album";
  const saverBtn = document.createElement("button");
  saverBtn.type = "button";
  saverBtn.hidden = true;
  saverBtn.textContent = "Start screensaver";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.hidden = true;
  closeBtn.textContent = "Close";
  const note = document.createElement("p");
  note.className = "nl-sheet-note";
  const homeVersion = document.createElement("p");
  homeVersion.className = "nl-home-version";
  homeVersion.textContent = REV;
  actions.append(chooseBtn, albumsBtn, prefsBtn, updateBtn, saverBtn, saveBtn, signBtn, closeBtn);
  const albumPanel = document.createElement("div");
  albumPanel.className = "nl-albums";
  albumPanel.hidden = true;
  const albumBack = document.createElement("button");
  albumBack.type = "button";
  albumBack.textContent = "Back";
  const albumList = document.createElement("div");
  albumList.className = "nl-albums";
  albumPanel.append(albumBack, albumList);
  const prefPanel = document.createElement("div");
  prefPanel.className = "nl-albums";
  prefPanel.hidden = true;
  const prefBack = document.createElement("button");
  prefBack.type = "button";
  prefBack.textContent = "Back";
  const prefLead = document.createElement("p");
  prefLead.className = "nl-albums-empty";
  prefLead.textContent = "Side of the photo";
  const prefChoices = document.createElement("div");
  prefChoices.className = "nl-album-actions";
  const prefVersion = document.createElement("p");
  prefVersion.className = "nl-album-count";
  prefVersion.textContent = `Version ${REV}`;
  const prefUpdate = document.createElement("button");
  prefUpdate.type = "button";
  prefUpdate.textContent = "Check for update";
  const prefNote = document.createElement("p");
  prefNote.className = "nl-albums-empty";
  prefPanel.append(prefBack, prefLead, prefChoices, prefVersion, prefUpdate, prefNote);
  card.append(heading, blurb, qrWrap, actions, albumPanel, prefPanel, note, homeVersion, originLabel, originValue);
  sheet.append(card);
  root.append(sheet);
  sheet.addEventListener("click", (ev) => {
    if (ev.target === sheet) closeSheet();
  });

  function showCode(on, url) {
    if (url) codeUrl = url;
    qrWrap.hidden = !on || albumMode;
    card.classList.toggle("is-code", on && !albumMode);
    if (!on) return;
    drawQr(qrCanvas, url);
  }

  function paintSign() {
    const on = google.signedIn();
    sheet.classList.toggle("is-over", photos.length > 0);
    signBtn.textContent = on ? "Sign out" : "Sign in on this screen";
    signBtn.classList.remove("is-primary");
    chooseBtn.hidden = false;
    chooseBtn.textContent = "New code";
    chooseBtn.classList.add("is-primary");
    closeBtn.hidden = photos.length === 0;
    saveBtn.hidden = photosSaved || !photos.some((photo) => photo.blob);
    saverBtn.hidden = true;
    void screensaverId().then((id) => {
      saverBtn.hidden = !id;
    }).catch(() => {});
    if (savedName && !picking) note.textContent = `Saved as ${savedName}`;
  }

  function phoneCodeUnreachable(err) {
    const text = String(err?.message || err || "");
    return /failed to fetch|networkerror|load failed|network request failed/i.test(text);
  }

  function showError(err) {
    const text = explainGoogleError(err);
    note.textContent = text;
    const origin = /origin/i.test(text);
    originLabel.hidden = !origin;
    originValue.hidden = !origin;
  }

  function visibleControls(rootEl) {
    return [...rootEl.querySelectorAll("button, a, input")].filter((el) => {
      if (el.disabled || el.hidden) return false;
      if (el.closest("[hidden]")) return false;
      return true;
    });
  }

  function sheetControls() {
    return visibleControls(sheet);
  }

  function hudControls() {
    return visibleControls(controls);
  }

  function moveFocus(items, delta) {
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const start = current < 0 ? (delta > 0 ? -1 : 0) : current;
    const next = items[(start + delta + items.length) % items.length];
    next.focus();
    next.scrollIntoView({ block: "nearest" });
  }

  function openSheet(opts = {}) {
    sheetOpen = true;
    sheet.hidden = false;
    paintSign();
    if (photos.length) bumpHud();
    if (opts.pair && !picking) void startPhonePair();
    requestAnimationFrame(() => sheetControls()[0]?.focus());
  }

  function closeSheet(force = false) {
    if (!force && photos.length === 0 && !loading) return;
    sheetOpen = false;
    sheet.hidden = true;
  }

  function albumNameNow() {
    return new Date().toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function holdAwake() {
    navigator.wakeLock?.request("screen").catch(() => {});
    globalThis.lustreStayAwake?.();
  }

  window.addEventListener("lustre-saver-request", () => {
    if (document.visibilityState === "hidden") return;
    if (saverAlbumId) void beginScreensaver();
  });

  function noteActivity() {
    idleAt = performance.now();
  }

  async function persistCurrent(name) {
    const items = photos.filter((photo) => photo.blob).map((photo) => ({
      blob: photo.blob,
      title: photo.title,
      taken: photo.taken || 0,
    }));
    if (!items.length) throw new Error("Nothing to save");
    const album = await saveAlbum(name || albumNameNow(), items);
    photosSaved = true;
    savedName = album.name;
    saveBtn.hidden = true;
    return album;
  }

  async function showPrepared(next, reelName) {
    for (const photo of photos) if (photo.owned) URL.revokeObjectURL(photo.src);
    photos = next;
    index = 0;
    stripPos = 0;
    clock = 0;
    lastNow = 0;
    fading = false;
    fadeU = 0;
    userZoom = 1;
    rebuildKeys();
    status.hidden = true;
    started = true;
    reel = reelName;
    screensaverMode = reelName === "screensaver";
    closeSheet(true);
    bumpHud();
    holdAwake();
    dropMotion();
  }

  function takenMillis(value) {
    const ms = Date.parse(String(value || ""));
    return Number.isFinite(ms) ? ms : 0;
  }

  function takenLabel(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function oldestFirstItems(items) {
    return [...items].sort((a, b) => {
      const ta = takenMillis(a.createTime);
      const tb = takenMillis(b.createTime);
      if (ta && tb && ta !== tb) return ta - tb;
      if (ta && !tb) return -1;
      if (!ta && tb) return 1;
      return 0;
    });
  }

  async function jpegTaken(blob) {
    if (!blob || typeof blob.slice !== "function") return 0;
    let head;
    try {
      head = await blob.slice(0, 65536).arrayBuffer();
    } catch {
      return 0;
    }
    const view = new DataView(head);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 0;
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1) {
        const start = offset + 4;
        if (start + 6 <= view.byteLength) {
          const sig = String.fromCharCode(...new Uint8Array(head, start, 6));
          if (sig.startsWith("Exif")) return exifTaken(view, start + 6);
        }
      }
      if (marker === 0xffda || marker === 0xffd9 || size < 2) break;
      offset += 2 + size;
    }
    return 0;
  }

  function exifTaken(view, tiff) {
    if (tiff + 8 > view.byteLength) return 0;
    const le = view.getUint16(tiff) === 0x4949;
    const u16 = (at) => view.getUint16(at, le);
    const u32 = (at) => view.getUint32(at, le);
    if (u16(tiff + 2) !== 42) return 0;
    const readIfd = (ifd) => {
      const found = { original: "", digitized: "", modified: "", exifPtr: 0 };
      if (ifd < tiff || ifd + 2 > view.byteLength) return found;
      const count = u16(ifd);
      for (let i = 0; i < count; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        const tag = u16(entry);
        const type = u16(entry + 2);
        const num = u32(entry + 4);
        let value = u32(entry + 8);
        if (type === 2 && num > 4) value = tiff + value;
        const text = () => {
          if (type !== 2 || num < 2 || value + num > view.byteLength) return "";
          let out = "";
          for (let c = 0; c < num - 1; c += 1) out += String.fromCharCode(view.getUint8(value + c));
          return out;
        };
        if (tag === 0x9003) found.original = text();
        else if (tag === 0x9004) found.digitized = text();
        else if (tag === 0x0132) found.modified = text();
        else if (tag === 0x8769) found.exifPtr = tiff + u32(entry + 8);
      }
      return found;
    };
    const first = readIfd(tiff + u32(tiff + 4));
    const nested = first.exifPtr ? readIfd(first.exifPtr) : first;
    const raw = nested.original || nested.digitized || first.modified || "";
    const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
    if (!match) return 0;
    const ms = new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  async function oldestFirst(records) {
    const dated = [];
    for (const record of records) {
      let taken = Number(record.taken) || 0;
      if (!taken) taken = await jpegTaken(record.blob);
      dated.push({ ...record, taken });
    }
    dated.sort((a, b) => {
      if (a.taken && b.taken && a.taken !== b.taken) return a.taken - b.taken;
      if (a.taken && !b.taken) return -1;
      if (!a.taken && b.taken) return 1;
      return (a.order || 0) - (b.order || 0);
    });
    return dated;
  }

  async function playStored(id, opts = {}) {
    loading = true;
    started = false;
    status.hidden = false;
    setStatus("Opening the album…");
    let stored;
    try {
      stored = await loadAlbum(id);
    } catch (err) {
      loading = false;
      status.hidden = true;
      openSheet();
      note.textContent = err?.message || "Could not open the album";
      return;
    }
    const records = await oldestFirst(stored.photos || []);
    if (!records.length) {
      loading = false;
      status.hidden = true;
      openSheet();
      note.textContent = "That album is empty.";
      return;
    }
    const next = [];
    const gen = ++prepareGen;
    let shown = false;
    try {
      for (let i = 0; i < records.length; i += 1) {
        if (dead || gen !== prepareGen) break;
        const record = records[i];
        if (!shown) setStatus(`Preparing ${i + 1} of ${records.length}`, i / records.length);
        await yieldFrame();
        const src = URL.createObjectURL(record.blob);
        try {
          const img = await loadImage(src);
          const faces = detector ? await detector.detect(img) : [];
          const photo = {
            src,
            blob: record.blob,
            title: record.title || "Photo",
            date: takenLabel(record.taken),
            taken: record.taken || 0,
            natW: img.naturalWidth,
            natH: img.naturalHeight,
            faces,
            i: next.length,
            owned: true,
          };
          next.push(photo);
          if (!shown) {
            shown = true;
            loading = false;
            currentAlbumId = id;
            photosSaved = true;
            savedName = stored.album?.name || "";
            await showPrepared(next, opts.screensaver ? "screensaver" : "album");
          } else {
            photo.i = photos.length - 1;
            rebuildKeys();
          }
          downloadNote = i + 1 < records.length ? `Loading ${next.length} of ${records.length}` : "";
          hudSig = "";
        } catch {
          URL.revokeObjectURL(src);
        }
      }
    } finally {
      loading = false;
      if (gen === prepareGen) {
        downloadNote = "";
        hudSig = "";
      }
    }
    if (dead || gen !== prepareGen) {
      if (!shown) for (const photo of next) URL.revokeObjectURL(photo.src);
      return;
    }
    if (!shown) {
      status.hidden = true;
      openSheet();
      note.textContent = "Could not open the photos.";
    }
  }

  async function beginScreensaver() {
    const id = await screensaverId().catch(() => "");
    if (!id || dead || loading) return;
    screensaverMode = true;
    if (currentAlbumId === id && photos.length && started) {
      closeSheet(true);
      holdAwake();
      return;
    }
    await playStored(id, { screensaver: true });
  }

  function rowButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    return button;
  }

  async function refreshAlbums() {
    albumList.replaceChildren();
    let albums = [];
    try {
      albums = await listAlbums();
    } catch (err) {
      const empty = document.createElement("p");
      empty.className = "nl-albums-empty";
      empty.textContent = err?.message || "Could not read the albums.";
      albumList.append(empty);
      return;
    }
    saverBtn.hidden = !albums.some((album) => album.screensaver);
    saverAlbumId = albums.find((album) => album.screensaver)?.id || "";
    if (!albums.length) {
      const empty = document.createElement("p");
      empty.className = "nl-albums-empty";
      empty.textContent = "No albums yet. Photos added from the phone are saved here.";
      albumList.append(empty);
      return;
    }
    for (const album of albums) {
      const row = document.createElement("div");
      row.className = "nl-album";
      const title = document.createElement("p");
      title.textContent = album.name;
      const count = document.createElement("p");
      count.className = "nl-album-count";
      count.textContent = `${album.count} ${album.count === 1 ? "photo" : "photos"}`;
      const buttons = document.createElement("div");
      buttons.className = "nl-album-actions";
      const play = rowButton("Play");
      const rename = rowButton("Rename");
      const saver = rowButton(album.screensaver ? "Screensaver on" : "Use as screensaver");
      if (album.screensaver) saver.classList.add("is-on");
      const remove = rowButton("Remove");
      play.addEventListener("click", () => {
        showMenu("");
        void playStored(album.id);
      });
      rename.addEventListener("click", () => {
        if (rename.dataset.arm === "1") {
          void renameAlbum(album.id, title.querySelector("input")?.value || title.textContent).then((saved) => {
            if (currentAlbumId === album.id) savedName = saved.name;
            return refreshAlbums();
          }).catch((err) => {
            note.hidden = false;
            note.textContent = err?.message || "Could not rename the album";
          });
          return;
        }
        const input = document.createElement("input");
        input.className = "nl-album-name";
        input.value = album.name;
        input.maxLength = 80;
        title.textContent = "";
        title.append(input);
        input.focus();
        input.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter") return;
          ev.preventDefault();
          rename.click();
        });
        rename.dataset.arm = "1";
        rename.textContent = "Save";
      });
      saver.addEventListener("click", async () => {
        await setScreensaver(album.screensaver ? "" : album.id);
        saverAlbumId = album.screensaver ? "" : album.id;
        await refreshAlbums();
      });
      remove.addEventListener("click", async () => {
        if (remove.dataset.arm !== "1") {
          remove.dataset.arm = "1";
          remove.textContent = "Remove?";
          return;
        }
        await deleteAlbum(album.id);
        if (currentAlbumId === album.id) currentAlbumId = "";
        await refreshAlbums();
      });
      buttons.append(play, rename, saver, remove);
      row.append(title, count, buttons);
      albumList.append(row);
    }
    albumList.querySelector("button")?.focus();
    if (!albumList.querySelector("button")) albumBack.focus();
  }

  function showMenu(which) {
    albumMode = which !== "";
    albumPanel.hidden = which !== "albums";
    prefPanel.hidden = which !== "prefs";
    actions.hidden = which !== "";
    blurb.hidden = which !== "";
    note.hidden = which !== "";
    homeVersion.hidden = which !== "";
    if (which === "albums") {
      qrWrap.hidden = true;
      heading.textContent = "Albums";
      void refreshAlbums();
      return;
    }
    if (which === "prefs") {
      qrWrap.hidden = true;
      heading.textContent = "Preferences";
      paintPrefs();
      void checkUpdate();
      return;
    }
    heading.textContent = codeUrl ? "Scan with your phone" : "Lustre";
    if (codeUrl) showCode(true, codeUrl);
    paintSign();
    requestAnimationFrame(() => sheetControls()[0]?.focus());
  }

  function applyBlur(id) {
    if (!BLURS.some((item) => item.id === id)) return;
    blurStyle = id;
    stage.dataset.blur = id;
    try {
      localStorage.setItem("lustre.blur", id);
    } catch {
      /* the choice still applies until the television restarts */
    }
    plates.clear();
    paintPrefs();
  }

  function paintPrefs() {
    prefChoices.replaceChildren();
    for (const item of BLURS) {
      const button = rowButton(item.label);
      if (item.id === blurStyle) button.classList.add("is-on");
      button.addEventListener("click", () => applyBlur(item.id));
      prefChoices.append(button);
    }
    prefVersion.textContent = updateOffer ? `Version ${REV} · ${updateOffer.version} is ready` : `Version ${REV}`;
    prefUpdate.textContent = updateOffer ? `Update ${updateOffer.version}` : "Check for update";
    updateBtn.hidden = !updateOffer;
    if (updateOffer) updateBtn.textContent = `Update ${updateOffer.version}`;
    prefChoices.querySelector("button")?.focus();
  }

  function installOffer() {
    if (!updateOffer?.version) {
      prefNote.textContent = "This is the latest version.";
      return;
    }
    prefNote.textContent = "Opening the update…";
    location.reload();
  }

  async function checkUpdate() {
    try {
      const res = await fetch("https://lustre.show/version.json", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      updateOffer = newerVersion(body.version, REV) && body.ipk ? body : null;
    } catch {
      updateOffer = null;
    }
    if (!prefPanel.hidden) paintPrefs();
    else {
      updateBtn.hidden = !updateOffer;
      if (updateOffer) updateBtn.textContent = `Update ${updateOffer.version}`;
    }
  }

  function showAlbumList(on) {
    showMenu(on ? "albums" : "");
  }

  function placePhoto(photo) {
    const aspect = stageAspect();
    photo.stops = buildStops(photo.faces, photo.natW, photo.natH, aspect);
    photo.keys = portraitKeys(photo.stops, photo.i, photo.natW, photo.natH, aspect);
    photo.move = photo.keys.move;
    photo.full = photo.keys.full;
  }

  signBtn.addEventListener("click", () => {
    if (google.signedIn()) {
      pickGen += 1;
      cancelPick();
      picking = false;
      google.signOut();
      paintSign();
      void startPhonePair();
      return;
    }
    note.textContent = "Opening Google…";
    originLabel.hidden = true;
    originValue.hidden = true;
    google.signIn().then(() => {
      paintSign();
      note.textContent = "Signed in on this screen.";
      void startPick();
    }).catch((err) => {
      showError(err);
    });
  });

  closeBtn.addEventListener("click", () => closeSheet(true));
  let picking = false;
  let pickGen = 0;

  chooseBtn.addEventListener("click", () => {
    showAlbumList(false);
    void startPhonePair();
  });
  albumsBtn.addEventListener("click", () => showAlbumList(true));
  albumBack.addEventListener("click", () => showAlbumList(false));
  prefsBtn.addEventListener("click", () => showMenu("prefs"));
  prefBack.addEventListener("click", () => showMenu(""));
  prefUpdate.addEventListener("click", () => installOffer());
  updateBtn.addEventListener("click", () => {
    showMenu("prefs");
    installOffer();
  });
  saveBtn.addEventListener("click", () => {
    saveBtn.textContent = "Saving…";
    persistCurrent().then(() => {
      saveBtn.textContent = "Save album";
      note.textContent = `Saved as ${savedName}`;
    }).catch((err) => {
      saveBtn.textContent = "Save album";
      note.textContent = err?.message || "Could not save the album";
    });
  });
  saverBtn.addEventListener("click", () => {
    void beginScreensaver();
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const LUSTRE_SITE = "https://lustre.show";

  async function createPhoneCode() {
    const here = location.origin && location.origin !== "null" ? location.origin : "";
    if (here) {
      try {
        const created = await fetch("/api/pair", { method: "POST" });
        if (created.ok) {
          const body = await created.json();
          if (body.id) return { id: body.id, origin: here };
        }
      } catch {
        /* this television has no code service of its own */
      }
    }
    if (here === LUSTRE_SITE) throw new Error("This screen can't make a phone code. Use Sign in on this screen.");
    const created = await fetch(`${LUSTRE_SITE}/api/pair`, { method: "POST" });
    if (!created.ok) throw new Error("This screen can't make a phone code. Use Sign in on this screen.");
    const body = await created.json();
    if (!body.id) throw new Error("Could not make a code.");
    return { id: body.id, origin: LUSTRE_SITE };
  }

  async function startPhonePair() {
    const gen = ++pickGen;
    cancelPick();
    let stopped = false;
    cancelPick = () => {
      stopped = true;
    };
    picking = true;
    showCode(false);
    heading.textContent = "Scan with your phone";
    blurb.textContent = "Sign in on the phone, not on the television. Then search the album name, select the photos, and press Done. Google sends those photos only, not the whole album.";
    note.textContent = "Making a code for this television…";
    chooseBtn.textContent = "Please wait";
    try {
      const { id, origin } = await createPhoneCode();
      if (gen !== pickGen || stopped || dead) return;
      const url = `${origin}/tv/pair.html?code=${encodeURIComponent(id)}`;
      showCode(true, url);
      chooseBtn.textContent = "New code";
      const local = /^(localhost|127\.0\.0\.1)$/i.test(new URL(origin).hostname);
      note.textContent = local
        ? "This address is only on this computer, so the phone cannot open it. Use Sign in on this screen."
        : "Waiting for the phone.";
      const open = [];
      let shown = { id, origin };
      const poll = async (pair) => {
        const res = await fetch(`${pair.origin}/api/pair?id=${encodeURIComponent(pair.id)}`, { cache: "no-store" });
        return res.json().catch(() => ({}));
      };
      const finish = async (pair, data) => {
        google.adopt(data.token, data.expiresIn);
        google.useSite(pair.origin);
        note.textContent = "Loading the photos…";
        const items = await google.collect(data.sessionId, (text) => {
          if (gen === pickGen) note.textContent = quietStatus(text);
        });
        if (gen !== pickGen || stopped || dead) return;
        picking = false;
        if (!items.length) {
          note.textContent = "No photos were selected.";
          return;
        }
        closeSheet(true);
        void takeGoogleItems(items);
      };
      while (gen === pickGen && !stopped && !dead) {
        await sleep(2000);
        if (gen !== pickGen || stopped || dead) return;
        for (const pair of open) {
          const data = await poll(pair);
          if (gen !== pickGen || stopped || dead) return;
          if (data.status === "error") throw new Error(data.error || "The phone sign-in failed.");
          if (data.status === "done") {
            await finish(pair, data);
            return;
          }
        }
        const data = await poll(shown);
        if (gen !== pickGen || stopped || dead) return;
        if (data.status === "error") throw new Error(data.error || "The phone sign-in failed.");
        if (data.status === "done") {
          await finish(shown, data);
          return;
        }
        if (data.status !== "picking" && data.status !== "scanned") continue;
        try {
          const next = await createPhoneCode();
          if (gen !== pickGen || stopped || dead) return;
          open.push(shown);
          shown = next;
          showCode(true, `${shown.origin}/tv/pair.html?code=${encodeURIComponent(shown.id)}`);
          note.textContent = "Scanned. A new code is ready.";
        } catch {
          note.textContent = "Phone connected. Finish selecting the photos.";
        }
      }
    } catch (err) {
      if (gen !== pickGen || dead) return;
      picking = false;
      chooseBtn.textContent = "New code";
      if (phoneCodeUnreachable(err)) {
        note.textContent = "This screen can't reach Lustre to make a phone code. Use Sign in on this screen, or open the published Lustre site.";
        return;
      }
      note.textContent = err?.message || "Could not make a code.";
    }
  }

  async function startPick() {
    const gen = ++pickGen;
    cancelPick();
    picking = true;
    chooseBtn.textContent = "Please wait";
    showCode(false);
    heading.textContent = "Lustre";
    blurb.textContent = "Making a code for this television.";
    note.textContent = "Making a code for this television…";
    try {
      if (!google.signedIn()) await google.signIn();
      if (gen !== pickGen || dead) return;
      paintSign();
      chooseBtn.textContent = "Please wait";
      const watch = google.beginPick(({ show }) => {
        if (gen !== pickGen) return;
        heading.textContent = "Scan with your phone";
        blurb.textContent = "Use the phone signed in to this Google account. Search the album name, select the photos, and press Done. Google sends those photos only, not the whole album.";
        showCode(true, show);
        note.textContent = "Waiting for Done in Google Photos.";
        chooseBtn.textContent = "New code";
      }, () => false, (text) => {
        if (gen !== pickGen) return;
        note.textContent = quietStatus(text);
        if (text.startsWith("Saved, but")) chooseBtn.textContent = "Try again";
      }, (items) => {
        if (gen !== pickGen) return;
        picking = false;
        closeSheet(true);
        void takeGoogleItems(items);
      });
      cancelPick = () => {
        watch.cancel();
        if (pickGen === gen) picking = false;
      };
      const result = await watch.done;
      if (gen !== pickGen || dead) return;
      picking = false;
      chooseBtn.textContent = "New code";
      if (!result || result.cancelled) return;
      const images = (result.items || []).filter(
        (item) => item.mediaFile?.baseUrl && (item.mediaFile.mimeType || "").startsWith("image/"),
      );
      if (!images.length) {
        note.textContent = "No photos were selected.";
        openSheet();
        return;
      }
      closeSheet(true);
      void takeGoogleItems(images);
    } catch (err) {
      if (gen !== pickGen || dead) return;
      picking = false;
      chooseBtn.textContent = "Try again";
      showError(err);
      openSheet();
    }
  }

  function yieldFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function clearStage() {
    for (const node of nodes.values()) node.remove();
    nodes.clear();
  }

  async function takeGoogleItems(images) {
    images = oldestFirstItems(images);
    reel = "google";
    started = false;
    loading = true;
    clock = 0;
    fading = false;
    fadeU = 0;
    downloadNote = "";
    for (const p of photos) if (p.owned) URL.revokeObjectURL(p.src);
    photos = [];
    index = 0;
    clearStage();
    status.hidden = false;
    const next = [];
    let failed = 0;
    let shown = false;
    const gen = ++prepareGen;
    const blobs = new Array(images.length);
    const errors = new Array(images.length);
    let launch = 0;
    const running = [];

    function fillDownloads() {
      while (launch < images.length && running.length < 3) {
        const i = launch++;
        const url = images[i]?.mediaFile?.baseUrl;
        const job = (url ? google.download(url) : Promise.reject(new Error("Missing photo")))
          .then(
            (blob) => {
              blobs[i] = blob;
            },
            (err) => {
              errors[i] = err;
            },
          )
          .finally(() => {
            const at = running.indexOf(job);
            if (at >= 0) running.splice(at, 1);
          });
        running.push(job);
      }
    }

    async function blobAt(i) {
      while (blobs[i] === undefined && errors[i] === undefined) {
        if (dead || gen !== prepareGen || reel !== "google") return null;
        fillDownloads();
        if (running.length) await Promise.race(running);
        else await yieldFrame();
      }
      if (errors[i]) throw errors[i];
      return blobs[i];
    }

    try {
      for (let i = 0; i < images.length; i++) {
        if (reel !== "google" || dead || gen !== prepareGen) break;
        const item = images[i];
        const fileInfo = item.mediaFile;
        if (!shown) setStatus(`Loading ${i + 1} of ${images.length}`, i / images.length);
        await yieldFrame();
        let src = "";
        try {
          const blob = await blobAt(i);
          if (!blob || reel !== "google" || dead || gen !== prepareGen) break;
          src = URL.createObjectURL(blob);
          const img = await loadImage(src);
          if (!shown) setStatus(`Preparing ${i + 1} of ${images.length}`, (i + 0.5) / images.length);
          await yieldFrame();
          const faces = detector ? await detector.detect(img) : [];
          const photo = {
            src,
            blob,
            title: (fileInfo.filename || "Photo").replace(/\.[^.]+$/, ""),
            taken: takenMillis(item.createTime),
            date: item.createTime
              ? new Date(item.createTime).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "",
            natW: img.naturalWidth,
            natH: img.naturalHeight,
            faces,
            i: next.length,
            owned: true,
          };
          next.push(photo);
          if (!shown) {
            shown = true;
            loading = false;
            photos = next;
            index = 0;
            stripPos = 0;
            clock = 0;
            lastNow = 0;
            fading = false;
            fadeU = 0;
            rebuildKeys();
            status.hidden = true;
            started = true;
            photosSaved = false;
            currentAlbumId = "";
            screensaverMode = false;
            bumpHud();
            holdAwake();
            dropMotion();
          } else {
            photo.i = photos.length - 1;
            rebuildKeys();
          }
          downloadNote = i + 1 < images.length ? `Loading ${next.length} of ${images.length}` : "";
          hudSig = "";
        } catch (err) {
          failed += 1;
          downloadNote = /fetch/i.test(String(err?.message || err))
            ? "Google blocked the download"
            : "Download failed";
          hudSig = "";
          if (src) URL.revokeObjectURL(src);
        }
      }
    } finally {
      loading = false;
    }
    if (reel !== "google" || dead || gen !== prepareGen) {
      if (!shown) for (const p of next) URL.revokeObjectURL(p.src);
      return;
    }
    if (!shown) {
      status.hidden = true;
      openSheet();
      note.textContent = downloadNote || "Could not download the photos";
      return;
    }
    downloadNote = failed ? `${failed} did not download` : "";
    hudSig = "";
    void persistCurrent().then(() => {
      note.textContent = `Saved as ${savedName}`;
    }).catch((err) => {
      photosSaved = false;
      savedName = "";
      note.textContent = err?.message || "Could not save the album";
    });
  }

  let detector = null;
  let booted = false;
  let launchToken = readLaunchAlbum();

  function albumToken(value) {
    if (value == null) return "";
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return albumToken(JSON.parse(trimmed));
        } catch {
          return trimmed;
        }
      }
      return trimmed;
    }
    if (typeof value !== "object") return "";
    const direct = value.album || value.albumId || value.albumName || value.contentId;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (value.params) return albumToken(value.params);
    return "";
  }

  function readLaunchAlbum() {
    const bags = [];
    try {
      if (typeof PalmSystem !== "undefined" && PalmSystem.launchParams) bags.push(PalmSystem.launchParams);
    } catch {
      /* the television kept the launch private */
    }
    try {
      if (globalThis.webOS?.launchParams) bags.push(globalThis.webOS.launchParams);
    } catch {
      /* older televisions omit this */
    }
    try {
      const query = new URLSearchParams(location.search);
      const named = query.get("album") || query.get("albumId");
      if (named) bags.push({ album: named });
    } catch {
      /* a packaged app has no query string */
    }
    for (const bag of bags) {
      const token = albumToken(bag);
      if (token) return token;
    }
    return "";
  }

  async function playLaunchAlbum(token) {
    let albums = [];
    try {
      albums = await listAlbums();
    } catch (err) {
      openSheet();
      note.textContent = err?.message || "Could not read the albums.";
      return;
    }
    const want = token.trim().toLowerCase();
    const album = albums.find((item) => item.id === token)
      || albums.find((item) => item.name.trim().toLowerCase() === want);
    if (!album) {
      openSheet();
      note.textContent = `No album named "${token}".`;
      return;
    }
    await playStored(album.id);
  }

  async function boot() {
    try {
      await loadScript(base + "js/pico.js");
      detector = await createDetector(base + "facefinder.bin");
    } catch {
      detectorNote = "Faces off";
    }
    if (dead) return;
    holdAwake();
    void checkUpdate();
    const saver = await screensaverId().catch(() => "");
    saverAlbumId = saver || "";
    booted = true;
    const requested = launchToken || readLaunchAlbum();
    if (requested) {
      await playLaunchAlbum(requested);
      return;
    }
    if (saver) {
      await playStored(saver, { screensaver: true });
      if (started) return;
    }
    openSheet({ pair: true });
  }

  document.addEventListener("webOSRelaunch", () => {
    const next = readLaunchAlbum();
    if (!next || dead) return;
    launchToken = next;
    if (!booted) return;
    void playLaunchAlbum(next);
  }, true);

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keydown", noteActivity, true);
  window.addEventListener("pointerdown", noteActivity, true);
  window.addEventListener("resize", () => {
    stageW = 0;
    stageH = 0;
    dropMotion();
    rebuildKeys();
  });
  stage.addEventListener("pointerdown", () => bumpHud());
  stage.addEventListener("pointermove", () => bumpHud());
  setInterval(() => {
    if (dead || loading || screensaverMode || !sheetOpen) return;
    if (performance.now() - idleAt < 3 * 60 * 1000) return;
    noteActivity();
    void beginScreensaver();
  }, 20000);
  startLoop();

  boot().catch((err) => {
    status.hidden = false;
    setStatus(err?.message || "Could not start");
  });

  return () => {
    dead = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    for (const p of photos) if (p.owned) URL.revokeObjectURL(p.src);
    cancelPick();
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (globalThis.pico?.unpack_cascade) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Face reader failed to load"));
    document.head.append(s);
  });
}
