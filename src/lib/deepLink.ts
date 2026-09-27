/**
 * Command Center deep links (Control Center Foundation): the palette
 * navigates to `<listPath>?q=<term>` for a search result and
 * `<listPath>?new=1` for a "New …" quick action. Each list page reads
 * these once on mount rather than the palette trying to reach into a
 * specific record's UI directly.
 */
export function initialSearchFromQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

/** Returns true once if `?new=1` was present, and strips it from the URL so it doesn't re-fire on back/forward navigation. */
export function consumeNewFlag(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("new") !== "1") return false;
  params.delete("new");
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  return true;
}
