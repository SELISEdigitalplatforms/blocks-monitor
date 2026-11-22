// The GitHub connection the app uses. Auto-detects: real OAuth when the backend is configured,
// preview placeholder otherwise. The screens and hooks stay identical either way.
import { previewGithub } from "./preview";
import { realGithub } from "./real";
import type { GithubSource } from "./types";
import { usesBlocksCloud } from "../config";

/** Check if the real GitHub backend is available by probing the health endpoint. */
async function detectGithub(): Promise<boolean> {
  try {
    const res = await fetch("/api/github/status/_probe", { method: "GET" });
    // 200 or 401 both mean the backend is there (401 = not connected, which is fine)
    return res.status < 500;
  } catch {
    return false;
  }
}

// Start with preview; swap to real once the backend is confirmed available.
// The swap happens once on app startup, before any GitHub call lands.
let _source: GithubSource = usesBlocksCloud() ? realGithub : previewGithub;
// Cloud mode must never silently report a fabricated GitHub connection.
if (!usesBlocksCloud()) detectGithub().then((real) => { if (real) _source = realGithub; });

export const github: GithubSource = {
  get preview() { return _source.preview; },
  get manageAccessUrl() { return _source.manageAccessUrl; },
  status: (v) => _source.status(v),
  connect: (v) => _source.connect(v),
  disconnect: (v) => _source.disconnect(v),
  repos: (v) => _source.repos(v),
  branches: (v, o, n) => _source.branches(v, o, n),
};
