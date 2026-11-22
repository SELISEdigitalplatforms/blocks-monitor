// Design: the brief (with sample files in sample mode), its confirmation, and the screens the engine generated from it.
import { storedNameOf } from "../core/files";
import { plus, reached, row, u, type Ctx } from "./ctx";
import { job } from "./jobs";

export async function seedDesign(c: Ctx): Promise<void> {
  const d = c.plan.design;
  if (!d) return;
  const confirmed = reached(c, "scope");
  const created = plus(c, c.at.sanitized!, 60 * 20);
  const confirmedAt = confirmed ? plus(c, c.at.confirmed!, -45) : undefined;
  const briefId = await row(
    c,
    "DesignBrief",
    "design-brief",
    {
      Mode: d.mode,
      Instructions: d.instructions,
      References: [],
      SampleFileIds: [],
      Status: confirmed ? "confirmed" : "draft",
      ...(confirmedAt ? { ConfirmedByUserId: u(c, d.confirmedBy), ConfirmedAt: confirmedAt } : {}),
    },
    { by: c.plan.lead, at: created, updatedAt: confirmedAt ?? created, updatedBy: confirmedAt ? d.confirmedBy : c.plan.lead },
  );
  c.briefId = briefId;

  if (d.mode === "sample" && d.samples?.length) {
    const ids: string[] = [];
    for (const [i, spec] of d.samples.entries()) {
      const f = await c.s.file(spec);
      ids.push(
        await row(
          c,
          "Attachment",
          `sample-${i}`,
          {
            OwnerType: "design-brief",
            OwnerId: briefId,
            FileId: f.fileId,
            FileName: f.name,
            StoredName: storedNameOf(f.name, f.ext),
            Kind: f.kind === "image" ? "image" : "pdf",
            Mime: f.mime,
            SizeBytes: f.bytes.length,
            Origin: "upload",
            Meta: "",
            Status: "ready",
          },
          { by: c.plan.lead, at: plus(c, created, 10 + i) },
        ),
      );
    }
    await c.s.update("DesignBrief", briefId, { SampleFileIds: ids }, confirmedAt ?? plus(c, created, 12));
  }

  if (!confirmed) return;
  // Opening the scope page queues design.generate unless a job for this brief exists since the confirmation.
  const jobAt = plus(c, confirmedAt!, 2);
  const jobId = await job(c, {
    local: "design-generate",
    kind: "design.generate",
    status: "succeeded",
    by: d.confirmedBy,
    at: jobAt,
    minutes: 16,
    target: { type: "design-brief", id: briefId },
    input: { projectId: c.id, designBriefId: briefId },
    outputs: [],
    message: `Generated ${d.screens.length} screens from the design brief.`,
  });
  const madeAt = plus(c, jobAt, 18);
  const outputs: string[] = [];
  for (const [i, sc] of d.screens.entries()) {
    const versions = d.regenerated?.includes(sc.key) ? [1, 2] : [1];
    for (const version of versions) {
      const latest = version === versions[versions.length - 1];
      const f = await c.s.file({ type: "png", name: `${sc.key}-v${version}.png`, image: { ...sc.image, type: "screen", brand: d.brand, app: d.app } });
      const id = await row(
        c,
        "DesignScreen",
        `screen-${sc.key}-v${version}`,
        {
          DesignBriefId: briefId,
          EngineJobId: jobId,
          Key: sc.key,
          Name: sc.name,
          Version: version,
          SortOrder: i,
          ImageFileId: f.fileId,
          Width: f.width ?? 390,
          Height: f.height ?? 844,
          Status: latest ? sc.status ?? "generated" : "superseded",
        },
        { by: d.confirmedBy, at: version === 1 ? madeAt : plus(c, madeAt, 60 * 4), updatedAt: latest ? undefined : plus(c, madeAt, 60 * 4) },
      );
      outputs.push(`DesignScreen:${id}`);
      if (latest) c.refs.set(`screen:${sc.key}`, id);
    }
  }
  await c.s.update("EngineJob", jobId, { OutputRefs: outputs }, plus(c, jobAt, 17));
}
