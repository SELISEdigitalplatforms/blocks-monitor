/** The types of a brief's material: the files and the repository a brief names, and the request as it was sent.
 *  The brief itself is a Blocks record (see src/blocks/projects); nothing here is stored in the browser. */
import type { MaterialKind } from "./IntakeShared";

/** One file of the client's material. */
export interface RequestFile { id: string; name: string; kind: string; size: number; uploaded: boolean }

/** Where the factory delivers the code: a GitHub repository (new or existing) and the branch it works on. */
export interface RequestRepository {
  provider: "github";
  /** who connected GitHub (the signed-in person's name) */
  account: string;
  owner: string;
  name: string;
  mode: "new" | "existing";
  visibility: "private" | "internal";
  branch: string;
}

/** The request as the requester sent it to the factory. */
export interface RequestInfo {
  name: string;
  client: { name: string; industry: string; city: string; contact: string };
  /** ISO time the material was sent */
  createdAt: string;
  files: RequestFile[];
  /** the code repository chosen on the brief (optional; requests saved before it have no field) */
  repository?: RequestRepository | null;
}

export interface DraftItem {
  id: string;
  name: string;
  kind: MaterialKind;
  /** bytes */
  size: number;
  meta: string;
  origin: "example" | "upload" | "paste";
  read: boolean;
  readNote?: string;
}

/** The organisation the project is for and its key contact, kept in RequestInfo.client;
 *  `city` holds the region. */
export interface DraftClient { name: string; industry: string; city: string; contact: string }

export interface DraftData {
  /** the organisation and its key contact */
  client: DraftClient;
  name: string;
  /** the name is the factory's suggestion (cleared once you type) */
  nameSuggested: boolean;
  items: DraftItem[];
  /** your brief: what you need, in your own words */
  words: string;
  /** the brief was sent from this draft */
  submitted: boolean;
}

export const emptyClient = (): DraftClient => ({ name: "", industry: "", city: "", contact: "" });

/** A short unique id for staged items. */
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
