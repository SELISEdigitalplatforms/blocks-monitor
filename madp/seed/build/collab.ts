// Collaboration around a project: wiki pages (factory-written and person-written, with history), the 3D-office agent
// chat, and the release assistant (questions and bug analyses that start a fix).
import { changeCode } from "../../src/domain/delivery";
import { plus, ref, row, t, u, type Ctx } from "./ctx";
import { job } from "./jobs";

/** "feature:<key>" → "feature:<ItemId>" etc. for wiki sources. */
function sourceRef(c: Ctx, r: string): string {
  const [kind, key] = r.split(/:(.*)/s) as [string, string];
  const local: Record<string, string> = { feature: "feature", story: "story", req: "requirement", dec: "decision", screen: "screen" };
  if (kind === "cr") {
    const cp = c.plan.delivery?.changes?.[Number(key) - 1];
    return `${cp?.lane === "fix" ? "fix" : "change"}:${ref(c, `cr:${key}`)}`;
  }
  if (kind === "release") return `release:${ref(c, `release:${key}`)}`;
  if (local[kind]) return `${local[kind]}:${ref(c, `${kind}:${key}`)}`;
  return r;
}

export async function seedCollab(c: Ctx): Promise<void> {
  await seedWiki(c);
  await seedAgentChat(c);
  await seedAssistant(c);
}

async function seedWiki(c: Ctx): Promise<void> {
  const pages = c.plan.wiki ?? [];
  if (pages.length === 0) return;
  const factory = pages.filter((p) => p.origin === "factory");
  let jobId = "";
  if (factory.length) {
    const first = factory.map((p) => t(c, p.at)).sort()[0]!;
    jobId = await job(c, {
      local: "wiki-generate",
      kind: "wiki.generate",
      status: "succeeded",
      by: c.plan.lead,
      at: plus(c, first, -14),
      minutes: 12,
      input: { projectId: c.id },
      outputs: [],
      message: `Wrote ${factory.length} wiki pages from the scope, the build and the releases.`,
    });
  }
  const outputs: string[] = [];
  const version = c.plan.delivery?.promotions?.length ? undefined : "v1.0.0";
  for (const p of pages) {
    const at = t(c, p.at);
    const history = p.history ?? [];
    const created = history.length ? t(c, history[0]!.at) : at;
    const id = await row(
      c,
      "WikiPage",
      `wiki-${p.slug}`,
      {
        Slug: p.slug,
        PageGroup: p.group,
        Title: p.title,
        BodyMd: p.body,
        SourcesJson: p.origin === "factory" ? JSON.stringify({ order: p.order ?? null, items: (p.sources ?? []).map((s) => ({ label: s.label, ref: sourceRef(c, s.ref) })) }) : "{}",
        UpdatedWithVersion: p.origin === "factory" ? latestVersion(c) ?? version ?? "" : "",
        Origin: p.origin,
        EngineJobId: p.origin === "factory" ? jobId : "",
      },
      { by: p.by ?? c.plan.lead, at: created, updatedAt: at },
    );
    if (p.origin === "factory") outputs.push(`WikiPage:${id}`);
    // Person pages keep every saved body (wiki.page.create / save write one history row per save, the newest equals
    // the page): the plan's earlier versions, then the current one.
    const versions = p.origin === "person" ? [...history, { body: p.body, by: p.by ?? c.plan.lead, at: p.at }] : history;
    for (const [i, h] of versions.entries()) {
      await row(
        c,
        "WikiPageHistory",
        `wiki-${p.slug}-h${i}`,
        { PageId: id, BodyMd: h.body, EditedByUserId: u(c, h.by), Origin: "person", At: t(c, h.at) },
        { by: h.by, at: t(c, h.at) },
      );
    }
  }
  if (jobId) await c.s.update("EngineJob", jobId, { OutputRefs: outputs }, plus(c, t(c, factory[0]!.at), -1));
}

function latestVersion(c: Ctx): string | null {
  const prod = c.plan.delivery?.promotions?.filter((p) => p.env === "production" && p.promotedAt).map((p) => p.version);
  return prod?.length ? `v${prod[prod.length - 1]}` : null;
}

async function seedAgentChat(c: Ctx): Promise<void> {
  for (const thread of c.plan.chat ?? []) {
    let lastUser = "";
    for (const [i, m] of thread.messages.entries()) {
      const at = t(c, m.at);
      const local = `chat-${thread.role}-${i}`;
      if (m.from !== "agent") {
        lastUser = await row(c, "AgentChatMessage", local, { AgentRole: thread.role, Role: "user", Kind: "text", Text: m.text, AuthorUserId: u(c, m.from), At: at }, { by: m.from, at });
        continue;
      }
      const asker = [...thread.messages.slice(0, i)].reverse().find((x) => x.from !== "agent")?.from ?? c.plan.lead;
      if (m.task) {
        // The task row comes right after the question (agentChat.recordTask), then the agent's words.
        const n = Number(m.task.ref.slice(3));
        const cp = c.plan.delivery?.changes?.[n - 1];
        if (!cp) throw new Error(`seed: ${c.plan.key} chat task ${m.task.ref} has no change`);
        const code = changeCode({ lane: cp.lane, number: n });
        await row(
          c,
          "AgentChatMessage",
          `${local}-task`,
          {
            AgentRole: thread.role,
            Role: "agent",
            Kind: "task-created",
            Text: `${code} is saved: ${cp.title}.`,
            TaskTarget: "change-request",
            TaskId: ref(c, m.task.ref),
            TaskCode: code,
            TaskTitle: cp.title,
            TaskLane: cp.lane,
            TaskFeatureRef: cp.feature ? `feature:${cp.feature}` : "",
            At: new Date(Date.parse(at) - 1).toISOString(),
          },
          { by: asker, at },
        );
      }
      const jobId = lastUser
        ? await job(c, {
            local: `${local}-reply`,
            kind: "chat.reply",
            status: "succeeded",
            by: asker,
            at: plus(c, at, -0.5),
            minutes: 0.3,
            target: { type: "agent-chat", id: lastUser },
            input: { projectId: c.id, thread: "agent", threadId: thread.role, messageId: lastUser },
            outputs: [],
            message: "Answered.",
          })
        : "";
      const reply = await row(c, "AgentChatMessage", local, { AgentRole: thread.role, Role: "agent", Kind: "text", Text: m.text, EngineJobId: jobId, At: at }, { by: asker, at });
      if (jobId) await c.s.update("EngineJob", jobId, { OutputRefs: [`AgentChat:${reply}`] }, at);
      lastUser = "";
    }
  }
}

async function seedAssistant(c: Ctx): Promise<void> {
  for (const thread of c.plan.assistant ?? []) {
    let lastUser = "";
    let lastAsker = c.plan.lead;
    for (const [i, m] of thread.messages.entries()) {
      const at = t(c, m.at);
      const local = `assistant-${thread.env}-${i}`;
      const base = {
        Environment: thread.env,
        Text: m.text,
        Points: m.points ?? [],
        RefsJson: JSON.stringify(m.refs ?? []),
        AttachmentsJson: JSON.stringify(m.attachments ?? []),
        At: at,
      };
      if (m.from !== "assistant") {
        lastUser = await row(c, "AssistantMessage", local, { ...base, Role: "user", Kind: "text", AnalysisJson: "", FixState: "none" }, { by: m.from, at });
        lastAsker = m.from;
        continue;
      }
      const analysis = !!m.analysis;
      const jobId = lastUser
        ? await job(c, {
            local: `${local}-job`,
            kind: analysis ? "fix.analyse" : "chat.reply",
            status: "succeeded",
            by: m.requestedBy ?? lastAsker,
            at: plus(c, at, analysis ? -6 : -0.5),
            minutes: analysis ? 5 : 0.3,
            target: { type: "assistant-message", id: lastUser },
            input: analysis
              ? { projectId: c.id, assistantMessageId: lastUser, environment: thread.env }
              : { projectId: c.id, thread: "assistant", threadId: thread.env, messageId: lastUser },
            outputs: [],
            message: analysis ? "Analysed the report." : "Answered.",
          })
        : "";
      const fix = m.fix;
      const cr = fix?.change ? c.plan.delivery?.changes?.[fix.change - 1] : undefined;
      const crId = fix?.change ? ref(c, `cr:${fix.change}`) : "";
      const fields: Record<string, unknown> = {
        ...base,
        Role: "assistant",
        Kind: analysis ? "analysis" : "text",
        AnalysisJson: analysis ? JSON.stringify(m.analysis) : "",
        FixState: fix?.state ?? "none",
        EngineJobId: jobId,
      };
      if (fix?.state === "started" && cr) {
        Object.assign(fields, { FixChangeRequestId: crId, FixCode: changeCode({ lane: cr.lane, number: fix.change! }), FixVersion: c.refs.get(`crversion:${fix.change}`) ?? "" });
      }
      const id = await row(c, "AssistantMessage", local, fields, {
        by: m.requestedBy ?? lastAsker,
        at,
        updatedAt: fix?.state === "started" && cr?.built ? t(c, cr.built) : at,
      });
      if (jobId) await c.s.update("EngineJob", jobId, { OutputRefs: analysis && crId ? [`ChangeRequest:${crId}`] : [`AssistantMessage:${id}`] }, at);
      lastUser = "";
    }
  }
}
