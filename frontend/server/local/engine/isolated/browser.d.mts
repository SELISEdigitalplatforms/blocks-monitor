// Types of browser.mjs (plain JavaScript, run by child.mjs in a child process).

/** The parts of a Playwright BrowserType that checkDesign uses. */
export interface DesignCheckChromium {
  launch(o: object): Promise<{ newPage(): Promise<unknown>; close(): Promise<void> }>;
}

export function checkDesign(chromium: DesignCheckChromium, p: { html: string; csp: string }): Promise<void>;
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T>;
export const handlers: Record<string, (payload: never) => Promise<unknown>>;
export function cleanup(): Promise<void>;
