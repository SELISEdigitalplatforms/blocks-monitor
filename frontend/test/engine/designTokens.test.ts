import { describe, expect, it } from 'vitest';
import { parseDesignTokens } from '../../src/domain/designTokens';

const tokens = () => ({ version: 1, colors: { primary: '#0E7490' }, fontFamily: { body: 'Inter, sans-serif' }, fontSize: { body: '1rem' }, spacing: { control: '0.75rem' }, borderRadius: { control: '0.5rem' } });

describe('optional design tokens', () => {
  it('accepts and copies the data-only versioned contract', () => {
    const input = tokens();
    expect(parseDesignTokens(input)).toEqual(input);
    expect(parseDesignTokens(input)?.colors).not.toBe(input.colors);
  });
  it('leaves old artifacts without tokens valid through a null fallback', () => {
    expect(parseDesignTokens(undefined)).toBeNull();
    expect(parseDesignTokens(null)).toBeNull();
  });
  it('rejects executable values, unsupported versions and unsafe keys', () => {
    expect(parseDesignTokens({ ...tokens(), version: 2 })).toBeNull();
    expect(parseDesignTokens({ ...tokens(), colors: { primary: 'url(https://example.com)' } })).toBeNull();
    expect(parseDesignTokens({ ...tokens(), spacing: { control: '-2px' } })).toBeNull();
    expect(parseDesignTokens({ ...tokens(), fontFamily: { body: 'Inter; color:red' } })).toBeNull();
    expect(parseDesignTokens({ ...tokens(), colors: { constructor: '#ffffff' } })).toBeNull();
    expect(parseDesignTokens({ ...tokens(), extra: {} })).toBeNull();
  });
});
