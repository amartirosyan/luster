const CLIENT_ID = "138429037112-mdemf0lnbie5vsjtl2h1ssqt8nbh5mt2.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";

const note = document.getElementById("note");
const button = document.getElementById("go");
const code = new URLSearchParams(location.search).get("code") || "";

if (code) {
  fetch("/api/pair/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: code }),
  }).catch(() => {});
}

function say(text) {
  if (note) note.textContent = text;
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
    client.requestAccessToken({ prompt: "select_account" });
  });
  return access;
}

button?.addEventListener("click", async () => {
  if (!code) {
    say("This page needs the code from the television.");
    return;
  }
  button.disabled = true;
  say("Opening Google\u2026");
  try {
    const access = await signIn();
    say("Opening your photos\u2026");
    const res = await fetch("/api/pair/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: code,
        token: access.access_token,
        expiresIn: Number(access.expires_in) || 3600,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.pickerUri) throw new Error(data.error || "Could not open Google Photos");
    location.replace(data.pickerUri);
  } catch (err) {
    button.disabled = false;
    say(err?.message || "Sign-in failed");
  }
});
