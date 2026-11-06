const CLIENT_ID = "138429037112-mdemf0lnbie5vsjtl2h1ssqt8nbh5mt2.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const API = "https://photospicker.googleapis.com/v1";

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not reach Google sign-in"));
    document.head.append(s);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pollMs(session) {
  const raw = session?.pollingConfig?.pollInterval || "2s";
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 2000;
  const ms = /ms/.test(raw) ? n : n * 1000;
  return Math.min(2000, Math.max(1500, ms));
}

function pickerUrl(uri) {
  if (!uri.startsWith("https://")) throw new Error("Unexpected picker link");
  const host = new URL(uri).hostname;
  if (host !== "photos.google.com" && !host.endsWith(".google.com")) {
    throw new Error("Unexpected picker link");
  }
  return uri;
}

function sessionReady(cur) {
  const flag = cur?.mediaItemsSet ?? cur?.media_items_set;
  return flag === true || flag === "true" || (cur && cur.pollingConfig == null);
}

export function explainGoogleError(err) {
  const msg = String(err?.message || err || "Google Photos failed");
  if (/origin|idpiframe|not allowed/i.test(msg)) {
    return `Google rejected this site. In the web client, add this origin: ${location.origin}`;
  }
  if (/access_denied/i.test(msg)) return "Sign-in was cancelled.";
  if (/popup_failed_to_open|popup/i.test(msg)) return "Allow pop-up windows for this site, then try again.";
  if (/popup_closed/i.test(msg)) return "Sign-in window was closed.";
  if (/SERVICE_DISABLED|accessNotConfigured|has not been used|Picker API/i.test(msg)) {
    return "Turn on the Google Photos Picker API for this Cloud project.";
  }
  if (/insufficient|ACCESS_TOKEN_SCOPE|insufficientPermissions/i.test(msg)) {
    return "The Photos Picker permission is missing. Add it under Data access, then sign in again.";
  }
  try {
    const parsed = JSON.parse(msg);
    return parsed.error?.message || msg.slice(0, 220);
  } catch {
    return msg.slice(0, 220);
  }
}

export function createGooglePhotos() {
  let token = "";
  let expiresAt = 0;

  async function signIn() {
    if (location.protocol === "file:") {
      throw new Error("Google sign-in needs the app on http://localhost:8080, not a file.");
    }
    await loadGis();
    const access = await new Promise((resolve, reject) => {
      const client = globalThis.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp?.error) reject(new Error(resp.error));
          else resolve(resp);
        },
        error_callback: (err) => reject(new Error(err?.type || err?.message || "Sign-in failed")),
      });
      client.requestAccessToken({ prompt: token ? "" : "consent" });
    });
    token = access.access_token;
    expiresAt = Date.now() + (Number(access.expires_in) || 3600) * 1000 - 60_000;
    return token;
  }

  function signedIn() {
    return !!token && Date.now() < expiresAt;
  }

  function signOut() {
    const current = token;
    token = "";
    expiresAt = 0;
    if (current && globalThis.google?.accounts?.oauth2?.revoke) {
      globalThis.google.accounts.oauth2.revoke(current, () => {});
    }
  }

  function api(path, options = {}) {
    if (!signedIn() && !options.interactive) {
      return Promise.reject(new Error("Sign in again, then choose the photos."));
    }
    const limit = options.timeout || 8000;
    const run = (authToken) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method || "GET", API + path, true);
      xhr.timeout = limit;
      xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
      if (options.body) xhr.setRequestHeader("Content-Type", "application/json");
      const started = performance.now();
      let settled = false;
      let frames = 0;
      const beat = () => {
        if (settled) return;
        frames += 1;
        const secs = Math.round((performance.now() - started) / 1000);
        options.onTick?.(secs, xhr.readyState);
        if (performance.now() - started >= limit) xhr.abort();
      };
      const pulse = setInterval(beat, 500);
      globalThis.__nlBeat = beat;
      const stopBeat = () => {
        clearInterval(pulse);
        if (globalThis.__nlBeat === beat) globalThis.__nlBeat = null;
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        stopBeat();
        fn(value);
      };
      xhr.onload = () => {
        const text = xhr.responseText || "";
        if (xhr.status < 200 || xhr.status >= 300) {
          finish(reject, new Error(text.slice(0, 180) || `Google Photos failed (${xhr.status})`));
          return;
        }
        try {
          finish(resolve, text ? JSON.parse(text) : null);
        } catch {
          finish(reject, new Error(`Bad response (${xhr.status}): ${text.slice(0, 120)}`));
        }
      };
      xhr.onerror = () => finish(reject, new Error("Could not reach Google Photos"));
      xhr.ontimeout = () => finish(reject, new Error("Timed out talking to Google"));
      xhr.onabort = () => finish(reject, new Error("Timed out talking to Google"));
      if (options.signal) {
        if (options.signal.aborted) xhr.abort();
        else options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
      xhr.send(options.body || null);
    });
    if (!signedIn()) {
      return signIn().then((authToken) => run(authToken));
    }
    return run(token);
  }

  const LUSTRE_SITE = "https://lustre.show";
  let deliverPhotos = null;
  let listSite = "";

  function useSite(site) {
    listSite = site || "";
  }

  async function listOnce(sessionId, _onTick, pageToken) {
    const root = listSite || (location.protocol === "http:" || location.protocol === "https:" ? location.origin : LUSTRE_SITE);
    let res;
    try {
      res = await fetch(`${root}/api/picker/list`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8", Accept: "application/json" },
        body: JSON.stringify({ sessionId, pageToken: pageToken || "", token }),
      });
    } catch {
      throw new Error("Could not load the photo list");
    }
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok || parsed?.error) {
      const message = parsed?.error?.message || parsed?.error || `Could not load the photo list (${res.status})`;
      throw new Error(String(message));
    }
    const data = parsed || {};
    data.mediaItems = data.mediaItems || data.media_items || [];
    data.nextPageToken = data.nextPageToken || data.next_page_token || "";
    return data;
  }

  async function listAll(sessionId, onTick) {
    const items = [];
    let pageToken = "";
    let snippet = "";
    const seen = new Set();
    for (let page = 0; page < 20; page += 1) {
      const data = await listOnce(sessionId, onTick, pageToken);
      snippet = data?.snippet || snippet;
      items.push(...(data?.mediaItems || []));
      const next = data?.nextPageToken || data?.next_page_token || "";
      if (!next || seen.has(next)) break;
      seen.add(next);
      pageToken = next;
    }
    return { items, snippet };
  }

  function stillWaiting(err) {
    const msg = String(err?.message || err);
    return /FAILED_PRECONDITION|not yet|not finished|have not been picked|mediaItemsSet/i.test(msg);
  }

  function sessionIds(created) {
    const ids = [];
    const add = (value) => {
      const id = String(value || "").replace(/^sessions\//, "");
      if (id && !ids.includes(id)) ids.push(id);
    };
    add(created?.id);
    try {
      const parts = new URL(created.pickerUri).pathname.split("/").filter(Boolean);
      const at = parts.lastIndexOf("session");
      if (at >= 0) add(decodeURIComponent(parts[at + 1] || ""));
    } catch {
      /* the create response id is enough */
    }
    return ids;
  }

  function flagOf(cur) {
    const flag = cur?.mediaItemsSet ?? cur?.media_items_set;
    return flag === true || flag === "true";
  }

  function normalizeItem(item) {
    const file = item?.mediaFile || {};
    return {
      ...item,
      mediaFile: {
        baseUrl: file.baseUrl || item?.baseUrl || "",
        mimeType: file.mimeType || item?.mimeType || "",
        filename: file.filename || item?.filename || "",
      },
    };
  }

  function waitUntilVisible() {
    if (document.visibilityState === "visible") return Promise.resolve();
    return new Promise((resolve) => {
      const on = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", on);
        resolve();
      };
      document.addEventListener("visibilitychange", on);
    });
  }

  async function beginPick(onLink, isClosed, onStatus, onPhotos) {
    let stop = false;
    let handed = false;
    let inflight = null;
    const dropInflight = () => {
      if (document.hidden) inflight?.abort();
    };
    document.addEventListener("visibilitychange", dropInflight);
    const task = (async () => {
      try {
        const created = await api("/sessions", { method: "POST", body: "{}", interactive: true });
        if (stop) return { items: [], cancelled: true };
        const sessionId = sessionIds(created)[0];
        if (!sessionId) throw new Error("Google did not return a selection id.");
        const previous = sessionStorage.getItem("nl-picker-session");
        if (previous && previous !== sessionId) {
          api(`/sessions/${encodeURIComponent(previous)}`, { method: "DELETE" }).catch(() => {});
        }
        sessionStorage.setItem("nl-picker-session", sessionId);
        deliverPhotos = (data) => {
          if (handed) return;
          const raw = data?.mediaItems || [];
          const items = raw.map(normalizeItem).filter((item) => {
            if (!item.mediaFile.baseUrl) return false;
            const mime = item.mediaFile.mimeType || "";
            if (mime.startsWith("video/") || item.type === "VIDEO") return false;
            if (!mime) item.mediaFile.mimeType = "image/jpeg";
            return true;
          });
          if (!items.length) {
            const sample = raw[0] ? Object.keys(raw[0].mediaFile || raw[0]).slice(0, 8).join(", ") : "none";
            onStatus?.(`Saved, but the photo list failed. no photo link (${sample})`);
            return;
          }
          handed = true;
          stop = true;
          onStatus?.(`Starting ${items.length} photos…`);
          sessionStorage.removeItem("nl-picker-session");
          onPhotos?.(items);
        };
        const link = pickerUrl(created.pickerUri);
        onLink({ open: link, show: link });
        const deadline = Date.now() + 15 * 60 * 1000;
        let checks = 0;
        while (!stop && Date.now() < deadline) {
          if (document.hidden) {
            onStatus?.("Press Done in Google Photos, then come back to this tab.");
            await waitUntilVisible();
            if (stop) break;
          }
          checks += 1;
          onStatus?.(`Checking with Google (${checks})…`);
          const ctrl = new AbortController();
          inflight = ctrl;
          const timer = setTimeout(() => ctrl.abort(), 4000);
          let cur = null;
          let errNote = "";
          try {
            cur = await api(`/sessions/${encodeURIComponent(sessionId)}`, { signal: ctrl.signal });
          } catch (err) {
            if (ctrl.signal.aborted && document.hidden) continue;
            errNote = explainGoogleError(err);
          } finally {
            clearTimeout(timer);
            if (inflight === ctrl) inflight = null;
          }
          if (stop) break;
          if (flagOf(cur)) {
            let listErr = "";
            for (let attempt = 1; attempt <= 4 && !stop; attempt += 1) {
              onStatus?.(`Google saved the photos. Loading them (try ${attempt}, beat 0)…`);
              try {
                const listed = await listAll(sessionId, (beats) => {
                  onStatus?.(`Google saved the photos. Loading them (try ${attempt}, ${beats})…`);
                });
                const raw = listed.items || [];
                const items = raw.map(normalizeItem).filter((item) => item.mediaFile.baseUrl);
                if (handed) return { items: [], cancelled: true };
                if (items.length) {
                  sessionStorage.removeItem("nl-picker-session");
                  return { items };
                }
                const sample = raw[0] ? Object.keys(raw[0]).join(", ") : "none";
                listErr = raw.length
                  ? `photos arrived without a link (${sample})`
                  : `the list was empty (${listed.snippet || "no reply"})`;
              } catch (err) {
                listErr = explainGoogleError(err);
              }
              onStatus?.(`Saved, but the photo list failed. ${listErr}`);
              await sleep(1500);
            }
            throw new Error(listErr || "the list was empty");
          }
          const flag = cur ? String(cur.mediaItemsSet) : "no reply";
          onStatus?.(`Not saved yet (${checks}). Google says ${flag}${errNote ? `. ${errNote}` : ""}.`);
          await sleep(1000);
        }
        if (stop) return { items: [], cancelled: true };
        throw new Error("No photos were chosen.");
      } finally {
        deliverPhotos = null;
        document.removeEventListener("visibilitychange", dropInflight);
      }
    })();
    return {
      done: task,
      cancel() {
        stop = true;
        inflight?.abort();
      },
    };
  }

  function adopt(accessToken, expiresIn = 3600) {
    token = String(accessToken || "");
    const seconds = Number(expiresIn);
    expiresAt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000 - 60_000;
  }

  async function collect(sessionId, onStatus) {
    const listed = await listAll(sessionId, onStatus);
    return (listed.items || []).map(normalizeItem).filter((item) => {
      if (!item.mediaFile.baseUrl) return false;
      const mime = item.mediaFile.mimeType || "";
      if (mime.startsWith("video/") || item.type === "VIDEO") return false;
      if (!mime) item.mediaFile.mimeType = "image/jpeg";
      return true;
    });
  }
  async function download(baseUrl) {
    if (!signedIn()) await signIn();
    const res = await fetch(`${baseUrl}=w1920-h1920`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Photo download failed (${res.status})`);
    return res.blob();
  }

  return { signIn, signedIn, signOut, beginPick, download, adopt, collect, useSite };
}
