import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function githubTokenKey(raw: string | undefined): Buffer | null {
  return raw && /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null;
}
export function encryptGithubToken(key: Buffer, tenant: string, userId: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(["github/v1", tenant, userId])));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
export function decryptGithubToken(key: Buffer, tenant: string, userId: string, value: string): string {
  try {
    const [version, iv, body, tag, extra] = value.split(".");
    if (version !== "v1" || extra !== undefined || !iv || !body || !tag || value.length > 20_000) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(JSON.stringify(["github/v1", tenant, userId])));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("github_credential_unavailable"); }
}
