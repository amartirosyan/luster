export async function loadPickerList(sessionId: string, pageToken: string, token: string) {
  const query = new URLSearchParams({ sessionId, pageSize: "100" });
  if (pageToken) query.set("pageToken", pageToken);
  const upstream = await fetch(`https://photospicker.googleapis.com/v1/mediaItems?${query}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
    },
  });
  const text = await upstream.text();
  return text || "{}";
}
