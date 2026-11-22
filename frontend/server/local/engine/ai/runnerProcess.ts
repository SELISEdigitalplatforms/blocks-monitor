import { execFile, spawn, type ExecFileOptions, type ChildProcess } from 'node:child_process';

/** Own the provider process group, including tools it launches. */
export function execRunner(file: string, args: string[], options: ExecFileOptions,
  callback: (error: (Error & { code?: string | number; killed?: boolean; stdout?: string; stderr?: string }) | null, stdout: string, stderr: string) => void): ChildProcess {
  const { signal, timeout, maxBuffer = 10 * 1024 * 1024, ...rest } = options;
  let stopping: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure: (Error & { code?: string | number; killed?: boolean }) | null = null;
  let stdout = '', stderr = '', bytes = 0;
  const child = spawn(file, args, { ...rest, detached: process.platform !== 'win32', stdio: 'pipe' });
  const collect = (chunk: string, out: boolean) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBuffer) { failure = new Error('Runner output exceeded its limit'); stop(); return; }
    if (out) stdout += chunk; else stderr += chunk;
  };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, true));
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, false));
  child.on('error', (error) => { failure = error; });
  child.once('close', (code) => {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    void (async () => {
      await stopping;
      if (stopping && !failure) failure = Object.assign(new Error(signal?.aborted ? 'cancelled' : 'Runner timed out'), { killed: true });
      if (code !== 0 && !failure) failure = Object.assign(new Error(`Runner exited with code ${code}`), { code: code ?? undefined });
      callback(failure ? Object.assign(failure, { stdout, stderr }) : null, stdout, stderr);
    })();
  });
  function stop(): void {
    if (stopping || !child.pid) return;
    const pid = child.pid;
    stopping = new Promise<void>((resolve) => {
      if (process.platform === 'win32') {
        execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, (error) => {
          if (error) child.kill('SIGKILL');
          resolve();
        });
      } else {
        try { process.kill(-pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        resolve();
      }
    });
  }
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  if (timeout && timeout > 0) timer = setTimeout(stop, timeout);
  return child;
}
