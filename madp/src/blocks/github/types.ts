/**
 * The GitHub connection of the signed-in person: one interface the app talks to. Today the PREVIEW placeholder
 * (./preview.ts) implements it; the real GitHub App backend implements the same interface later and replaces it in
 * ./index.ts, so no screen changes.
 */

/** Who is asking. The real backend knows the person from the session cookie; the preview keys its memory by userId. */
export interface GithubViewer { userId: string; name: string; email: string }

export interface GithubConnection {
  connected: boolean;
  /** The GitHub login, without "@"; null when not connected. */
  login: string | null;
  /** When the connection was made (ISO); null when not connected. */
  connectedAt: string | null;
}

export interface GithubRepo {
  owner: string;
  name: string;
  /** "owner/name" */
  fullName: string;
  /** Null when Blocks has not supplied repository visibility. */
  private: boolean | null;
  defaultBranch: string;
  /** Last push (ISO). */
  updatedAt: string;
  description: string;
}

export interface GithubBranch { name: string; isDefault: boolean }

export interface GithubSource {
  /** True for the placeholder: the screens mark it as a preview. */
  readonly preview: boolean;
  /** Where the person chooses which repositories MADP may see (the GitHub App's installation settings). */
  readonly manageAccessUrl: string;
  status(viewer: GithubViewer): Promise<GithubConnection>;
  /** Connects the person's GitHub account (the real backend sends them through GitHub's consent screen). */
  connect(viewer: GithubViewer): Promise<GithubConnection>;
  disconnect(viewer: GithubViewer): Promise<GithubConnection>;
  /** The repositories the person gave MADP access to, most recently updated first. */
  repos(viewer: GithubViewer): Promise<GithubRepo[]>;
  /** The branches of one of those repositories, the default branch first. */
  branches(viewer: GithubViewer, owner: string, name: string): Promise<GithubBranch[]>;
}
