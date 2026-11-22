"use strict";

const { request } = require("node:http");

async function main() {
  const url = process.env.MF_BLOCKS_BROKER_URL;
  const token = process.env.MF_BLOCKS_BROKER_TOKEN;
  if (!url || !token || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error();
  const body = JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() });
  const output = await new Promise((resolve, reject) => {
    const call = request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        try {
          if (response.statusCode !== 200) throw new Error();
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    call.on("error", reject);
    call.end(body);
  });
  if (typeof output.stdout !== "string") throw new Error();
  process.stdout.write(output.stdout);
}

main().catch(() => {
  process.stderr.write("The shared Blocks CLI command could not be completed.\n");
  process.exitCode = 1;
});
