import { expect, it } from 'vitest';
import { contextDigest, KIND_BLOCKS } from '../../server/engine-context/digest';
import type { ContextFile } from '../../server/engine-context/store';

it('exposes native frame traceability and approval in the project brief consumed by build agents', () => {
  const brief = { ref: 'DesignBrief:brief-1', status: 'confirmed', make: {
    provider: 'figma-design', revision: 'approved-revision', source: 'source-1', projectUrl: 'https://www.figma.com/design/file1/Requests',
    reviewComplete: true, screens: [{ name: 'Requests', nodeId: '1:2', requirementKeys: ['R1'] }],
  } };
  const context = { version: 1, sections: { design: { brief, screens: [] } } } as unknown as ContextFile;
  const digest = () => contextDigest(context, { blocks: ['design'], budget: 4000 }).text;
  expect(digest()).toContain('Native Figma screen design');
  expect(digest()).toContain('approved; build must consume');
  expect(digest()).toContain('Figma frame 1:2: Requests; requirements R1');
  brief.make.reviewComplete = false;
  expect(digest()).toContain('not approved for development');
  expect(KIND_BLOCKS['build.run']).toContain('design');
  expect(KIND_BLOCKS['change.build']).toContain('design');
});
