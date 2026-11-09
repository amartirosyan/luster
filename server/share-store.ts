import {
  createPickerSession,
  downloadPickedPhoto,
  HttpError,
  isStillImage,
  listPickedItems,
  pickerSessionReady,
  type PickedItem,
} from "./google-picker.ts";
import { cleanAlbumName, cleanJoinCode, cleanTvId, hashSecret, newJoinCode, newPublicId, newSecret } from "./secrets.ts";
import type { Sql } from "./sql.ts";

type FetchLike = typeof fetch;

const MAX_PHOTOS = 200;
const MAX_PHOTO_BYTES = 4_000_000;

type AlbumRow = {
  id: string;
  name: string;
  owner_hash: string;
  join_code: string;
  revision: number;
};

type MemberRow = {
  album_id: string;
  tv_id: string;
  revoked_at: string | null;
};

type JobRow = {
  id: string;
  album_id: string;
  session_id: string | null;
  token: string | null;
  status: string;
  cursor_at: number;
  items_json: string | null;
  error: string | null;
  expires_at: string | Date | null;
};

export type PhotoMeta = {
  id: string;
  taken: number;
  filename: string;
  mime: string;
  bytes: number;
};

function takenMillis(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function fileTitle(name: string): string {
  const base = (name || "Photo").split(/[/\\]/).pop() || "Photo";
  return base.slice(0, 120);
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string" && value.startsWith("\\x")) {
    return new Uint8Array(Buffer.from(value.slice(2), "hex"));
  }
  throw new HttpError(500, "A stored photo could not be read.");
}

async function uniqueJoinCode(db: Sql): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = newJoinCode();
    const rows = await db.query("select id from shared_albums where join_code = $1", [code]);
    if (!rows.length) return code;
  }
  throw new HttpError(500, "Could not make a join code.");
}

export function createShareStore(db: Sql, fetchImpl: FetchLike = fetch) {
  async function ownerAlbum(ownerKey: string, albumId: string): Promise<AlbumRow> {
    const key = String(ownerKey || "");
    if (key.length < 20) throw new HttpError(401, "Sign in on this phone again.");
    const rows = await db.query<AlbumRow>(
      "select id, name, owner_hash, join_code, revision from shared_albums where id = $1 and owner_hash = $2",
      [albumId, hashSecret(key)],
    );
    if (!rows[0]) throw new HttpError(404, "That shared album is not on this phone.");
    return rows[0];
  }

  async function memberAlbum(albumId: string, tvId: string, memberToken: string): Promise<AlbumRow> {
    const tv = cleanTvId(tvId);
    const token = String(memberToken || "");
    if (!tv || token.length < 20) throw new HttpError(401, "This television is not in that album.");
    const rows = await db.query<AlbumRow & { revoked_at: string | null }>(
      `select a.id, a.name, a.owner_hash, a.join_code, a.revision, m.revoked_at
       from shared_albums a
       join shared_members m on m.album_id = a.id
       where a.id = $1 and m.tv_id = $2 and m.token_hash = $3`,
      [albumId, tv, hashSecret(token)],
    );
    const row = rows[0];
    if (!row || row.revoked_at) throw new HttpError(403, "This television was removed from the shared album.");
    return row;
  }

  async function grantMember(albumId: string, tvId: string): Promise<string> {
    const memberToken = newSecret();
    await db.query(
      `insert into shared_members (album_id, tv_id, token_hash)
       values ($1, $2, $3)
       on conflict (album_id, tv_id)
       do update set token_hash = excluded.token_hash, revoked_at = null, joined_at = now()`,
      [albumId, tvId, hashSecret(memberToken)],
    );
    return memberToken;
  }

  async function photoCount(albumId: string): Promise<number> {
    const rows = await db.query<{ count: string | number }>(
      "select count(*)::int as count from shared_photos where album_id = $1",
      [albumId],
    );
    return Number(rows[0]?.count || 0);
  }

  return {
    async createAlbum(ownerKey: string, name: string) {
      const key = String(ownerKey || "");
      if (key.length < 20) throw new HttpError(401, "This phone needs a new owner key.");
      const title = cleanAlbumName(name) || "Shared album";
      const id = newPublicId();
      const joinCode = await uniqueJoinCode(db);
      await db.query(
        `insert into shared_albums (id, name, owner_hash, join_code)
         values ($1, $2, $3, $4)`,
        [id, title, hashSecret(key), joinCode],
      );
      return { id, name: title, joinCode, revision: 0 };
    },

    async listAlbums(ownerKey: string) {
      const key = String(ownerKey || "");
      if (key.length < 20) throw new HttpError(401, "Sign in on this phone again.");
      const rows = await db.query<{ id: string; name: string; join_code: string; revision: number }>(
        `select id, name, join_code, revision from shared_albums
         where owner_hash = $1 order by updated_at desc`,
        [hashSecret(key)],
      );
      const albums = [];
      for (const row of rows) {
        albums.push({
          id: row.id,
          name: row.name,
          joinCode: row.join_code,
          revision: Number(row.revision) || 0,
          count: await photoCount(row.id),
        });
      }
      return albums;
    },

    async getAlbum(ownerKey: string, albumId: string) {
      const album = await ownerAlbum(ownerKey, albumId);
      const photos = await db.query<{ id: string; filename: string; taken: string | number; mime: string }>(
        `select id, filename, taken, mime from shared_photos
         where album_id = $1 order by taken asc, id asc`,
        [album.id],
      );
      const members = await db.query<{ tv_id: string; joined_at: string | Date; revoked_at: string | null }>(
        `select tv_id, joined_at, revoked_at from shared_members
         where album_id = $1 order by joined_at asc`,
        [album.id],
      );
      return {
        id: album.id,
        name: album.name,
        joinCode: album.join_code,
        revision: Number(album.revision) || 0,
        photos: photos.map((photo) => ({
          id: photo.id,
          filename: photo.filename || "Photo",
          taken: Number(photo.taken) || 0,
          mime: photo.mime,
        })),
        members: members.map((member) => ({
          tvId: member.tv_id,
          joinedAt: new Date(member.joined_at).toISOString(),
          revoked: Boolean(member.revoked_at),
        })),
      };
    },

    async renameAlbum(ownerKey: string, albumId: string, name: string) {
      const album = await ownerAlbum(ownerKey, albumId);
      const title = cleanAlbumName(name);
      if (!title) throw new HttpError(400, "The album needs a name.");
      await db.query("update shared_albums set name = $2, updated_at = now() where id = $1", [album.id, title]);
      return { id: album.id, name: title };
    },

    async rotateJoinCode(ownerKey: string, albumId: string) {
      const album = await ownerAlbum(ownerKey, albumId);
      const joinCode = await uniqueJoinCode(db);
      await db.query("update shared_albums set join_code = $2, updated_at = now() where id = $1", [album.id, joinCode]);
      return { id: album.id, joinCode };
    },

    async deleteAlbum(ownerKey: string, albumId: string) {
      const album = await ownerAlbum(ownerKey, albumId);
      await db.query("delete from shared_albums where id = $1", [album.id]);
      return { ok: true };
    },

    async removePhoto(ownerKey: string, albumId: string, photoId: string) {
      const album = await ownerAlbum(ownerKey, albumId);
      const bumped = await db.query<{ revision: number }>(
        `with del as (
           delete from shared_photos where id = $1 and album_id = $2 returning id
         )
         update shared_albums
         set revision = revision + 1, updated_at = now()
         where id = $2 and exists (select 1 from del)
         returning revision`,
        [photoId, album.id],
      );
      if (!bumped.length) throw new HttpError(404, "That photo is already gone.");
      return { revision: Number(bumped[0].revision) || 0 };
    },

    async revokeTv(ownerKey: string, albumId: string, tvId: string) {
      const album = await ownerAlbum(ownerKey, albumId);
      const tv = cleanTvId(tvId);
      if (!tv) throw new HttpError(400, "That television is not in the album.");
      const rows = await db.query<MemberRow>(
        `update shared_members set revoked_at = now()
         where album_id = $1 and tv_id = $2 and revoked_at is null
         returning album_id, tv_id, revoked_at`,
        [album.id, tv],
      );
      if (!rows.length) throw new HttpError(404, "That television is not in the album.");
      return { ok: true };
    },

    async join(code: string, tvId: string) {
      const tv = cleanTvId(tvId);
      const joinCode = cleanJoinCode(code);
      if (!tv) throw new HttpError(400, "This television could not introduce itself.");
      if (joinCode.length < 8) throw new HttpError(400, "Enter the 8-character join code.");
      const rows = await db.query<AlbumRow>(
        "select id, name, owner_hash, join_code, revision from shared_albums where join_code = $1",
        [joinCode],
      );
      const album = rows[0];
      if (!album) throw new HttpError(404, "That join code does not match an album.");
      const memberToken = await grantMember(album.id, tv);
      return {
        albumId: album.id,
        albumName: album.name,
        revision: Number(album.revision) || 0,
        memberToken,
      };
    },

    async leave(albumId: string, tvId: string, memberToken: string) {
      await memberAlbum(albumId, tvId, memberToken);
      await db.query(
        `update shared_members set revoked_at = now()
         where album_id = $1 and tv_id = $2 and token_hash = $3 and revoked_at is null`,
        [albumId, cleanTvId(tvId), hashSecret(memberToken)],
      );
      return { ok: true };
    },

    async attach(ownerKey: string, pairId: string, albumId: string) {
      const album = await ownerAlbum(ownerKey, albumId);
      const pairs = await db.query<{ id: string; purpose: string; tv_id: string | null }>(
        "select id, purpose, tv_id from pairs where id = $1 and expires_at > now()",
        [pairId],
      );
      const pair = pairs[0];
      if (!pair) throw new HttpError(404, "That television code expired. Show a new one.");
      if (pair.purpose !== "join") {
        throw new HttpError(400, "That code is for sending photos to one television.");
      }
      const tv = cleanTvId(pair.tv_id);
      if (!tv) throw new HttpError(400, "That television did not introduce itself. Show a new code.");
      const memberToken = await grantMember(album.id, tv);
      await db.query(
        `update pairs
         set status = 'joined', album_id = $2, album_name = $3, member_token = $4, token = null
         where id = $1`,
        [pair.id, album.id, album.name, memberToken],
      );
      return { ok: true, albumId: album.id, albumName: album.name };
    },

    async sync(albumId: string, tvId: string, memberToken: string, revision: number) {
      const album = await memberAlbum(albumId, tvId, memberToken);
      const current = Number(album.revision) || 0;
      if (Number.isFinite(revision) && revision === current) {
        return { revision: current, unchanged: true, name: album.name };
      }
      const photos = await db.query<{
        id: string;
        filename: string | null;
        mime: string;
        taken: string | number;
        bytes: number | string;
      }>(
        `select id, filename, mime, taken, octet_length(bytes)::int as bytes
         from shared_photos where album_id = $1 order by taken asc, id asc`,
        [album.id],
      );
      return {
        revision: current,
        unchanged: false,
        name: album.name,
        photos: photos.map((photo) => ({
          id: photo.id,
          taken: Number(photo.taken) || 0,
          filename: photo.filename || "Photo",
          mime: photo.mime,
          bytes: Number(photo.bytes) || 0,
        })) satisfies PhotoMeta[],
      };
    },

    async readPhoto(photoId: string, tvId: string, memberToken: string) {
      const tv = cleanTvId(tvId);
      const token = String(memberToken || "");
      if (!tv || token.length < 20) throw new HttpError(401, "This television is not in that album.");
      const rows = await db.query<{ mime: string; bytes: unknown; revoked_at: string | null }>(
        `select p.mime, p.bytes, m.revoked_at
         from shared_photos p
         join shared_members m on m.album_id = p.album_id
         where p.id = $1 and m.tv_id = $2 and m.token_hash = $3`,
        [photoId, tv, hashSecret(token)],
      );
      const row = rows[0];
      if (!row || row.revoked_at) throw new HttpError(403, "This television cannot fetch that photo.");
      return { mime: row.mime || "image/jpeg", bytes: asBytes(row.bytes) };
    },

    async startPicker(ownerKey: string, albumId: string, token: string, expiresIn: number) {
      const album = await ownerAlbum(ownerKey, albumId);
      if (!token) throw new HttpError(400, "Missing sign-in.");
      if ((await photoCount(album.id)) >= MAX_PHOTOS) {
        throw new HttpError(400, `A shared album holds up to ${MAX_PHOTOS} photos.`);
      }
      const seconds = Number.isFinite(expiresIn) && expiresIn > 60 ? Math.min(expiresIn, 3600) : 3600;
      const created = await createPickerSession(fetchImpl, token);
      await db.query("delete from share_jobs where album_id = $1", [album.id]);
      const jobId = newPublicId();
      await db.query(
        `insert into share_jobs (id, album_id, session_id, token, expires_at, status)
         values ($1, $2, $3, $4, now() + ($5::int * interval '1 second'), 'waiting')`,
        [jobId, album.id, created.id, token, seconds],
      );
      return { pickerUri: created.pickerUri, jobId };
    },

    async tick(ownerKey: string, albumId: string) {
      const album = await ownerAlbum(ownerKey, albumId);
      const jobs = await db.query<JobRow>(
        `select id, album_id, session_id, token, status, cursor_at, items_json, error, expires_at
         from share_jobs where album_id = $1 order by created_at desc limit 1`,
        [album.id],
      );
      const job = jobs[0];
      if (!job || job.status === "done") return { status: "idle" };
      if (job.status === "error") return { status: "error", error: job.error || "Could not save the photos." };
      if (!job.token || !job.session_id) {
        return { status: "error", error: "The photo selection was lost. Add the photos again." };
      }
      if (job.expires_at && new Date(job.expires_at).getTime() <= Date.now()) {
        await db.query("update share_jobs set status = 'error', token = null, error = $2 where id = $1", [
          job.id,
          "The Google sign-in expired. Add the photos again.",
        ]);
        return { status: "error", error: "The Google sign-in expired. Add the photos again." };
      }

      let items: PickedItem[] = [];
      if (!job.items_json) {
        let ready = false;
        try {
          ready = await pickerSessionReady(fetchImpl, job.token, job.session_id);
        } catch (err) {
          if (err instanceof HttpError && err.status === 401) {
            await db.query("update share_jobs set status = 'error', token = null, error = $2 where id = $1", [
              job.id,
              err.message,
            ]);
          }
          throw err;
        }
        if (!ready) return { status: "waiting", saved: 0, total: 0 };
        const picked = (await listPickedItems(fetchImpl, job.token, job.session_id)).filter(isStillImage);
        await db.query("update share_jobs set items_json = $2, status = 'saving', cursor_at = 0 where id = $1", [
          job.id,
          JSON.stringify(picked),
        ]);
        return { status: "saving", saved: 0, total: picked.length, revision: Number(album.revision) || 0 };
      }

      try {
        items = JSON.parse(job.items_json) as PickedItem[];
      } catch {
        items = [];
      }
      const cursor = Number(job.cursor_at) || 0;
      if (cursor >= items.length) {
        await db.query("update share_jobs set status = 'done', token = null, items_json = null where id = $1", [job.id]);
        const fresh = await db.query<{ revision: number }>("select revision from shared_albums where id = $1", [album.id]);
        return { status: "done", saved: items.length, total: items.length, revision: Number(fresh[0]?.revision) || 0 };
      }

      const item = items[cursor];
      let added = false;
      try {
        if ((await photoCount(album.id)) >= MAX_PHOTOS) {
          throw new HttpError(400, `A shared album holds up to ${MAX_PHOTOS} photos.`);
        }
        const file = await downloadPickedPhoto(fetchImpl, job.token, item.baseUrl, MAX_PHOTO_BYTES);
        const photoId = newPublicId();
        const bumped = await db.query<{ revision: number }>(
          `with ins as (
             insert into shared_photos (id, album_id, google_id, filename, mime, taken, bytes)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (album_id, google_id) do nothing
             returning id
           )
           update shared_albums
           set revision = revision + 1, updated_at = now()
           where id = $2 and exists (select 1 from ins)
           returning revision`,
          [photoId, album.id, item.id, fileTitle(item.filename), file.mime, takenMillis(item.createTime), file.bytes],
        );
        added = bumped.length > 0;
      } catch (err) {
        if (err instanceof HttpError && (err.status === 413 || err.status === 400)) {
          await db.query("update share_jobs set cursor_at = $2, error = $3 where id = $1", [
            job.id,
            cursor + 1,
            err.message,
          ]);
          return { status: "saving", saved: cursor + 1, total: items.length, skipped: err.message };
        }
        throw err;
      }
      await db.query("update share_jobs set cursor_at = $2, error = null where id = $1", [job.id, cursor + 1]);
      const fresh = await db.query<{ revision: number }>("select revision from shared_albums where id = $1", [album.id]);
      const next = cursor + 1;
      if (next >= items.length) {
        await db.query("update share_jobs set status = 'done', token = null, items_json = null where id = $1", [job.id]);
        return {
          status: "done",
          saved: next,
          total: items.length,
          added,
          revision: Number(fresh[0]?.revision) || 0,
        };
      }
      return {
        status: "saving",
        saved: next,
        total: items.length,
        added,
        revision: Number(fresh[0]?.revision) || 0,
      };
    },
  };
}

export type ShareStore = ReturnType<typeof createShareStore>;

export async function getShareStore(): Promise<ShareStore> {
  const { getDb } = await import("./sql.ts");
  return createShareStore(await getDb());
}
