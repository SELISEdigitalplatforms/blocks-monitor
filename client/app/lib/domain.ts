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
