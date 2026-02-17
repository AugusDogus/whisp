/**
 * Returns a compact relative timestamp like Snapchat.
 * e.g. "Just now", "3m ago", "2h ago", "1d ago", "2w ago", "Jan 5"
 */
export function getRelativeTime(date: Date | null): string {
  if (!date) return "";
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  if (diff < 0) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
