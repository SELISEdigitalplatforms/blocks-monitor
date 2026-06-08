import type { IProject } from "@blocks-identifier/models/project.model";

export const getDomain = (url: string = "") => {
  const trimUrl = url.trim();
  if (!isValidDomain(trimUrl)) return "";
  const hostname = new URL(trimUrl).hostname;
  const splits = hostname.split(".");
  return splits.slice(splits.length - 2).join(".");
};
export const isValidDomain = (domain: string) =>
  domainRegex.test(domain.trim());
export const domainRegex =
  /^(https?:\/\/)((?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,})$/;

export const getProjectBlocksApiUrl = (project: IProject): string => {
  const baseUrl = import.meta.env.BLOCKS_MONITOR_BASE_URL;
  if (!baseUrl) return "";
  return project.customDomain
    ? "blocksapi." + getDomain(project.customDomain)
    : baseUrl;
};
