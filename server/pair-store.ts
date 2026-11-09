import { createPickerSession, HttpError, pickerReady } from "./google-picker.ts";
import { cleanTvId, newPublicId } from "./secrets.ts";
import type { Sql } from "./sql.ts";

type FetchLike = typeof fetch;

export type PairView = {
  status: string;
  error?: string;
  token?: string;
  expiresIn?: number;
  sessionId?: string;
  albumId?: string;
  albumName?: string;
  memberToken?: string;
};

type PairRow = {
  id: string;
  status: string;
  purpose: string;
  tv_id: string | null;
  token: string | null;
  expires_in: number | null;
  session_id: string | null;
  error: string | null;
  album_id: string | null;
  album_name: string | null;
  member_token: string | null;
  token_expires_at: string | Date | null;
};

const PAIR_TTL = "20 minutes";

function remainingSeconds(value: string | Date | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.round(ms / 1000));
}

export function createPairStore(db: Sql, fetchImpl: FetchLike = fetch) {
  async function livePair(id: string): Promise<PairRow | null> {
    const rows = await db.query<PairRow>(
      "select * from pairs where id = $1 and expires_at > now()",
      [id],
    );
    return rows[0] || null;
  }

  return {
    async newPair(input?: { purpose?: string; tvId?: string }): Promise<string> {
      const purpose = input?.purpose === "join" ? "join" : "play";
      const tvId = cleanTvId(input?.tvId);
      if (input?.purpose === "join" && !tvId) {
        throw new HttpError(400, "This television could not introduce itself.");
      }
      const id = newPublicId();
      await db.query("delete from pairs where expires_at < now() - interval '1 day'");
      await db.query(
        `insert into pairs (id, status, purpose, tv_id, expires_at)
         values ($1, 'waiting', $2, $3, now() + interval '${PAIR_TTL}')`,
        [id, purpose, tvId || null],
      );
      return id;
    },

    async markPhonePairOpened(id: string): Promise<{ ok: true } | { error: string }> {
      const row = await livePair(id);
      if (!row) return { error: "That code expired. Make a new one on the television." };
      if (row.status === "waiting") {
        await db.query("update pairs set status = 'scanned' where id = $1 and status = 'waiting'", [id]);
      }
      return { ok: true };
    },

    async claimPhonePair(id: string, token: string, expiresIn: number): Promise<{ pickerUri: string }> {
      const row = await livePair(id);
      if (!row) throw new HttpError(404, "That code expired. Make a new one on the television.");
      if (row.purpose === "join") {
        throw new HttpError(400, "This code adds the television to a shared album.");
      }
      const seconds = Number.isFinite(expiresIn) && expiresIn > 60 ? Math.min(expiresIn, 3600) : 3600;
      const created = await createPickerSession(fetchImpl, token);
      await db.query(
        `update pairs
         set status = 'picking', token = $2, session_id = $3, expires_in = $4,
             token_expires_at = now() + ($4::int * interval '1 second'), error = null
         where id = $1`,
        [id, token, created.id, seconds],
      );
      return { pickerUri: created.pickerUri };
    },

    async readPhonePair(id: string): Promise<PairView> {
      const row = await livePair(id);
      if (!row) return { status: "error", error: "That code expired. Make a new one on the television." };
      if (row.status === "error") return { status: "error", error: row.error || "The phone sign-in failed." };
      if (row.status === "joined") {
        return {
          status: "joined",
          albumId: row.album_id || "",
          albumName: row.album_name || "",
          memberToken: row.member_token || "",
        };
      }
      if (row.status === "waiting") return { status: "waiting" };
      if (row.status === "scanned") return { status: "scanned" };
      if (row.status !== "picking" && row.status !== "done") return { status: row.status };

      if (row.status === "picking" && row.token && row.session_id) {
        if (remainingSeconds(row.token_expires_at) <= 0) {
          await db.query("update pairs set status = 'error', error = $2, token = null where id = $1", [
            id,
            "The Google sign-in expired. Start again on the phone.",
          ]);
          return { status: "error", error: "The Google sign-in expired. Start again on the phone." };
        }
        try {
          const res = await fetchImpl(
            `https://photospicker.googleapis.com/v1/sessions/${encodeURIComponent(row.session_id)}`,
            { headers: { Authorization: `Bearer ${row.token}`, Accept: "application/json" } },
          );
          if (res.status === 401 || res.status === 403) {
            await db.query("update pairs set status = 'error', error = $2, token = null where id = $1", [
              id,
              "The Google sign-in expired. Start again on the phone.",
            ]);
            return { status: "error", error: "The Google sign-in expired. Start again on the phone." };
          }
          if (res.ok) {
            const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
            if (pickerReady(body)) {
              await db.query("update pairs set status = 'done' where id = $1", [id]);
              row.status = "done";
            }
          }
        } catch {
          /* a missed poll keeps the code in picking */
        }
      }

      if (row.status !== "done") return { status: row.status === "done" ? "done" : "picking" };
      if (!row.token || !row.session_id) {
        return { status: "error", error: "The photo selection was lost. Start again on the phone." };
      }
      return {
        status: "done",
        token: row.token,
        expiresIn: remainingSeconds(row.token_expires_at) || row.expires_in || 0,
        sessionId: row.session_id,
      };
    },
  };
}

export async function getPairStore() {
  const { getDb } = await import("./sql.ts");
  return createPairStore(await getDb());
}

export async function newPair(input?: { purpose?: string; tvId?: string }) {
  return (await getPairStore()).newPair(input);
}

export async function markPhonePairOpened(id: string) {
  return (await getPairStore()).markPhonePairOpened(id);
}

export async function claimPhonePair(id: string, token: string, expiresIn: number) {
  return (await getPairStore()).claimPhonePair(id, token, expiresIn);
}

export async function readPhonePair(id: string) {
  return (await getPairStore()).readPhonePair(id);
}
