/** Face boxes in the original image's pixel space. YuNet first, pico if that cannot load. */

const STRIDES = [8, 16, 32];
const SCORE = 0.78;

function rgbaToGray(rgba, nrows, ncols) {
  const gray = new Uint8Array(nrows * ncols);
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      const i = r * 4 * ncols + 4 * c;
      gray[r * ncols + c] = (2 * rgba[i] + 7 * rgba[i + 1] + rgba[i + 2]) / 10;
    }
  }
  return gray;
}

function overlap(a, b) {
  const overr = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2));
  const overc = Math.max(0, Math.min(a[1] + a[2] / 2, b[1] + b[2] / 2) - Math.max(a[1] - a[2] / 2, b[1] - b[2] / 2));
  const denom = a[2] * a[2] + b[2] * b[2] - overr * overc;
  return denom > 0 ? (overr * overc) / denom : 0;
}

function clusterMax(dets) {
  const order = dets.map((_, i) => i).sort((i, j) => dets[j][3] - dets[i][3]);
  const used = new Array(dets.length).fill(false);
  const groups = [];
  for (const i of order) {
    if (used[i]) continue;
    let row = 0;
    let col = 0;
    let size = 0;
    let maxQ = 0;
    let n = 0;
    for (let j = 0; j < dets.length; j++) {
      if (used[j]) continue;
      if (j !== i && overlap(dets[i], dets[j]) <= 0.2) continue;
      used[j] = true;
      row += dets[j][0];
      col += dets[j][1];
      size += dets[j][2];
      if (dets[j][3] > maxQ) maxQ = dets[j][3];
      n += 1;
    }
    groups.push([row / n, col / n, size / n, maxQ, n]);
  }
  return groups;
}

function boxIou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function samePerson(a, b) {
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  const limit = 0.5 * Math.max(a.w, a.h, b.w, b.h);
  return dx * dx + dy * dy < limit * limit;
}

function keepSubjects(faces) {
  const merged = [];
  for (const face of faces) {
    if (merged.some((kept) => samePerson(kept, face))) continue;
    merged.push(face);
  }
  if (!merged.length) return [];
  const largest = merged.reduce((max, face) => Math.max(max, face.w * face.h), 0);
  return merged.filter((face) => {
    const area = face.w * face.h;
    if (area >= largest * 0.18) return true;
    return face.q >= 90 && area >= largest * 0.08;
  });
}
function nms(dets) {
  dets.sort((a, b) => b.q - a.q);
  const kept = [];
  for (const det of dets) {
    if (kept.some((k) => boxIou(k, det) > 0.3)) continue;
    kept.push(det);
  }
  return kept;
}

function ridgeAt(gray, gw, gh, axis, pos, cross, toward, depth, bright, gap) {
  let inner;
  let outer;
  let value;
  let inn;
  let out;
  if (axis === "v") {
    inner = pos + toward * depth;
    outer = pos - toward * depth;
    if (pos < 0 || pos >= gw || cross < 0 || cross >= gh || inner < 0 || inner >= gw || outer < 0 || outer >= gw) return false;
    value = gray[cross * gw + pos];
    inn = gray[cross * gw + inner];
    out = gray[cross * gw + outer];
  } else {
    inner = pos + toward * depth;
    outer = pos - toward * depth;
    if (pos < 0 || pos >= gh || cross < 0 || cross >= gw || inner < 0 || inner >= gh || outer < 0 || outer >= gh) return false;
    value = gray[pos * gw + cross];
    inn = gray[inner * gw + cross];
    out = gray[outer * gw + cross];
  }
  return bright ? value > inn + gap && value > out + gap : value < inn - gap && value < out - gap;
}

function railCandidates(gray, gw, gh, face, name) {
  const x0 = face.x;
  const y0 = face.y;
  const x1 = x0 + face.w;
  const y1 = y0 + face.h;
  const size = Math.max(face.w, face.h);
  const minD = Math.max(6, (size * 0.12) | 0);
  const maxD = Math.min(size * 8, Math.max(gw, gh) * 0.92) | 0;
  const vertical = name === "left" || name === "right";
  let start;
  let end;
  let step;
  let toward;
  if (name === "left") {
    start = (x0 - minD) | 0;
    end = Math.max(6, (x0 - maxD) | 0);
    step = -2;
    toward = 1;
  } else if (name === "right") {
    start = (x1 + minD) | 0;
    end = Math.min(gw - 7, (x1 + maxD) | 0);
    step = 2;
    toward = -1;
  } else if (name === "top") {
    start = (y0 - minD) | 0;
    end = Math.max(6, (y0 - maxD) | 0);
    step = -2;
    toward = 1;
  } else {
    start = (y1 + minD) | 0;
    end = Math.min(gh - 7, (y1 + maxD) | 0);
    step = 2;
    toward = -1;
  }
  const a = vertical
    ? Math.max(0, Math.min(gh - 1, (y0 + face.h * 0.2) | 0))
    : Math.max(0, Math.min(gw - 1, (x0 + face.w * 0.2) | 0));
  const b = vertical
    ? Math.max(a + 4, Math.min(gh, (y0 + face.h * 0.8) | 0))
    : Math.max(a + 4, Math.min(gw, (x0 + face.w * 0.8) | 0));
  const raw = [];
  for (let pos = start; step < 0 ? pos >= end : pos <= end; pos += step) {
    let best = 0;
    let depth = 12;
    let bright = true;
    for (let d = 0; d < 3; d++) {
      const tryDepth = d === 0 ? 12 : d === 1 ? 20 : 30;
      for (let p = 0; p < 2; p++) {
        const tryBright = p === 0;
        let hit = 0;
        for (let c = a; c < b; c++) {
          if (ridgeAt(gray, gw, gh, vertical ? "v" : "h", pos, c, toward, tryDepth, tryBright, 16)) hit += 1;
        }
        const frac = (b - a) > 0 ? hit / (b - a) : 0;
        if (frac > best) {
          best = frac;
          depth = tryDepth;
          bright = tryBright;
        }
      }
    }
    if (best >= 0.55) raw.push({ frac: best, at: pos, depth, bright, toward });
  }
  raw.sort((p, q) => q.frac - p.frac);
  const peaks = [];
  for (let i = 0; i < raw.length; i++) {
    if (peaks.some((kept) => Math.abs(kept.at - raw[i].at) < 12)) continue;
    peaks.push(raw[i]);
    if (peaks.length >= 4) break;
  }
  return { peaks, vertical, toward };
}

function bestRail(gray, gw, gh, face, name) {
  const found = railCandidates(gray, gw, gh, face, name);
  const axis = found.vertical ? "v" : "h";
  const mid = found.vertical ? face.y + face.h / 2 : face.x + face.w / 2;
  let best = null;
  for (let i = 0; i < found.peaks.length; i++) {
    const peak = found.peaks[i];
    const back = traceFrame(gray, gw, gh, axis, peak.at, mid, peak.toward, peak.depth, peak.bright, -1);
    const fore = traceFrame(gray, gw, gh, axis, peak.at, mid, peak.toward, peak.depth, peak.bright, 1);
    const values = [];
    for (let p = back.length - 1; p >= 0; p--) values.push(back[p]);
    for (let p = 0; p < fore.length; p++) values.push(fore[p]);
    const fit = lineScatter(values);
    const straight = fit.rms <= 3 ? fit.length : 0;
    if (!best || straight > best.straight) best = { straight, at: peak.at };
  }
  return best;
}

/** A face sitting inside a picture frame, not a person in the room. */
function insidePictureFrame(gray, gw, gh, face) {
  if (face.w < 8 || face.h < 8) return false;
  const left = bestRail(gray, gw, gh, face, "left");
  const right = bestRail(gray, gw, gh, face, "right");
  if (!left || !right) return false;
  if (left.at < gw * 0.04 || right.at > gw * 0.96) return false;
  const needV = Math.max(face.h * 2.2, 140);
  if (left.straight < needV || right.straight < needV) return false;
  if (left.at > face.x - 4 || right.at < face.x + face.w + 4) return false;
  const width = right.at - left.at;
  if (width < face.w * 1.8 || width > gw * 0.55) return false;
  if (face.h > Math.min(left.straight, right.straight) * 0.42) return false;
  const span = width * 0.62;
  const top = bestRail(gray, gw, gh, face, "top");
  const bottom = bestRail(gray, gw, gh, face, "bottom");
  const topOk = top && top.straight >= span && top.at < face.y - 3;
  const bottomOk = bottom && bottom.straight >= span && bottom.at > face.y + face.h + 3;
  return topOk || bottomOk;
}

function traceFrame(gray, gw, gh, axis, pos, mid, toward, depth, bright, dir) {
  const limit = axis === "v" ? gh : gw;
  const pts = [];
  let cursor = pos;
  let cross = mid | 0;
  let miss = 0;
  const nudge = [0, -1, 1, -2, 2, -3, 3, -4, 4];
  while (cross >= 0 && cross < limit) {
    let found = null;
    for (let i = 0; i < nudge.length; i++) {
      const next = cursor + nudge[i];
      if (ridgeAt(gray, gw, gh, axis, next, cross, toward, depth, bright, 12)) {
        found = next;
        break;
      }
    }
    if (found == null) {
      miss += 1;
      if (miss > 5) break;
    } else {
      miss = 0;
      cursor = found;
      pts.push(cursor);
    }
    cross += dir;
  }
  return pts;
}

function lineScatter(values) {
  const n = values.length;
  if (n < 12) return { length: 0, rms: 99 };
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXX += i * i;
    sumXY += i * values[i];
  }
  const denom = n * sumXX - sumX * sumX || 1;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  let err = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - (slope * i + intercept);
    err += d * d;
  }
  return { length: n, rms: Math.sqrt(err / n) };
}

function dropFramedFaces(faces, gray, gw, gh, natW, natH) {
  if (!faces.length || !gray || !gw || !gh) return faces;
  return faces.filter((face) => {
    const box = {
      x: (face.x / natW) * gw,
      y: (face.y / natH) * gh,
      w: (face.w / natW) * gw,
      h: (face.h / natH) * gh,
    };
    return !insidePictureFrame(gray, gw, gh, box);
  });
}

function photoLuma(rgba, stride, dw, dh) {
  const gray = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = (y * stride + x) * 4;
      gray[y * dw + x] = (2 * rgba[i] + 7 * rgba[i + 1] + rgba[i + 2]) / 10;
    }
  }
  return gray;
}

function readFaces(outputs, padW, padH, dw, dh, natW, natH) {
  const faces = [];
  for (const stride of STRIDES) {
    const cols = padW / stride;
    const rows = padH / stride;
    const cls = outputs[`cls_${stride}`].data;
    const obj = outputs[`obj_${stride}`].data;
    const bbox = outputs[`bbox_${stride}`].data;
    const count = rows * cols;
    for (let i = 0; i < count; i++) {
      const clsScore = cls[i];
      const objScore = obj[i];
      if (clsScore <= 0 || objScore <= 0) continue;
      const score = Math.sqrt(Math.min(clsScore, 1) * Math.min(objScore, 1));
      if (score < SCORE) continue;
      const row = (i / cols) | 0;
      const col = i - row * cols;
      const b = i * 4;
      const cx = (col + bbox[b]) * stride;
      const cy = (row + bbox[b + 1]) * stride;
      const bw = Math.exp(bbox[b + 2]) * stride;
      const bh = Math.exp(bbox[b + 3]) * stride;
      if (bw < 8 || bh < 8) continue;
      faces.push({
        x: ((cx - bw / 2) / dw) * natW,
        y: ((cy - bh / 2) / dh) * natH,
        w: (bw / dw) * natW,
        h: (bh / dh) * natH,
        q: score * 100,
      });
    }
  }
  return keepSubjects(nms(faces));
}

async function createYunet(cascadeUrl) {
  const root = new URL(cascadeUrl, window.location.href);
  const modelUrl = new URL("yunet.onnx", root).href;
  const wasmDir = new URL("ort/", root).href;
  const ort = await import(new URL("ort/ort.wasm.min.js", root).href);
  ort.env.wasm.wasmPaths = wasmDir;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  async function detect(img) {
    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    if (!natW || !natH) return [];
    const side = 640;
    const fit = side / Math.max(natW, natH);
    const dw = Math.max(1, Math.round(natW * fit));
    const dh = Math.max(1, Math.round(natH * fit));
    canvas.width = side;
    canvas.height = side;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(img, 0, 0, dw, dh);
    const rgba = ctx.getImageData(0, 0, side, side).data;
    const data = new Float32Array(3 * side * side);
    const plane = side * side;
    for (let p = 0, i = 0; p < plane; p++, i += 4) {
      data[p] = rgba[i + 2];
      data[plane + p] = rgba[i + 1];
      data[plane * 2 + p] = rgba[i];
    }
    const outputs = await session.run({
      input: new ort.Tensor("float32", data, [1, 3, side, side]),
    });
    return dropFramedFaces(readFaces(outputs, side, side, dw, dh, natW, natH), photoLuma(rgba, side, dw, dh), dw, dh, natW, natH);
  }

  return { detect };
}

async function createPico(cascadeUrl) {
  const pico = globalThis.pico;
  if (!pico || typeof pico.unpack_cascade !== "function") {
    throw new Error("Face reader failed to load");
  }
  const res = await fetch(cascadeUrl);
  if (!res.ok) throw new Error("Face cascade missing");
  const bytes = new Int8Array(await res.arrayBuffer());
  const classify = pico.unpack_cascade(bytes);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function detect(img) {
    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    if (!natW || !natH) return [];
    const maxW = 1100;
    const scale = Math.min(1, maxW / natW);
    const dw = Math.max(2, Math.round(natW * scale));
    const dh = Math.max(2, Math.round(natH * scale));
    canvas.width = dw;
    canvas.height = dh;
    ctx.drawImage(img, 0, 0, dw, dh);
    const rgba = ctx.getImageData(0, 0, dw, dh).data;
    const image = {
      pixels: rgbaToGray(rgba, dh, dw),
      nrows: dh,
      ncols: dw,
      ldim: dw,
    };
    const dets = clusterMax(
      pico.run_cascade(image, classify, {
        shiftfactor: 0.08,
        minsize: 18,
        maxsize: Math.max(dw, dh),
        scalefactor: 1.08,
      }),
    );
    const faces = [];
    const minArea = natW * natH * 0.0005;
    for (const d of dets) {
      const q = d[3];
      const hits = d[4];
      if (q < 5 || hits < 2) continue;
      const size = d[2];
      const w = (size / dw) * natW;
      const h = (size / dh) * natH;
      if (w * h < minArea) continue;
      faces.push({
        x: ((d[1] - size / 2) / dw) * natW,
        y: ((d[0] - size / 2) / dh) * natH,
        w,
        h,
        q,
      });
    }
    return dropFramedFaces(faces, image.pixels, dw, dh, natW, natH);
  }

  return { detect };
}

export async function createDetector(cascadeUrl) {
  try {
    return await createYunet(cascadeUrl);
  } catch (err) {
    console.warn("YuNet unavailable, using the smaller reader", err);
    return createPico(cascadeUrl);
  }
}
