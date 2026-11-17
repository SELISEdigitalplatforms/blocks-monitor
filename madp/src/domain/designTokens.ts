/** Optional, data-only design contract. Never interpret token values as executable theme code. */
export interface DesignTokens {
  version: 1;
  colors: Record<string, string>;
  fontFamily: Record<string, string>;
  fontSize: Record<string, string>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
}

export function parseDesignTokens(value: unknown): DesignTokens | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const rules = {
    colors: /^#[0-9a-f]{6}$/i,
    fontFamily: /^[a-zA-Z][a-zA-Z0-9 ,\-]{0,99}$/,
    fontSize: /^(?:0|\d+(?:\.\d+)?(?:px|rem))$/,
    spacing: /^(?:0|\d+(?:\.\d+)?(?:px|rem))$/,
    borderRadius: /^(?:0|\d+(?:\.\d+)?(?:px|rem))$/,
  };
  if (input.version !== 1 || Object.keys(input).some(k => k !== 'version' && !Object.hasOwn(rules, k))) return null;
  const result: Record<string, unknown> = { version: 1 };
  for (const [group, rule] of Object.entries(rules)) {
    const values = input[group];
    if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
    const entries = Object.entries(values);
    if (!entries.length || entries.length > 64 || entries.some(([key, val]) =>
      !/^[a-z][a-z0-9-]{0,39}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) ||
      typeof val !== 'string' || !rule.test(val))) return null;
    result[group] = Object.fromEntries(entries);
  }
  return result as unknown as DesignTokens;
}
