import { describe, expect, it } from 'vitest';
import { PRIVATE_LINK, parseFigmaScreens, screenGallery, screenPreviewPath } from '../../src/domain/figmaScreens';
import { parseProductPrototype } from '../../src/domain/factoryDesign';
const revision = 'a'.repeat(64);
const design = { provider: 'figma-design', projectId: 'p1', projectUrl: 'https://www.figma.com/design/abc/Review',
  previewUrl: screenPreviewPath('p1', revision), revision, source: 'factory-v1:ux-abc', jobId: 'j1', artifactFileId: 'f1',
  screens: [{ name: 'Order review', nodeId: '1:2', requirementKeys: ['R-1'] }] };
describe('native Figma screen revisions', () => {
  it("accepts a revision whose design-tool link the engine's privacy guard kept on the engine host", () => {
    expect(parseFigmaScreens({ ...design, projectUrl: PRIVATE_LINK })).not.toBeNull();
    expect(parseFigmaScreens({ ...design, projectUrl: 'https://example.com/design/x' })).toBeNull();
  });
  it('accepts optional viewport metadata but rejects invalid dimensions', () => {
    const withViewport = (viewport: unknown) => ({ ...design, screens: [{ ...design.screens[0], viewport }] });
    expect(parseFigmaScreens(withViewport({ width: 390, height: 844 }))).not.toBeNull();
    expect(parseFigmaScreens(withViewport({ width: -1, height: 844 }))).toBeNull();
    expect(parseFigmaScreens(withViewport({ width: 390, height: 0 }))).toBeNull();
    expect(parseFigmaScreens(withViewport({ width: 1.5, height: 844 }))).toBeNull();
  });
  it('preserves explicit incompleteness and bounds the planned screen count', () => {
    expect(parseFigmaScreens({ ...design, reviewComplete: false, totalScreens: 20 })?.reviewComplete).toBe(false);
    expect(parseFigmaScreens({ ...design, totalScreens: 0 })).toBeNull();
    expect(parseFigmaScreens({ ...design, reviewComplete: 'yes' })).toBeNull();
    const unmapped = { ...design, screens: [{ name: 'Orders', nodeId: '1:2', requirementKeys: [] }] };
    expect(parseFigmaScreens(unmapped)).toBeNull();
    expect(parseFigmaScreens({ ...unmapped, reviewComplete: false })?.reviewComplete).toBe(false);
  });
  it('accepts screen designs without a published site', () => {
    expect(parseFigmaScreens(design)).toEqual(design);
    expect(parseProductPrototype(JSON.stringify(design))?.provider).toBe('figma-design');
  });
  it('rejects arbitrary preview hosts, Make files and missing frames', () => {
    expect(parseFigmaScreens({ ...design, previewUrl: 'https://attacker.test' })).toBeNull();
    expect(parseFigmaScreens({ ...design, projectUrl: 'https://www.figma.com/make/abc' })).toBeNull();
    expect(parseFigmaScreens({ ...design, screens: [] })).toBeNull();
    expect(parseFigmaScreens({ ...design, screens: [{ name: 'X', nodeId: '../bad', requirementKeys: [] }] })).toBeNull();
  });
  it('escapes content and displays exported images without active code', () => {
    const html = screenGallery([{ name: '<script>alert(1)</script>', png: 'iVBORw0KGgo=' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
  });
});
