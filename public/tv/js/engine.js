/**
 * Face-aware slideshow camera.
 * Detection is separate. This module only groups boxes, scores them,
 * and turns them into a timed zoom/pan.
 *
 * Coordinates of faces are pixels, origin top-left of the oriented image.
 * Zoom 1 is "contain" (whole photo, bars allowed). Higher zoom fills the
 * screen around an anchor that is a fraction of the image (0..1).
 */

export const MAX_ZOOM = 2.8;
export const SPEED = { fast: 0.6, normal: 1, slow: 1.7 };

export const STYLES = [
  { id: "still", label: "Still" },
  { id: "slide", label: "Slide" },
  { id: "portrait", label: "Portrait" },
  { id: "prints", label: "Prints" },
  { id: "strip", label: "Strip" },
];

const HOLD = {
  settle: 1500,
  zoomIn: 6000,
  hold: 1600,
  pan: 5200,
  midHold: 900,
  zoomOut: 6000,
  ken: 8000,
  still: 5200,
  fade: 3000,
  slideMove: 900,
  prints: 5600,
  drop: 900,
  restLandscape: 2000,
  restPortrait: 1400,
};

/** A photo, including the fade into the next one, never runs longer than this. */
const MAX_SHOT = 20000;

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, u) {
  return a + (b - a) * u;
}

/**
 * Almost constant speed. A short soft start, a long even cruise, a short soft stop.
 * The old curve rushed through the middle at nearly twice the average speed.
 */
export function easeGlide(u) {
  const t = clamp(u, 0, 1);
  const a = 0.12;
  const norm = 1 - a;
  const up = (x) => x / 2 - Math.sin(Math.PI * x) / (2 * Math.PI);
  const down = (x) => x / 2 + Math.sin(Math.PI * x) / (2 * Math.PI);
  let area;
  if (t <= a) area = a * up(t / a);
  else if (t >= 1 - a) area = a * 0.5 + (1 - 2 * a) + a * down((t - (1 - a)) / a);
  else area = a * 0.5 + (t - a);
  return area / norm;
}

/** Soft dissolve. Slow to leave, slow to arrive. */
export function easeDissolve(u) {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

function unionRect(rects) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function clampRect(r, natW, natH) {
  let { x, y, w, h } = r;
  if (w > natW) {
    x = 0;
    w = natW;
  } else {
    x = clamp(x, 0, natW - w);
  }
  if (h > natH) {
    y = 0;
    h = natH;
  } else {
    y = clamp(y, 0, natH - h);
  }
  return { x, y, w, h };
}

/** More padding on small faces, extra room below the chin (chest-up). */
export function padFace(f, natW, natH) {
  const areaFrac = (f.w * f.h) / (natW * natH);
  const k = clamp(0.16 / Math.sqrt(Math.max(areaFrac, 0.0015)), 0.45, 1.45);
  const padX = f.w * 0.38 * k;
  const padTop = f.h * 0.62 * k;
  const padBot = f.h * 0.85 * k;
  return {
    x: f.x - padX,
    y: f.y - padTop,
    w: f.w + padX * 2,
    h: f.h + padTop + padBot,
  };
}

/**
 * Group faces that overlap or whose centers are within 1.5 face-sizes.
 * Drops weak and tiny boxes. Drops a small face parked in the outer margin.
 */
export function clusterFaces(faces, natW, natH) {
  const kept = [];
  for (const f of faces) {
    if (!f || f.q < 5) continue;
    const area = (f.w * f.h) / (natW * natH);
    if (area < 0.00022) continue;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const edge =
      cx < natW * 0.03 ||
      cx > natW * 0.97 ||
      cy < natH * 0.03 ||
      cy > natH * 0.97;
    if (edge && f.w < natW * 0.08) continue;
    kept.push(f);
  }

  const parent = kept.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (i, j) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  };

  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i];
      const b = kept[j];
      const dx = a.x + a.w / 2 - (b.x + b.w / 2);
      const dy = a.y + a.h / 2 - (b.y + b.h / 2);
      const dist = Math.hypot(dx, dy);
      const avg = (Math.max(a.w, a.h) + Math.max(b.w, b.h)) / 2;
      if (dist < avg * 0.45) unite(i, j);
    }
  }

  const buckets = new Map();
  kept.forEach((f, i) => {
    const id = find(i);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(f);
  });

  const groups = [];
  for (const members of buckets.values()) {
    const box = unionRect(members.map((f) => padFace(f, natW, natH)));
    const S = box.w * box.h;
    const N = members.length;
    const score = S * 1 + N * natW * natH * 0.04;
    const cx = members.reduce((s, f) => s + f.x + f.w / 2, 0) / members.length;
    groups.push({ faces: members, box, score, cx });
  }

  groups.sort((a, b) => b.score - a.score);
  if (groups.length >= 2 && groups[0].score < groups[1].score * 1.8) {
    groups.sort((a, b) => a.cx - b.cx);
  }
  return groups;
}

function fitScale(natW, natH, aspect) {
  const sw = aspect;
  const sh = 1;
  return Math.min(sw / natW, sh / natH);
}

function visibleSize(z, natW, natH, aspect) {
  const fit = fitScale(natW, natH, aspect);
  return { visW: aspect / (fit * z), visH: 1 / (fit * z) };
}

function zoomForRect(rect, natW, natH, aspect) {
  const fit = fitScale(natW, natH, aspect);
  const zW = aspect / (fit * rect.w);
  const zH = 1 / (fit * rect.h);
  return Math.max(zW, zH);
}

function frameRect(rect, natW, natH, aspect) {
  let box = clampRect(rect, natW, natH);
  let z = zoomForRect(box, natW, natH, aspect);
  if (z > MAX_ZOOM) {
    z = MAX_ZOOM;
    const vis = visibleSize(z, natW, natH, aspect);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    box = clampRect(
      { x: cx - vis.visW / 2, y: cy - vis.visH / 2, w: vis.visW, h: vis.visH },
      natW,
      natH,
    );
  }
  return {
    zoom: z,
    ax: (box.x + box.w / 2) / natW,
    ay: (box.y + box.h / 2) / natH,
  };
}

function expandToAspect(rect, aspect) {
  let { x, y, w, h } = rect;
  const a = w / Math.max(h, 1);
  if (a < aspect) {
    const nw = h * aspect;
    x -= (nw - w) / 2;
    w = nw;
  } else if (a > aspect) {
    const nh = w / aspect;
    y -= (nh - h) / 2;
    h = nh;
  }
  return { x, y, w, h };
}

/**
 * Stops the camera will visit. At most three faces, so the glide can
 * reach each one up close. The whole picture is added later.
 * aspect is stage width / height.
 */
export function buildStops(faces, natW, natH, aspect) {
  let groups = clusterFaces(faces, natW, natH);
  if (groups.length === 1 && groups[0].faces.length >= 3 && groups[0].box.w > natW * 0.55) {
    groups = groups[0].faces
      .map((f) => ({
        faces: [f],
        box: padFace(f, natW, natH),
        score: f.w * f.h,
        cx: f.x + f.w / 2,
      }))
      .sort((a, b) => b.score - a.score);
  }
  if (groups.length > 3) groups = groups.slice(0, 3);
  return groups.map((g) => {
    const expanded = expandToAspect(g.box, aspect);
    const pose = frameRect(expanded, natW, natH, aspect);
    return { ...pose, count: g.faces.length, box: g.box };
  });
}

function key(t, zoom, ax, ay) {
  return { t, zoom, ax, ay };
}

/** Stable per photo for this visit, so a resize does not reshuffle the move. */
const reelSalt = (Math.random() * 0x100000000) >>> 0;

function rngFor(index) {
  let a = (reelSalt + index * 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function axisRoom(zoom, nat, stageUnits, fit) {
  const disp = nat * fit * Math.max(1, zoom);
  if (disp <= stageUnits + 1e-4) return 0;
  return Math.max(0, 0.5 - stageUnits / (2 * disp));
}

/** Pull a pose inside the crop the stage can actually show. */
function legalize(pose, natW, natH, aspect) {
  const fit = fitScale(natW, natH, aspect);
  const zoom = clamp(pose.zoom, 1, MAX_ZOOM);
  const rx = axisRoom(zoom, natW, aspect, fit);
  const ry = axisRoom(zoom, natH, 1, fit);
  return {
    zoom,
    ax: clamp(pose.ax, 0.5 - rx, 0.5 + rx),
    ay: clamp(pose.ay, 0.5 - ry, 0.5 + ry),
  };
}

/**
 * Pull the frame back in until the padded face, including the forehead, is fully visible.
 */
function keepInside(zoom, ax, ay, box, natW, natH, aspect) {
  if (!box || !(box.w > 0) || !(box.h > 0)) return { zoom, ax, ay };
  const fitPose = frameRect(expandToAspect(clampRect(box, natW, natH), aspect), natW, natH, aspect);
  zoom = clamp(Math.min(zoom, fitPose.zoom), 1, MAX_ZOOM);
  const vis = visibleSize(zoom, natW, natH, aspect);
  let cx = ax * natW;
  let cy = ay * natH;
  if (vis.visW >= box.w) {
    const lo = box.x + box.w - vis.visW / 2;
    const hi = box.x + vis.visW / 2;
    cx = clamp(cx, Math.min(lo, hi), Math.max(lo, hi));
  } else {
    cx = box.x + box.w / 2;
  }
  if (vis.visH >= box.h) {
    const lo = box.y + box.h - vis.visH / 2;
    const hi = box.y + vis.visH / 2;
    cy = clamp(cy, Math.min(lo, hi), Math.max(lo, hi));
  } else {
    cy = box.y + box.h / 2;
  }
  if (vis.visW < natW - 0.5) cx = clamp(cx, vis.visW / 2, natW - vis.visW / 2);
  else cx = natW / 2;
  if (vis.visH < natH - 0.5) cy = clamp(cy, vis.visH / 2, natH - vis.visH / 2);
  else cy = natH / 2;
  return { zoom, ax: cx / natW, ay: cy / natH };
}

function lockPose(pose) {
  return {
    zoom: pose.zoom,
    ax: pose.ax,
    ay: pose.ay,
    zoom0: pose.zoom,
    zoom1: pose.zoom,
    ax0: pose.ax,
    ay0: pose.ay,
    ax1: pose.ax,
    ay1: pose.ay,
  };
}

/**
 * One smooth glide per photo.
 * Each photo randomly zooms in or zooms out, and pans left or right.
 * Zoom in opens on the whole picture and glides onto the faces.
 * Zoom out opens on a face and glides back to the whole picture.
 */
export function portraitKeys(stops, index, natW = 3, natH = 2, aspect = 16 / 9) {
  const rng = rngFor(index);
  const play = MAX_SHOT - HOLD.fade;
  const dir = rng() < 0.5 ? 1 : -1;
  const zoomIn = rng() < 0.5;
  const whole = { zoom: 1, ax: 0.5, ay: 0.5 };

  const closePose = (stop) => {
    const zoom = clamp(stop.zoom || 1.8, 1.25, Math.min(MAX_ZOOM, 2.5));
    return legalize(
      keepInside(zoom, stop.ax, stop.ay, stop.box, natW, natH, aspect),
      natW,
      natH,
      aspect,
    );
  };
  const aside = (stop, sign, scale) => {
    const zoom = clamp((stop.zoom || 1.7) * scale, 1.15, 2);
    return legalize(
      keepInside(zoom, stop.ax + sign * 0.1, stop.ay, stop.box, natW, natH, aspect),
      natW,
      natH,
      aspect,
    );
  };

  const ordered = [...stops].sort((a, b) => a.ax - b.ax);
  if (dir < 0) ordered.reverse();
  const closes = ordered.map(closePose);

  let path;
  if (!closes.length) {
    const ay = 0.42 + rng() * 0.12;
    const left = dir > 0 ? 0.34 : 0.66;
    const right = dir > 0 ? 0.66 : 0.34;
    if (zoomIn) {
      path = [
        whole,
        legalize({ zoom: 1.34, ax: left, ay }, natW, natH, aspect),
        legalize({ zoom: 1.34, ax: right, ay }, natW, natH, aspect),
      ];
    } else {
      path = [
        legalize({ zoom: 1.55, ax: left, ay }, natW, natH, aspect),
        legalize({ zoom: 1.22, ax: right, ay }, natW, natH, aspect),
        whole,
      ];
    }
  } else if (closes.length === 1) {
    const stop = ordered[0];
    const near = aside(stop, zoomIn ? -dir : dir, 0.78);
    const arrived = closes[0];
    const same =
      Math.abs(near.ax - arrived.ax) < 0.025 && Math.abs(near.zoom - arrived.zoom) < 0.08;
    path = zoomIn
      ? same
        ? [whole, arrived]
        : [whole, near, arrived]
      : same
        ? [arrived, whole]
        : [arrived, near, whole];
  } else {
    path = zoomIn ? [whole, ...closes] : [...closes, whole];
  }

  const keys = path.map((pose, i) =>
    key(path.length === 1 ? 0 : (play * i) / (path.length - 1), pose.zoom, pose.ax, pose.ay),
  );
  keys.move = dir > 0 ? "ltr" : "rtl";
  keys.zoom = zoomIn ? "in" : "out";
  keys.full = zoomIn ? "start" : "end";
  keys.box = null;
  keys.natW = natW;
  keys.natH = natH;
  keys.aspect = aspect;
  return keys;
}

function sampleCenterOut(keys, t) {
  const play = Math.max(1, keys[keys.length - 1].t);
  const u = clamp(t / play, 0, 1);
  const e = Math.sin(Math.PI * easeGlide(u));
  const tight = keys.tight || { zoom: 1.6, ax: 0.5, ay: 0.5 };
  const zoom = lerp(1, tight.zoom, e);
  const held = keepInside(
    zoom,
    lerp(0.5, tight.ax, e),
    lerp(0.5, tight.ay, e),
    keys.box,
    keys.natW,
    keys.natH,
    keys.aspect,
  );
  return lockPose(held);
}

export function sampleKeys(keys, t) {
  if (keys && keys.move === "out") return sampleCenterOut(keys, t);
  const still = (k) =>
    lockPose(keepInside(k.zoom, k.ax, k.ay, keys.box, keys.natW, keys.natH, keys.aspect));
  if (!keys.length) return still({ zoom: 1, ax: 0.5, ay: 0.5 });
  if (t <= keys[0].t) return still(keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.t) return still(last);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const u = easeGlide((t - a.t) / Math.max(1, b.t - a.t));
      return lockPose(
        keepInside(
          lerp(a.zoom, b.zoom, u),
          lerp(a.ax, b.ax, u),
          lerp(a.ay, b.ay, u),
          keys.box,
          keys.natW,
          keys.natH,
          keys.aspect,
        ),
      );
    }
  }
  return still(last);
}

export function shotSpan(style, keys, speedName) {
  const f = SPEED[speedName] ?? 1;
  const fade = HOLD.fade;
  if (style === "portrait") {
    const end = keys.length ? keys[keys.length - 1].t : HOLD.ken;
    return { play: end * f, fade };
  }
  if (style === "slide") return { play: HOLD.still * f, fade };
  if (style === "prints" || style === "strip") return { play: HOLD.prints * f, fade };
  return { play: HOLD.still * f, fade };
}

/**
 * Slide the anchor only as the crop opens, in step with the zoom,
 * so the picture never lurches sideways on its own.
 */
function glideAxis(pose, axis, nat, fit, stage, zoom) {
  const from = axis === "x" ? pose.ax0 : pose.ay0;
  const to = axis === "x" ? pose.ax1 : pose.ay1;
  const eased = axis === "x" ? pose.ax : pose.ay;
  const z0 = pose.zoom0 ?? zoom;
  const z1 = pose.zoom1 ?? zoom;
  const roomAt = (z) => {
    const d = nat * fit * Math.max(1, z);
    if (d <= stage + 0.5) return 0;
    return 0.5 - stage / (2 * d);
  };
  const zHi = Math.max(z0, z1);
  const zLo = Math.min(z0, z1);
  const roomHi = roomAt(zHi);
  const roomLo = roomAt(zLo);
  let anchor;
  if (from == null || to == null || roomHi - roomLo < 1e-4) {
    anchor = eased ?? 0.5;
  } else {
    const anchorHi = z1 < z0 ? from : to;
    const anchorLo = z1 < z0 ? to : from;
    const g = clamp((roomAt(zoom) - roomLo) / (roomHi - roomLo), 0, 1);
    anchor = lerp(anchorLo, anchorHi, g);
  }
  const disp = nat * fit * zoom;
  if (!(disp > stage + 0.5)) return 0.5;
  const m = stage / (2 * disp);
  return clamp(anchor, m, 1 - m);
}

/**
 * Where to draw the bitmap so `pose` is what the stage shows.
 * Returns top-left and drawn size in stage pixels. The stage clips.
 */
export function placeContain(natW, natH, sw, sh, pose) {
  const fit = Math.min(sw / natW, sh / natH);
  const zoom = Math.max(1, pose.zoom);
  const ax = glideAxis(pose, "x", natW, fit, sw, zoom);
  const ay = glideAxis(pose, "y", natH, fit, sh, zoom);
  const dispW = natW * fit * zoom;
  const dispH = natH * fit * zoom;
  return {
    left: sw / 2 - ax * dispW,
    top: sh / 2 - ay * dispH,
    width: dispW,
    height: dispH,
  };
}

export function speedFactor(name) {
  return SPEED[name] ?? 1;
}

export { HOLD };
