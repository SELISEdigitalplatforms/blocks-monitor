import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import selfsigned from "selfsigned";
import { loadEnv } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv("development", root, "");
const host = process.argv[2] || env.VITE_BLOCKS_DEV_HOST;
if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error("Set VITE_BLOCKS_DEV_HOST to the approved app hostname.");
const dir = path.join(root, ".cert");
const cert = path.join(dir, "dev-cert.pem");
const key = path.join(dir, "dev-key.pem");
if (fs.existsSync(cert) || fs.existsSync(key)) {
  if (!fs.existsSync(cert) || !fs.existsSync(key)) throw new Error("Incomplete certificate pair. Inspect .cert before regenerating.");
  console.log("Existing certificate pair preserved.");
} else {
  const pems = selfsigned.generate([{ name: "commonName", value: host }], {
    days: 90, keySize: 2048, algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: host }, { type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(key, pems.private, { mode: 0o600 });
  fs.writeFileSync(cert, pems.cert);
  console.log(`Created a 90-day development certificate for ${host}. Private key is gitignored.`);
}
console.log(`Windows current-user trust: certutil -user -addstore Root "${cert}"`);
console.log(`Local app: https://${host}:${env.VITE_BLOCKS_DEV_PORT || "5310"}`);
