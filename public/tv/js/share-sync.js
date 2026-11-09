export const SHARE_POLL_MS = 30000;

function takenValue(photo) {
  return Number(photo?.taken) || 0;
}

function comesBefore(photo, other) {
  const left = takenValue(photo);
  const right = takenValue(other);
  if (left && right && left !== right) return left < right;
  if (left && !right) return true;
  if (!left && right) return false;
  return String(photo.id || photo.remoteId || "").localeCompare(String(other.id || other.remoteId || "")) < 0;
}

export function planCatchUp(local, remote) {
  const have = new Set((local || []).map((item) => item.remoteId).filter(Boolean));
  const keep = new Set((remote || []).map((item) => item.id));
  const download = (remote || []).filter((item) => item.id && !have.has(item.id)).slice().sort((a, b) => {
    if (comesBefore(a, b)) return -1;
    if (comesBefore(b, a)) return 1;
    return 0;
  });
  const remove = (local || []).map((item) => item.remoteId).filter((id) => id && !keep.has(id));
  return { download, remove };
}

export function reconcilePlaylist(photos, index, additions, removeIds) {
  const current = photos[index] || null;
  const drop = new Set(removeIds || []);
  const next = photos.filter((photo) => !drop.has(photo.remoteId));
  for (const photo of additions || []) {
    const at = next.findIndex((item) => comesBefore(photo, item));
    if (at < 0) next.push(photo);
    else next.splice(at, 0, photo);
  }
  next.forEach((photo, i) => {
    photo.i = i;
  });
  let nextIndex = current ? next.indexOf(current) : 0;
  const removedCurrent = Boolean(current) && nextIndex < 0;
  if (nextIndex < 0) nextIndex = Math.min(Math.max(index, 0), Math.max(next.length - 1, 0));
  return { photos: next, index: next.length ? nextIndex : 0, removedCurrent };
}
