const CLIENT_ID = "138429037112-mdemf0lnbie5vsjtl2h1ssqt8nbh5mt2.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const OWNER_KEY = "lustre.ownerKey";

const app = document.getElementById("app");
const note = document.getElementById("note");
const params = new URLSearchParams(location.search);
const pairId = params.get("pair") || "";
let openAlbumId = params.get("album") || sessionStorage.getItem("lustre.shareAlbum") || "";

function say(text) {
  if (note) note.textContent = text || "";
}

function ownerKey() {
  let key = localStorage.getItem(OWNER_KEY);
  if (!key) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let raw = "";
    for (const byte of bytes) raw += String.fromCharCode(byte);
    key = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    localStorage.setItem(OWNER_KEY, key);
  }
  return key;
}

async function api(path, options = {}) {
  const headers = { "X-Lustre-Owner": ownerKey(), ...(options.headers || {}) };
  let body;
  if (options.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const res = await fetch(path, { method: options.method || "GET", headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not reach Lustre");
  return data;
}

function button(label, primary) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  if (primary) el.className = "primary";
  return el;
}

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not reach Google sign-in"));
    document.head.append(script);
  });
}

async function signIn() {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp?.error) reject(new Error(resp.error));
        else resolve(resp);
      },
      error_callback: (err) => reject(new Error(err?.type || err?.message || "Sign-in failed")),
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function savePicker(albumId) {
  const access = await signIn();
  const started = await api(`/api/share/albums/${encodeURIComponent(albumId)}/picker`, {
    method: "POST",
    body: { token: access.access_token, expiresIn: Number(access.expires_in) || 3600 },
  });
  sessionStorage.setItem("lustre.shareAlbum", albumId);
  const popup = window.open(started.pickerUri, "lustre-picker");
  if (!popup) location.assign(started.pickerUri);
  say("Press Done in Google Photos. This page saves the photos you selected.");
  let last = "";
  for (let i = 0; i < 80; i += 1) {
    await sleep(1500);
    const tick = await api(`/api/share/albums/${encodeURIComponent(albumId)}/tick`, { method: "POST", body: {} });
    if (tick.status === "waiting") {
      say("Press Done in Google Photos. This page saves the photos you selected.");
      continue;
    }
    if (tick.status === "saving") {
      const text = `Saving ${tick.saved || 0} of ${tick.total || 0}`;
      if (text !== last) say(tick.skipped ? `${text}. ${tick.skipped}` : text);
      last = text;
      continue;
    }
    if (tick.status === "done" || tick.status === "idle") {
      say("Saved. Televisions already in the album pick this up on their own.");
      sessionStorage.removeItem("lustre.shareAlbum");
      return;
    }
    if (tick.status === "error") throw new Error(tick.error || "Could not save the photos.");
  }
  throw new Error("Still saving. Open this album again and it will continue.");
}

async function showAlbum(id) {
  openAlbumId = id;
  const album = await api(`/api/share/albums/${encodeURIComponent(id)}`);
  app.replaceChildren();
  const card = document.createElement("div");
  card.className = "card";
  const title = document.createElement("p");
  title.textContent = album.name;
  const code = document.createElement("strong");
  code.className = "code";
  code.textContent = album.joinCode;
  const help = document.createElement("p");
  help.className = "muted";
  help.textContent = "On the television, open Albums and enter this code. Or scan the television code and add it here.";
  const actions = document.createElement("div");
  actions.className = "row";
  const add = button("Add photos", true);
  const back = button("Albums");
  const rename = button("Rename");
  const rotate = button("New code");
  const removeAlbum = button("Delete album");
  add.addEventListener("click", () => {
    add.disabled = true;
    savePicker(id).then(() => showAlbum(id)).catch((err) => {
      add.disabled = false;
      say(err?.message || "Could not add photos");
    });
  });
  back.addEventListener("click", () => {
    openAlbumId = "";
    void showList();
  });
  rename.addEventListener("click", async () => {
    const name = prompt("Album name", album.name);
    if (!name) return;
    await api(`/api/share/albums/${encodeURIComponent(id)}/rename`, { method: "POST", body: { name } });
    await showAlbum(id);
  });
  rotate.addEventListener("click", async () => {
    await api(`/api/share/albums/${encodeURIComponent(id)}/join-code`, { method: "POST", body: {} });
    say("The old code no longer adds a television. Televisions already in the album stay.");
    await showAlbum(id);
  });
  removeAlbum.addEventListener("click", async () => {
    if (!confirm("Delete this shared album and its photos from Lustre?")) return;
    await api(`/api/share/albums/${encodeURIComponent(id)}`, { method: "DELETE" });
    openAlbumId = "";
    say("Deleted from Lustre. Copies already on a television stay there until that television removes them.");
    await showList();
  });
  actions.append(add, rename, rotate, removeAlbum, back);
  card.append(title, code, help, actions);
  if (pairId) {
    const attach = button("Add the television that showed this code", true);
    attach.addEventListener("click", async () => {
      attach.disabled = true;
      try {
        await api("/api/share/attach", { method: "POST", body: { pairId, albumId: id } });
        say("That television joined. It will pick up the photos on its own.");
        await showAlbum(id);
      } catch (err) {
        attach.disabled = false;
        say(err?.message || "Could not add the television");
      }
    });
    card.append(attach);
  }
  const photos = document.createElement("div");
  for (const photo of album.photos || []) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.textContent = photo.filename || "Photo";
    const remove = button("Remove");
    remove.addEventListener("click", async () => {
      await api(`/api/share/albums/${encodeURIComponent(id)}/photos/${encodeURIComponent(photo.id)}`, { method: "DELETE" });
      say("Removed. Each television drops it the next time it checks in.");
      await showAlbum(id);
    });
    row.append(label, remove);
    photos.append(row);
  }
  if (!(album.photos || []).length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No photos yet.";
    photos.append(empty);
  }
  const members = document.createElement("div");
  const memberLead = document.createElement("p");
  memberLead.className = "muted";
  memberLead.textContent = "Televisions";
  members.append(memberLead);
  const active = (album.members || []).filter((member) => !member.revoked);
  if (!active.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "None yet.";
    members.append(empty);
  }
  for (const member of active) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.textContent = member.tvId.slice(0, 8);
    const revoke = button("Remove");
    revoke.addEventListener("click", async () => {
      await api(`/api/share/albums/${encodeURIComponent(id)}/revoke`, { method: "POST", body: { tvId: member.tvId } });
      say("Removed. That television keeps the photos it already has, and stops receiving new ones.");
      await showAlbum(id);
    });
    row.append(label, revoke);
    members.append(row);
  }
  app.append(card, photos, members);
}

async function showList() {
  const data = await api("/api/share/albums");
  app.replaceChildren();
  const form = document.createElement("div");
  form.className = "row";
  const name = document.createElement("input");
  name.placeholder = "Album name";
  name.value = "Shared album";
  name.maxLength = 80;
  name.setAttribute("aria-label", "Album name");
  const create = button("Create", true);
  create.addEventListener("click", async () => {
    create.disabled = true;
    try {
      const album = await api("/api/share/albums", { method: "POST", body: { name: name.value } });
      await showAlbum(album.id);
    } catch (err) {
      create.disabled = false;
      say(err?.message || "Could not create the album");
    }
  });
  form.append(name, create);
  app.append(form);
  if (pairId) {
    const banner = document.createElement("p");
    banner.textContent = "Choose an album to add the television that showed this code.";
    app.append(banner);
  }
  for (const album of data.albums || []) {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("p");
    title.textContent = `${album.name} · ${album.count} ${album.count === 1 ? "photo" : "photos"}`;
    const open = button("Open", true);
    open.addEventListener("click", () => {
      void showAlbum(album.id).catch((err) => say(err?.message || "Could not open the album"));
    });
    card.append(title, open);
    app.append(card);
  }
  const recovery = button("Show this phone's key");
  recovery.addEventListener("click", () => {
    say("Keep this key if you want to manage the album from another browser. It is not a Google password.");
    const shown = document.createElement("p");
    shown.className = "muted";
    shown.textContent = ownerKey();
    app.append(shown);
  });
  app.append(recovery);
}

if (openAlbumId) {
  showAlbum(openAlbumId).catch((err) => {
    say(err?.message || "Could not open the album");
    void showList();
  });
} else {
  showList().catch((err) => say(err?.message || "Could not reach Lustre"));
}
