// ticket.comment: adds a comment to a ticket. The author always comes from the
// verified caller (ctx), never from the arguments; WorkspaceId comes from the Project.
// The comment is work, not just a note: an open ticket's comments go into the build's instructions for that ticket
// (server/local/engine/build/prompt.ts), and a comment on a finished ticket of a milestone whose preview is ready
// becomes a fix ticket of that milestone, built the same way as feedback on the preview (milestone.feedback).
import { checkComment } from '../../../../src/domain/delivery'
import { plannedRoleOf } from '../../../../src/domain/ticketRole'
import { defineDeliveryOp, fail, failFromRule, idArg, startEngineJob, stringArg, strictArgs } from '../common'
import { activeDeliveryJobs } from '../rows'
import { feedbackTitle } from '../build/milestoneFeedback'

interface Args {
  projectId: string
  ticketId: string
  text: string
}

export const ticketCommentOp = defineDeliveryOp<Args>({
  permission: 'comment',
  validate(args) {
    const a = strictArgs(args, ['projectId', 'ticketId', 'text'])
    return {
      projectId: idArg(a.projectId, 'projectId'),
      ticketId: idArg(a.ticketId, 'ticketId'),
      // The real cap (5 000) is applied by checkComment.
      text: stringArg(a.text, 'text', 20000),
    }
  },
  prefetch: (ports, args) => ports.getById('Ticket', args.ticketId),
  async handler(ctx, args) {
    const ticket = await ctx.ports.getById('Ticket', args.ticketId)
    if (!ticket || ticket.ProjectId !== ctx.projectId || ticket.WorkspaceId !== ctx.workspaceId) {
      fail('not_found', 'delivery.ticket.notFound')
    }
    const r = checkComment(args.text)
    if (!r.ok) failFromRule(r)
    const { itemId } = await ctx.ports.insert(
      'TicketEvent',
      ctx.stamp({
        ProjectId: ctx.projectId,
        TicketId: args.ticketId,
        Kind: 'comment',
        AuthorUserId: ctx.caller.userId,
        Text: r.value,
        At: ctx.now,
        IsAuto: false,
      }),
      { requestKey: ctx.requestKey() },
    )
    const fix = await fixTicketFor(ctx, ticket, r.value as string)
    // The event id is known only now: the audit rides in the router's bookkeeping round.
    await ctx.after(() => ctx.audit('ticket.comment', 'Ticket', args.ticketId, { eventId: itemId, ...(fix ? fix : {}) }))
    return { eventId: itemId, ...(fix ? fix : {}) }
  },
})

/** A comment on a finished ticket while its milestone's preview waits for the client: a fix ticket of that milestone
 *  (Source "feedback", like milestone.feedback), and a build of the milestone when none runs. Null otherwise. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fixTicketFor(ctx: any, ticket: any, text: string): Promise<{ fixTicketId: string; jobId?: string } | null> {
  const done = ticket.Column === 'done' || ticket.IsDone === true
  const milestoneId = typeof ticket.MilestoneId === 'string' ? ticket.MilestoneId : ''
  if (!done || !milestoneId || !ctx.can('build.run')) return null
  const milestone = await ctx.ports.getById('Milestone', milestoneId)
  if (!milestone || milestone.ProjectId !== ctx.projectId || milestone.Status !== 'preview-ready') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await ctx.ports.query('Ticket', { ProjectId: ctx.projectId }, { fields: ['ItemId', 'Number', 'MilestoneId', 'Source'] })) as any[]
  const number = rows.reduce((mx, t) => Math.max(mx, Number.isInteger(t.Number) ? t.Number : 0), 0) + 1
  const nth = rows.filter((t) => t.MilestoneId === milestoneId && t.Source === 'feedback').length + 1
  const about = `#${ticket.Number} ${String(ticket.Title ?? '').trim()}`.trim()
  const title = feedbackTitle(text) || `Feedback on ${about}`
  const { itemId: fixTicketId, existing } = await ctx.ports.insert(
    'Ticket',
    ctx.stamp({
      ProjectId: ctx.projectId,
      MilestoneId: milestoneId,
      Number: number,
      PlanRef: `fb:${milestoneId}:${ctx.requestId}`,
      Title: title,
      TicketType: 'fix',
      FeatureRef: typeof ticket.FeatureRef === 'string' ? ticket.FeatureRef : '',
      StoryRef: typeof ticket.StoryRef === 'string' ? ticket.StoryRef : '',
      AgentRole: plannedRoleOf({ type: 'fix' }),
      Column: 'planned',
      // no EstimateHours: the screens show the real estimate (src/domain/engineEstimate.ts), never a guessed figure
      Acceptance: [`The preview does what this comment on ticket ${about} asks: “${title}”.`, 'Nothing else in the milestone changes.'],
      SortOrder: 1000 + nth,
      Description: `Comment on ticket ${about}: ${text}`,
      IsDone: false,
      Source: 'feedback',
      DependsOn: [],
    }),
    { requestKey: ctx.requestKey('fix') },
  )
  if (!existing) {
    await ctx.ports.insert(
      'TicketEvent',
      ctx.stamp({
        ProjectId: ctx.projectId, TicketId: fixTicketId, Kind: 'move', FromColumn: '', ToColumn: 'planned',
        AuthorUserId: ctx.caller.userId, AuthorLabel: '', Text: `From a comment on ticket ${about}: ${text}`, At: ctx.now, IsAuto: false,
      }),
      { requestKey: ctx.requestKey('fix-event') },
    )
  }
  const active = await activeDeliveryJobs(ctx)
  if (active.length > 0) return { fixTicketId }
  const job = await startEngineJob(ctx.ports, {
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    kind: 'build.run',
    input: { projectId: ctx.projectId, milestoneId, feedback: true },
    dedupeKey: `build.run:${ctx.projectId}:${milestoneId}:feedback:${fixTicketId}`,
    createdByUserId: ctx.caller.userId,
  })
  return { fixTicketId, jobId: job.jobId }
}
