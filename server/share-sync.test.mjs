import assert from "node:assert/strict";
import { test } from "node:test";
import { planCatchUp, reconcilePlaylist, SHARE_POLL_MS } from "../public/tv/js/share-sync.js";

test("a television that was offline asks only for what it does not have", () => {
  const plan = planCatchUp(
    [
      { remoteId: "a" },
      { remoteId: "gone" },
    ],
    [
      { id: "b", taken: 20 },
      { id: "a", taken: 10 },
      { id: "c", taken: 5 },
    ],
  );
  assert.deepEqual(plan.download.map((item) => item.id), ["c", "b"]);
  assert.deepEqual(plan.remove, ["gone"]);
});

test("playback keeps its place when photos arrive or leave", () => {
  const current = { remoteId: "a", taken: 10, i: 0 };
  const later = { remoteId: "b", taken: 30, i: 1 };
  const added = { remoteId: "mid", taken: 20, i: -1 };
  const merged = reconcilePlaylist([current, later], 1, [added], []);
  assert.equal(merged.photos[1], added);
  assert.equal(merged.photos[2], later);
  assert.equal(merged.index, 2);
  assert.equal(merged.removedCurrent, false);

  const dropped = reconcilePlaylist(merged.photos, merged.index, [], ["b"]);
  assert.equal(dropped.removedCurrent, true);
  assert.equal(dropped.photos.includes(later), false);
});

test("shared albums poll slowly enough to stay cheap", () => {
  assert.ok(SHARE_POLL_MS >= 20000);
});
