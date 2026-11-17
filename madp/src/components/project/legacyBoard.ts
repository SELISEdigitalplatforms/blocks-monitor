/** The Board is the first tab of the Build step (owner 20.10.2026): an old /p/:id/board link opens /p/:id/build?tab=board and keeps its other parameters (e.g. ?ticket=<ItemId> from chat cards and notifications). */
export function legacyBoardTarget(projectId: string, search: string): string {
  const q = new URLSearchParams(search);
  q.set("tab", "board");
  return `/p/${projectId}/build?${q.toString()}`;
}
