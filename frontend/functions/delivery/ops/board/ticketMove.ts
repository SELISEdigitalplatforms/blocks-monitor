// ticket.move: moves a ticket to another board column and records the move.
import { checkTicketMove } from '../../../../src/domain/delivery'
import { defineDeliveryOp, fail, failFromRule, idArg, stringArg, strictArgs } from '../common'

interface Args {
  projectId: string
  ticketId: string
  fromColumn: string
  toColumn: string
}

export const ticketMoveOp = defineDeliveryOp<Args>({
  permission: 'board.edit',
  validate(args) {
    const a = strictArgs(args, ['projectId', 'ticketId', 'fromColumn', 'toColumn'])
    return {
      projectId: idArg(a.projectId, 'projectId'),
      ticketId: idArg(a.ticketId, 'ticketId'),
      // The domain rule checks the column values.
      fromColumn: stringArg(a.fromColumn, 'fromColumn', 40),
      toColumn: stringArg(a.toColumn, 'toColumn', 40),
    }
  },
  prefetch: (ports, args) => ports.getById('Ticket', args.ticketId),
  async handler(ctx, args) {
    const ticket = await ctx.ports.getById('Ticket', args.ticketId)
    if (!ticket || ticket.ProjectId !== ctx.projectId || ticket.WorkspaceId !== ctx.workspaceId) {
      fail('not_found', 'delivery.ticket.notFound')
    }
    // Best effort: the gateway has no compare-and-set, so two moves racing between this
    // read and the update can both pass. A stale fromColumn is answered with `conflict`.
    const r = checkTicketMove(String(ticket.Column ?? ''), args.fromColumn, args.toColumn, ctx.now)
    if (!r.ok) failFromRule(r)
    const { column, isDone, doneAt } = r.value
    const [, , ev] = await Promise.all([
      ctx.audit('ticket.move', 'Ticket', args.ticketId, { fromColumn: args.fromColumn, toColumn: args.toColumn }),
      ctx.ports.update(
        'Ticket',
        args.ticketId,
        // DoneAt cannot be cleared (MF-B14); IsDone is the truth.
        ctx.touch({ Column: column, IsDone: isDone, ...(doneAt ? { DoneAt: doneAt } : {}) }),
      ),
      ctx.ports.insert(
        'TicketEvent',
        ctx.stamp({
          ProjectId: ctx.projectId,
          TicketId: args.ticketId,
          Kind: 'move',
          FromColumn: args.fromColumn,
          ToColumn: args.toColumn,
          AuthorUserId: ctx.caller.userId,
          Text: '',
          At: ctx.now,
          IsAuto: false,
        }),
        { requestKey: ctx.requestKey('event') },
      ),
    ])
    return { ticketId: args.ticketId, column, isDone, eventId: ev.itemId }
  },
})
