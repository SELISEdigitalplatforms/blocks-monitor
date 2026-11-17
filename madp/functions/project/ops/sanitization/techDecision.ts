// Technical consultation ops (design 12.2 step 2): techDecision.save, techDecision.delete.
import { parseTechDecisionInput, PROJECT_LIMITS } from '../../../../src/domain/sanitization'
import { activeMemberIds, countRows, fail, fromCheck, gate, insertNumbered, notFound, ok, projectRow, requirePermission, topNumber, versionCheck, withReads } from './common'
import type { OpContext, OpResult, OpTable, ReadEnv, Row } from './ports'

type Reader = Pick<ReadEnv, 'gateway' | 'project'>

type Args = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const failed = (r: any): r is OpResult => !!r && typeof r === 'object' && r.ok === false
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The reads of techDecision.save (shared with its prefetch). */
function saveReads(env: Reader, args: Args) {
  const id = str(args.id)
  const named = Array.isArray(args.consultedUserIds) && args.consultedUserIds.length > 0
  return Promise.all([
    id ? projectRow(env, 'TechDecision', id) : Promise.resolve(null),
    id ? Promise.resolve(0) : countRows(env, 'TechDecision', PROJECT_LIMITS.techDecisions),
    id ? Promise.resolve(null) : topNumber(env, 'TechDecision'),
    named ? activeMemberIds(env) : Promise.resolve(null),
  ])
}

async function save(args: Args, ctx: OpContext): Promise<OpResult> {
  const g = await gate(ctx, 'reachable')
  if (failed(g)) return g
  const p = await requirePermission(ctx, 'sanitization.edit')
  if (failed(p)) return p
  const id = str(args.id)
  const decided = (status: unknown) => status === 'accepted' || status === 'rejected'

  // An update may carry only some keys (Agree/Reject sends id, area, topic, status): the stored row fills the rest.
  const [storedRow, count, top, active] = await saveReads(ctx, args)
  const stored = storedRow as Row | null
  if (id && !stored) return notFound('techDecision')
  const given = (key: string): boolean => Object.prototype.hasOwnProperty.call(args, key) && args[key] !== null && args[key] !== undefined
  const merged: Args = {}
  if (stored) {
    const alternatives = Array.isArray(stored.Alternatives) ? (stored.Alternatives as unknown[]).filter((x) => typeof x === 'string').join('\n') : str(stored.Alternatives)
    Object.assign(merged, {
      area: stored.Area,
      topic: stored.Title,
      choice: stored.Choice,
      rationale: stored.Rationale,
      alternativesConsidered: alternatives,
      status: stored.Status,
      nfrCategory: stored.NfrCategory,
      target: stored.NfrTarget,
      integrationSystem: stored.IntegrationSystem,
      consultedUserIds: Array.isArray(stored.ExpertUserIds) ? stored.ExpertUserIds : [],
    })
  }
  for (const [k, v] of Object.entries(args)) if (given(k)) merged[k] = v
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any = parseTechDecisionInput(merged as never)
  if (parsed && parsed.ok === false) return fromCheck(parsed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: any = parsed && parsed.ok === true ? (parsed.value ?? parsed.data ?? parsed) : parsed
  const people: string[] = Array.isArray(input.expertUserIds) ? input.expertUserIds : []

  if (active && people.length) {
    const set = new Set<string>(active as Iterable<string>)
    if (people.some((u) => !set.has(u))) {
      return fail('invalid_input', 'sanitization.notMember', { field: 'consultedUserIds' })
    }
  }
  const fields: Record<string, unknown> = {
    Area: input.area,
    Title: input.title,
    Choice: input.choice,
    Rationale: input.rationale,
    Alternatives: input.alternatives ? [input.alternatives] : [],
    Status: input.status,
    ExpertUserIds: people,
    NfrCategory: input.nfrCategory,
    NfrTarget: input.nfrTarget,
    IntegrationSystem: input.integrationSystem,
  }
  if (stored) {
    // Only the columns the request names (an area change also re-derives the area-specific ones).
    const source: Record<string, string[]> = {
      Area: ['area'],
      Title: ['topic'],
      Choice: ['choice'],
      Rationale: ['rationale'],
      Alternatives: ['alternativesConsidered'],
      Status: ['status'],
      ExpertUserIds: ['consultedUserIds'],
      NfrCategory: ['nfrCategory', 'area'],
      NfrTarget: ['target', 'area'],
      IntegrationSystem: ['integrationSystem', 'area'],
    }
    const patch: Record<string, unknown> = {}
    for (const [column, keys] of Object.entries(source)) {
      if (keys.some(given) && fields[column] !== undefined && fields[column] !== null) patch[column] = fields[column]
    }
    const seen = versionCheck(stored, str(args.expectedUpdatedAt), ctx.userId, { values: patch })
    if (seen === 'stale') return fail('conflict', 'sanitization.stale')
    if (seen === 'own') return ok({ techDecision: stored })
    if (given('status') && input.status !== stored.Status && decided(input.status)) {
      patch.DecidedByUserId = ctx.userId
      patch.DecidedAt = ctx.now()
    }
    const row = Object.keys(patch).length ? await ctx.gateway.update('TechDecision', stored.ItemId as string, patch) : stored
    ctx.audit({ action: 'techDecision.save', targetType: 'tech-decision', targetId: String(stored.ItemId), details: { created: false, number: stored.Number, status: input.status, fields: Object.keys(patch) } })
    return ok({ techDecision: row })
  }
  if (Number(count) >= PROJECT_LIMITS.techDecisions) {
    return fail('limit_reached', 'sanitization.limit', { kind: 'techDecisions', max: PROJECT_LIMITS.techDecisions })
  }
  if (decided(input.status)) {
    fields.DecidedByUserId = ctx.userId
    fields.DecidedAt = ctx.now()
  }
  const ins = await insertNumbered(ctx, 'TechDecision', fields, 'techDecision', { knownMax: top as number | null })
  ctx.audit({ action: 'techDecision.save', targetType: 'tech-decision', targetId: String(ins.row.ItemId), details: { created: true, number: ins.row.Number, status: input.status } })
  return ok({ techDecision: ins.row })
}

const delRead = async (env: Reader, args: Args) => {
  const id = str(args.id)
  if (!id) return null
  const [row] = await Promise.all([projectRow(env, 'TechDecision', id), env.gateway.verify('TechDecision', id)])
  return row
}

async function del(args: Args, ctx: OpContext): Promise<OpResult> {
  const g = gate(ctx, 'reachable')
  if (failed(g)) return g
  const p = await requirePermission(ctx, 'sanitization.edit')
  if (failed(p)) return p
  const id = str(args.id)
  const row = id ? ((await delRead(ctx, args)) as Row | null) : null
  if (!row) return notFound('techDecision')
  await ctx.gateway.remove('TechDecision', id)
  ctx.audit({ action: 'techDecision.delete', targetType: 'tech-decision', targetId: id, details: { number: row.Number } })
  return ok({ id })
}

export const TECH_DECISION_OPS: OpTable = {
  'techDecision.save': withReads(save, { prefetch: (env, args) => saveReads(env, args) }),
  'techDecision.delete': withReads(del, { prefetch: (env, args) => delRead(env, args) }),
} as OpTable
