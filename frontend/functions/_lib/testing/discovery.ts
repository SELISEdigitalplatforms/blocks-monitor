// Test kit only: the same op discovery the build uses, so a lane can assert that its ops are registered.
import { ROOT, listOpFiles } from "../../../scripts/functions-common.mjs";
import { collectOps } from "../registry";

export async function listRegisteredOps(fn: string): Promise<string[]> {
  const files: string[] = listOpFiles(ROOT, fn);
  const modules: [string, unknown][] = [];
  for (const file of files) modules.push([file, await import(/* @vite-ignore */ file)]);
  const found: unknown = (collectOps as (m: [string, unknown][]) => unknown)(modules);
  const names = Array.isArray(found)
    ? found.map((o: any) => o.op as string)
    : found instanceof Map
      ? [...found.keys()]
      : Object.keys(found as object);
  return names.sort();
}
