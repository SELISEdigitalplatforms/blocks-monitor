import { expect, it, vi } from 'vitest';
import { assessDesignFeedback, requireAlignedDesignFeedback } from '../../server/local/engine/ai/designFeedback';
import { designIntent } from '../../src/domain/factoryDesign';
const intent = designIntent({ Goal: 'Allow customers to order from their table' }, null, [{ Key: 'R-1', Title: 'Payment choice', Text: 'Pay online or at the table', AcceptanceCriteria: ['Pay at table remains available'] }], []);
it('permits presentation-only feedback through the tool-free review', async () => {
  const runner = vi.fn().mockResolvedValue({ status: 'aligned', conflicts: [], rationale: 'Larger typography preserves behavior.' });
  const result = await assessDesignFeedback(runner, intent, 'Increase the body text size', 'rev1');
  expect(() => requireAlignedDesignFeedback(result)).not.toThrow();
  expect(runner.mock.calls[0][0].makeSession).toBeUndefined();
  expect(JSON.parse(runner.mock.calls[0][0].prompt).intent.project.Goal).toContain('order');
});
it('blocks conflicting behavior and identifies the affected requirement', async () => {
  const runner = vi.fn().mockResolvedValue({ status: 'requirements_change_required', conflicts: ['R-1 requires pay at table; online-only payment removes it.'], rationale: 'Behavior change' });
  const result = await assessDesignFeedback(runner, intent, 'Force everyone to pay online', 'rev1');
  expect(() => requireAlignedDesignFeedback(result)).toThrow(/R-1 requires pay at table/);
});
it('blocks a contradictory aligned answer that still lists conflicts', () => {
  expect(() => requireAlignedDesignFeedback({ status: 'aligned', conflicts: ['R-1 conflicts'], rationale: '' })).toThrow();
});
it.each([{}, { status: 'aligned', conflicts: [], rationale: null }, { status: 'aligned', conflicts: [null], rationale: '' }])('fails closed for an invalid review: %j', async (answer) => {
  await expect(assessDesignFeedback(vi.fn().mockResolvedValue(answer), intent, 'Change the layout', null)).rejects.toMatchObject({ code: 'design.feedbackReviewUnavailable' });
});
it('does not allow provider failures to bypass the review', async () => {
  await expect(assessDesignFeedback(vi.fn().mockRejectedValue(new Error('offline')), intent, 'Change the layout', null)).rejects.toMatchObject({ code: 'design.feedbackReviewUnavailable' });
});
