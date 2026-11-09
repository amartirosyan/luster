const DB_NAME = "lustre";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("albums")) db.createObjectStore("albums", { keyPath: "id" });
      if (!db.objectStoreNames.contains("photos")) {
        const photos = db.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("albumId", "albumId", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open the album store"));
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Album store failed"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Album store failed"));
    tx.onabort = () => reject(tx.error || new Error("Album store failed"));
  });
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function listAlbums() {
  const db = await openDb();
  const albums = await request(db.transaction("albums").objectStore("albums").getAll());
  const saver = await request(db.transaction("settings").objectStore("settings").get("screensaver"));
  db.close();
  albums.sort((a, b) => b.created - a.created);
  return albums.map((album) => ({ ...album, screensaver: album.id === saver }));
}

export async function screensaverId() {
  const db = await openDb();
  const id = await request(db.transaction("settings").objectStore("settings").get("screensaver"));
  db.close();
  return id || "";
}

export async function setScreensaver(id) {
  const db = await openDb();
  const tx = db.transaction("settings", "readwrite");
  if (id) tx.objectStore("settings").put(id, "screensaver");
  else tx.objectStore("settings").delete("screensaver");
  await txDone(tx);
  db.close();
}

export async function saveAlbum(name, items) {
  const ready = items.filter((item) => item?.blob);
  if (!ready.length) throw new Error("Nothing to save");
  const db = await openDb();
  const id = newId();
  const album = { id, name, created: Date.now(), count: ready.length };
  const tx = db.transaction(["albums", "photos"], "readwrite");
  tx.objectStore("albums").put(album);
  ready.forEach((item, order) => {
    tx.objectStore("photos").put({
      id: `${id}:${order}`,
      albumId: id,
      order,
      taken: Number(item.taken) || 0,
      title: item.title || "Photo",
      blob: item.blob,
    });
  });
  try {
    await txDone(tx);
  } catch (err) {
    db.close();
    const quota = /quota/i.test(String(err?.name || err?.message || err));
    throw new Error(quota ? "The television is out of room for more photos" : "Could not save the album");
  }
  db.close();
  return album;
}

export async function loadAlbum(id) {
  const db = await openDb();
  const album = await request(db.transaction("albums").objectStore("albums").get(id));
  const photos = await request(db.transaction("photos").objectStore("photos").index("albumId").getAll(id));
  db.close();
  photos.sort((a, b) => {
    const ta = Number(a.taken) || 0;
    const tb = Number(b.taken) || 0;
    if (ta && tb && ta !== tb) return ta - tb;
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    return a.order - b.order;
  });
  return { album, photos };
}

export async function renameAlbum(id, name) {
  const next = String(name || "").trim();
  if (!next) throw new Error("The album needs a name");
  const db = await openDb();
  const album = await request(db.transaction("albums").objectStore("albums").get(id));
  if (!album) {
    db.close();
    throw new Error("That album is gone");
  }
  album.name = next;
  const tx = db.transaction("albums", "readwrite");
  tx.objectStore("albums").put(album);
  await txDone(tx);
  db.close();
  return album;
}

export async function deleteAlbum(id) {
  const db = await openDb();
  const photos = await request(db.transaction("photos").objectStore("photos").index("albumId").getAll(id));
  const saver = await request(db.transaction("settings").objectStore("settings").get("screensaver"));
  const tx = db.transaction(["albums", "photos", "settings"], "readwrite");
  tx.objectStore("albums").delete(id);
  for (const photo of photos) tx.objectStore("photos").delete(photo.id);
  if (saver === id) tx.objectStore("settings").delete("screensaver");
  await txDone(tx);
  db.close();
}

export async function deviceId() {
  const db = await openDb();
  const existing = await request(db.transaction("settings").objectStore("settings").get("tvId"));
  if (existing) {
    db.close();
    return existing;
  }
  const id = newId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const safe = id.length >= 8 ? id : `${id}television`;
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put(safe, "tvId");
  await txDone(tx);
  db.close();
  return safe;
}

export async function findSharedAlbum(remoteId) {
  const db = await openDb();
  const albums = await request(db.transaction("albums").objectStore("albums").getAll());
  db.close();
  return albums.find((album) => album.remoteId === remoteId) || null;
}

export async function saveSharedMembership({ remoteId, name, revision, memberToken }) {
  const db = await openDb();
  const albums = await request(db.transaction("albums").objectStore("albums").getAll());
  let album = albums.find((item) => item.remoteId === remoteId);
  if (!album) {
    album = {
      id: newId(),
      name: name || "Shared album",
      created: Date.now(),
      count: 0,
      remoteId,
      revision: Number(revision) || 0,
      memberToken,
      shared: true,
    };
  } else {
    album.name = name || album.name;
    album.revision = Number(revision) || album.revision || 0;
    album.memberToken = memberToken || album.memberToken;
    album.shared = true;
    album.left = false;
  }
  const tx = db.transaction("albums", "readwrite");
  tx.objectStore("albums").put(album);
  await txDone(tx);
  db.close();
  return album;
}

async function putAlbumCount(albumId) {
  const db = await openDb();
  const album = await request(db.transaction("albums").objectStore("albums").get(albumId));
  const photos = await request(db.transaction("photos").objectStore("photos").index("albumId").getAll(albumId));
  if (!album) {
    db.close();
    return null;
  }
  album.count = photos.length;
  const tx = db.transaction("albums", "readwrite");
  tx.objectStore("albums").put(album);
  await txDone(tx);
  db.close();
  return album;
}

export async function addSharedPhoto(albumId, item) {
  const db = await openDb();
  const id = `${albumId}:${item.remoteId}`;
  const tx = db.transaction("photos", "readwrite");
  tx.objectStore("photos").put({
    id,
    albumId,
    remoteId: item.remoteId,
    order: Number(item.taken) || 0,
    taken: Number(item.taken) || 0,
    title: item.title || "Photo",
    blob: item.blob,
  });
  await txDone(tx);
  db.close();
  return putAlbumCount(albumId);
}

export async function removeSharedPhotos(albumId, remoteIds) {
  if (!remoteIds?.length) return putAlbumCount(albumId);
  const db = await openDb();
  const tx = db.transaction("photos", "readwrite");
  for (const remoteId of remoteIds) tx.objectStore("photos").delete(`${albumId}:${remoteId}`);
  await txDone(tx);
  db.close();
  return putAlbumCount(albumId);
}

export async function setSharedMeta(albumId, meta) {
  const db = await openDb();
  const album = await request(db.transaction("albums").objectStore("albums").get(albumId));
  if (!album) {
    db.close();
    return null;
  }
  if (meta.name) album.name = meta.name;
  if (meta.revision != null) album.revision = Number(meta.revision) || 0;
  const tx = db.transaction("albums", "readwrite");
  tx.objectStore("albums").put(album);
  await txDone(tx);
  db.close();
  return album;
}

export async function leaveSharedLocal(albumId) {
  const db = await openDb();
  const album = await request(db.transaction("albums").objectStore("albums").get(albumId));
  if (!album) {
    db.close();
    return null;
  }
  album.shared = false;
  album.memberToken = "";
  album.left = true;
  const tx = db.transaction("albums", "readwrite");
  tx.objectStore("albums").put(album);
  await txDone(tx);
  db.close();
  return album;
}

export async function rememberLeave(entry) {
  const db = await openDb();
  const current = (await request(db.transaction("settings").objectStore("settings").get("pendingLeaves"))) || [];
  const next = current.filter((item) => item.albumId !== entry.albumId);
  next.push(entry);
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put(next, "pendingLeaves");
  await txDone(tx);
  db.close();
}

export async function pendingLeaves() {
  const db = await openDb();
  const current = await request(db.transaction("settings").objectStore("settings").get("pendingLeaves"));
  db.close();
  return Array.isArray(current) ? current : [];
}

export async function forgetLeave(albumId) {
  const db = await openDb();
  const current = (await request(db.transaction("settings").objectStore("settings").get("pendingLeaves"))) || [];
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put(
    current.filter((item) => item.albumId !== albumId),
    "pendingLeaves",
  );
  await txDone(tx);
  db.close();
}
