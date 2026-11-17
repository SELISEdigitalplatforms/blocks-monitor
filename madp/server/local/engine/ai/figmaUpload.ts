import fs from 'node:fs';
import path from 'node:path';

/** Provider uploads run in the authorized worker host, not the model CLI's restricted shell. */
export function startFigmaUploadBridge(directory: string, fetcher: typeof fetch = fetch): () => void {
  let busy = false, stopped = false;
  const request = path.join(directory, 'figma-upload-request.json');
  const response = path.join(directory, 'figma-upload-response.json');
  const timer = setInterval(() => {
    if (busy || stopped || !fs.existsSync(request)) return;
    busy = true;
    void (async () => {
      let requestId: string | undefined;
      const respond = (value: object) => {
        const temporary = `${response}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ ...value, ...(requestId ? { requestId } : {}) }), { mode: 0o600 });
        fs.renameSync(temporary, response);
      };
      try {
        if (fs.lstatSync(request).isSymbolicLink() || fs.statSync(request).size > 16384) throw new Error('invalid_request');
        const input = JSON.parse(fs.readFileSync(request, 'utf8').replace(/^\uFEFF/, ''));
        fs.unlinkSync(request); // Single-use provider URL must not remain in project artifacts.
        if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.requestId))) throw new Error('invalid_request');
        requestId = input.requestId;
        if (fs.existsSync(response)) fs.unlinkSync(response);
        const url = new URL(input.url);
        if (url.protocol !== 'https:' || url.hostname !== 'mcp.figma.com' || url.port || url.username || url.password ||
          !/html/i.test(url.pathname) || typeof input.file !== 'string' || !/^[A-Za-z0-9_.-]+\.html$/.test(input.file)) throw new Error('invalid_destination');
        const file = path.join(directory, input.file);
        if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('invalid_html');
        const result = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: fs.readFileSync(file), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(120000) });
        if (!result.ok) throw new Error(`provider_http_${result.status}`);
        const text = await result.text();
        if (text.length > 1024 * 1024) throw new Error('response_too_large');
        const data = JSON.parse(text);
        respond({ ok: true, data });
      } catch (error) {
        const code = error instanceof Error && /^(invalid_|provider_http_|response_too_large)/.test(error.message) ? error.message : 'upload_unavailable';
        respond({ ok: false, code });
      } finally { busy = false; }
    })();
  }, 500);
  return () => { stopped = true; clearInterval(timer); };
}
