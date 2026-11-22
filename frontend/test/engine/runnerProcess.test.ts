import { describe, expect, it } from 'vitest';
import { execRunner } from '../../server/local/engine/ai/runnerProcess';

describe('server runner lifecycle', () => {
  it('stops a running provider on cancellation and waits for exit', async () => {
    const controller = new AbortController();
    let toolPid = 0;
    const result = await new Promise<{ error: Error | null; pid: number | undefined }>((resolve) => {
      const child = execRunner(process.execPath, ['-e', "const tool = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']); process.stdout.write(String(tool.pid)); setInterval(() => {}, 1000)"],
        { signal: controller.signal, timeout: 10_000 }, (error) => resolve({ error, pid: child.pid }));
      child.stdout!.once('data', (chunk) => { toolPid = Number(String(chunk)); controller.abort(); });
    });
    expect(result.error?.message).toBe('cancelled');
    expect(() => process.kill(result.pid!, 0)).toThrow();
    expect(toolPid).toBeGreaterThan(0);
    // the tool got the group's SIGKILL with its parent; once orphaned it is reaped by the system a moment later (under
    // load that can be after the runner's callback), so wait for it to be gone rather than checking the same instant
    const gone = async (pid: number) => {
      for (let i = 0; i < 40; i++) {
        try { process.kill(pid, 0); } catch { return true; }
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    expect(await gone(toolPid)).toBe(true);
  }, 15_000);

  it('keeps normal output and exit failures', async () => {
    const result = await new Promise<{ error: Error | null; stdout: string }>((resolve) => {
      execRunner(process.execPath, ['-e', "process.stdout.write('result'); process.exitCode = 2"], {},
        (error, stdout) => resolve({ error, stdout }));
    });
    expect(result.stdout).toBe('result');
    expect(result.error?.message).toContain('2');
  });
});
