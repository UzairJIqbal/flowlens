// Absolute rather than "3m ago": a relative time is stale the moment it renders.
export function utc(timestamp: string): { date: string; time: string } {
  const iso = new Date(timestamp).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
