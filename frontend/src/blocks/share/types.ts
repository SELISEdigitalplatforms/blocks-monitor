// External share links: item kinds, expiry choices and the view the function host returns (never the token hash).
export const SHARE_LINK_ITEM_TYPES = [
  "doc.file", "doc.note", "design.screen", "attachment", "wiki.page", "change.request", "change.attachment", "release.preview", "scope",
] as const;
export type ShareLinkItemType = (typeof SHARE_LINK_ITEM_TYPES)[number];

export const SHARE_LINK_EXPIRY_DAYS = [1, 7, 30] as const;
export type ShareLinkExpiryDays = 1 | 7 | 30;
export const SHARE_LINK_DEFAULT_DAYS = 7;

export interface ShareLinkView {
  id: string;
  projectId: string;
  itemType: ShareLinkItemType;
  itemRef: string;
  createdByUserId: string;
  createdDate: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

export function shareLinkUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/s/${token}`;
}
