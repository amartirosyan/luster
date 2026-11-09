import assert from "node:assert/strict";
import { test } from "node:test";
import { createPairStore } from "./pair-store.ts";
import { handleShare } from "./share-http.ts";
import { createShareStore } from "./share-store.ts";
import { openMemorySql, type Sql } from "./sql.ts";

const OWNER = "owner-key-0123456789abcdef";
const OTHER = "other-owner-key-0123456789";
const TV_A = "tv-aaaa-1111";
const TV_B = "tv-bbbb-2222";
const GOOGLE = "ya29.secret-google-token";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function googleFetch(state: { ready: boolean; bytes: Uint8Array }): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    if (url.endsWith("/v1/sessions") && method === "POST") {
      return jsonResponse({
        id: "sess-1",
        pickerUri: "https://photos.google.com/picker/session/sess-1",
      });
    }
    if (url.includes("/v1/sessions/")) return jsonResponse({ id: "sess-1", mediaItemsSet: state.ready });
    if (url.includes("/v1/mediaItems")) {
      return jsonResponse({
        mediaItems: [
          {
            id: "google-photo-1",
            createTime: "2020-01-02T03:04:05Z",
            type: "PHOTO",
            mediaFile: {
              baseUrl: "https://lh3.googleusercontent.com/photo-one",
              mimeType: "image/jpeg",
              filename: "one.jpg",
            },
          },
          {
            id: "google-video-1",
            createTime: "2020-01-03T03:04:05Z",
            type: "VIDEO",
            mediaFile: {
              baseUrl: "https://lh3.googleusercontent.com/video-one",
              mimeType: "video/mp4",
              filename: "clip.mp4",
            },
          },
        ],
      });
    }
    if (url.startsWith("https://lh3.googleusercontent.com/photo-one")) {
      return new Response(Buffer.from(state.bytes), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return jsonResponse({ error: `unexpected ${method} ${url}` }, 404);
  };
}

function request(
  method: string,
  pathname: string,
  init: { headers?: Record<string, string>; body?: unknown; search?: string } = {},
) {
  const url = new URL(pathname + (init.search || ""), "http://tv.local");
  const headers = init.headers || {};
  return {
    method,
    pathname: url.pathname,
    searchParams: url.searchParams,
    header: (name: string) => headers[name.toLowerCase()] || "",
    body: init.body ?? {},
  };
}

async function photoRows(db: Sql) {
  return db.query<{ id: string; google_id: string }>("select id, google_id from shared_photos");
}

test("pairing survives a second store on the same database", async () => {
  const db = await openMemorySql();
  const state = { ready: false, bytes: new Uint8Array([1, 2, 3, 4]) };
  const first = createPairStore(db, googleFetch(state));
  const second = createPairStore(db, googleFetch(state));
  const id = await first.newPair();
  const opened = await second.markPhonePairOpened(id);
  assert.deepEqual(opened, { ok: true });
  const claimed = await second.claimPhonePair(id, GOOGLE, 3600);
  assert.equal(claimed.pickerUri.startsWith("https://photos.google.com/"), true);
  const waiting = await first.readPhonePair(id);
  assert.equal(waiting.status, "picking");
  assert.equal("token" in waiting, false);
  state.ready = true;
  const done = await first.readPhonePair(id);
  assert.equal(done.status, "done");
  assert.equal(done.token, GOOGLE);
  assert.equal(done.sessionId, "sess-1");
  const missing = await second.readPhonePair("missing-code");
  assert.equal(missing.status, "error");
});

test("a join code cannot be claimed as a Google sign-in", async () => {
  const db = await openMemorySql();
  const pairs = createPairStore(db, googleFetch({ ready: false, bytes: new Uint8Array([1]) }));
  const id = await pairs.newPair({ purpose: "join", tvId: TV_A });
  await assert.rejects(pairs.claimPhonePair(id, GOOGLE, 3600), /shared album/);
});

test("shared album membership, changes, and access control", async () => {
  const db = await openMemorySql();
  const state = { ready: false, bytes: new Uint8Array([9, 8, 7, 6, 5]) };
  const fetchImpl = googleFetch(state);
  const share = createShareStore(db, fetchImpl);
  const pairs = createPairStore(db, fetchImpl);
  const created = await share.createAlbum(OWNER, "House");
  assert.equal(created.joinCode.length, 8);

  const started = await share.startPicker(OWNER, created.id, GOOGLE, 3600);
  assert.match(started.pickerUri, /^https:\/\/photos\.google\.com\//);
  const waiting = await share.tick(OWNER, created.id);
  assert.equal(waiting.status, "waiting");
  assert.equal((await photoRows(db)).length, 0);

  state.ready = true;
  const listed = await share.tick(OWNER, created.id);
  assert.equal(listed.status, "saving");
  assert.equal(listed.total, 1);
  const saved = await share.tick(OWNER, created.id);
  assert.equal(saved.status, "done");
  const jobs = await db.query<{ token: string | null; status: string }>("select token, status from share_jobs");
  assert.equal(jobs[0]?.status, "done");
  assert.equal(jobs[0]?.token, null);
  const stored = await photoRows(db);
  assert.equal(stored.length, 1);

  const joinedA = await share.join(created.joinCode, TV_A);
  const joinedB = await share.join(created.joinCode.toLowerCase(), TV_B);
  assert.notEqual(joinedA.memberToken, joinedB.memberToken);
  assert.equal(joinedA.memberToken.includes(GOOGLE), false);

  const firstSync = await share.sync(created.id, TV_A, joinedA.memberToken, -1);
  assert.equal(firstSync.unchanged, false);
  assert.equal(firstSync.photos?.length, 1);
  assert.equal(JSON.stringify(firstSync).includes(GOOGLE), false);
  assert.equal("index" in firstSync, false);
  assert.equal("clock" in firstSync, false);
  assert.equal("position" in firstSync, false);
  const caughtUp = await share.sync(created.id, TV_B, joinedB.memberToken, firstSync.revision);
  assert.equal(caughtUp.unchanged, true);
  assert.equal(JSON.stringify(caughtUp).includes("photos"), false);

  const photoId = firstSync.photos?.[0]?.id || "";
  const bytes = await share.readPhoto(photoId, TV_A, joinedA.memberToken);
  assert.deepEqual(bytes.bytes, state.bytes);
  await assert.rejects(share.readPhoto(photoId, "tv-cccc-3333", joinedA.memberToken), /cannot fetch|not in that album/);
  await assert.rejects(share.readPhoto(photoId, TV_A, "not-a-real-member-token-value"), /cannot fetch|not in that album/);

  await share.leave(created.id, TV_A, joinedA.memberToken);
  await assert.rejects(share.sync(created.id, TV_A, joinedA.memberToken, -1), /removed/);
  const stillThere = await share.sync(created.id, TV_B, joinedB.memberToken, -1);
  assert.equal(stillThere.photos?.length, 1);

  const rejoined = await share.join(created.joinCode, TV_A);
  await share.revokeTv(OWNER, created.id, TV_A);
  await assert.rejects(share.readPhoto(photoId, TV_A, rejoined.memberToken), /cannot fetch|removed/);
  const otherHouse = await share.sync(created.id, TV_B, joinedB.memberToken, -1);
  assert.equal(otherHouse.photos?.length, 1);

  const rotated = await share.rotateJoinCode(OWNER, created.id);
  await assert.rejects(share.join(created.joinCode, "tv-dddd-4444"), /does not match/);
  const afterRotate = await share.sync(created.id, TV_B, joinedB.memberToken, -1);
  assert.equal(afterRotate.photos?.length, 1);
  assert.notEqual(rotated.joinCode, created.joinCode);

  const httpOk = await handleShare(
    share,
    request("GET", `/api/share/photos/${photoId}`, {
      headers: { "x-lustre-tv": TV_B, "x-lustre-member": joinedB.memberToken },
    }),
  );
  assert.equal(httpOk.status, 200);
  assert.deepEqual(httpOk.bytes, state.bytes);
  assert.equal(JSON.stringify(httpOk.json || {}).includes(GOOGLE), false);

  await share.removePhoto(OWNER, created.id, photoId);
  const removed = await share.sync(created.id, TV_B, joinedB.memberToken, -1);
  assert.equal(removed.photos?.length, 0);
  assert.notEqual(removed.revision, firstSync.revision);

  const httpDenied = await handleShare(
    share,
    request("GET", `/api/share/photos/${photoId}`, { headers: { "x-lustre-tv": TV_B, "x-lustre-member": "short" } }),
  );
  assert.equal(httpDenied.status, 401);
  assert.equal(httpDenied.bytes, undefined);

  await share.deleteAlbum(OWNER, created.id);
  assert.equal((await photoRows(db)).length, 0);
  await assert.rejects(share.getAlbum(OTHER, created.id), /not on this phone/);

  const pairId = await pairs.newPair({ purpose: "join", tvId: TV_B });
  const again = await share.createAlbum(OWNER, "Again");
  await share.attach(OWNER, pairId, again.id);
  const joined = await pairs.readPhonePair(pairId);
  assert.equal(joined.status, "joined");
  assert.equal(joined.albumId, again.id);
  assert.equal("token" in joined, false);
  assert.equal(JSON.stringify(joined).includes(GOOGLE), false);
  assert.ok(joined.memberToken);
});

test("http sync refuses a television that never joined", async () => {
  const db = await openMemorySql();
  const share = createShareStore(db, googleFetch({ ready: true, bytes: new Uint8Array([1]) }));
  const created = await share.createAlbum(OWNER, "Hall");
  const result = await handleShare(
    share,
    request("GET", "/api/share/sync", {
      search: `?album=${created.id}&rev=0`,
      headers: { "x-lustre-tv": TV_A, "x-lustre-member": "this-is-not-a-member-token" },
    }),
  );
  assert.equal(result.status, 403);
  assert.equal(JSON.stringify(result.json).includes("bytes"), false);
});
