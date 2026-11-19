import { useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { isNotConfigured, messageFor, NOT_CONFIGURED_MESSAGE, useProjectList, useProjectsContext } from "@/madp/blocks/projects";
import { useCreateProjectOnce } from "@/madp/blocks/projects/mutations";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { checkProjectName } from "@/madp/domain/projects";
import { newRequestId } from "@/madp/blocks/fn";
import { can } from "@/madp/domain/rbac";
import { viewerTip } from "@/madp/data/rbac";
import { Banner, Button, Card, Chip, EmptyState, Input, Label, Textarea } from "@/madp/ui/kit";
import { PROJECT_TYPES, checkRepoRef, type ChoosableType, type ProjectType, type RepoRef } from "@/madp/domain/projectType";
import { BrownfieldRepoField } from "@/madp/components/github/BrownfieldRepoField";
import { TYPE_ICON } from "@/madp/components/project/TypeChip";
import { cn } from "@/madp/lib/cn";
import { t, useT } from "@/madp/i18n";

function Skeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="h-9 w-72 rounded-full bg-ink/[0.06]" />
      <div className="hatched h-64 rounded-card bg-surface/60" />
    </div>
  );
}

/** The error text of a name check: null when the name is fine. */
function nameProblem(name: string): string | null {
  const r = checkProjectName(name);
  return r.ok ? null : t("shell.newProject.nameProblem", "Enter a name of 1 to 80 characters, without control characters.");
}

/** The type card's words in the chosen language (the English comes from PROJECT_TYPES). */
function typeWords(id: ProjectType, label: string, text: string): { label: string; text: string } {
  switch (id) {
    case "greenfield": return {
      label: t("shell.newProject.types.greenfieldLabel", "New product"),
      text: t("shell.newProject.types.greenfieldText", "Nothing exists yet; MADP builds it from scratch and keeps the code for you."),
    };
    case "brownfield": return {
      label: t("shell.newProject.types.brownfieldLabel", "Existing product"),
      text: t("shell.newProject.types.brownfieldText", "MADP changes or extends a product you already use, from your documents, website and, if you like, its code."),
    };
    case "greyfield": return {
      label: t("shell.newProject.types.greyfieldLabel", "Rebuilt product"),
      text: t("shell.newProject.types.greyfieldText", "Rebuild an existing product on a new platform, keeping its business rules and data."),
    };
    default: return { label, text };
  }
}

/** One project type as a radio card; greyfield is shown but cannot be chosen yet. */
function TypeOption({ id, label: english, text: englishText, enabled, checked, onChoose }: { id: ProjectType; label: string; text: string; enabled: boolean; checked: boolean; onChoose: () => void }) {
  useT();
  const { label, text } = typeWords(id, english, englishText);
  const Icon = TYPE_ICON[id];
  return (
    <label className={cn(
      "relative flex min-w-0 flex-col gap-2 rounded-block p-4 ring-1 transition",
      !enabled ? "hatched cursor-not-allowed bg-surface2 text-ink3 ring-line"
        : checked ? "cursor-pointer bg-accent-soft ring-2 ring-accent" : "cursor-pointer bg-surface2 ring-line hover:ring-accent/50",
    )}>
      <input type="radio" name="project-type" value={id} checked={checked} disabled={!enabled} onChange={onChoose}
        className="peer sr-only" aria-describedby={`type-${id}-text`} />
      <span className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full",
          !enabled ? "bg-surface text-ink3" : checked ? "bg-accent text-accent-ink" : "bg-surface text-ink2")}>
          <Icon size={16} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="text-[15px] font-medium">{label}</span>
        {!enabled && <Chip className="ml-auto">{t("shell.newProject.comingLater", "Coming later")}</Chip>}
      </span>
      <span id={`type-${id}-text`} className={cn("text-[13px]", enabled ? "text-ink2" : "text-ink3")}>{text}</span>
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-block peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60" />
    </label>
  );
}

/** /new shows a form and creates the project only on submit, then opens its Business step. Old links go to the most recently updated project: ?step=2 to its requirements, ?step=3 (the old objective step) to the objective tab. */
export default function NewProject() {
  useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { create, isPending } = useCreateProjectOnce();
  const ctx = useProjectsContext();
  const list = useProjectList();
  const ready = useWorkspaces((st) => st.ready);
  const location = useLocation();
  // Words typed on Home's "Describe what you want to build" arrive here and become the project's first note.
  const [brief, setBrief] = useState(() => {
    const b = (location.state as { brief?: unknown } | null)?.brief;
    return typeof b === "string" ? b : "";
  });
  const [name, setName] = useState("");
  const [type, setType] = useState<ChoosableType>("greenfield");
  const [pick, setPick] = useState<RepoRef | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const chosen = type === "brownfield" ? pick : null;
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const canCreate = ctx.isSuperAdmin || can(ctx.permissions, "project.create");

  const step = params.get("step");
  const legacy = step === "2" || step === "3";

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (isPending) return;
    const trimmed = name.trim();
    const problem = trimmed ? nameProblem(trimmed) : null;
    setError(problem);
    // The repository is optional for both kinds (MADP Factory keeps the code; GitHub can be connected later), but checked when given.
    const ref = chosen ? checkRepoRef(`${chosen.owner}/${chosen.name}`, chosen.branch) : null;
    setRepoError(ref && !ref.ok ? ref.message : null);
    if (problem || (ref && !ref.ok)) return;
    setFailure(null);
    if (!requestId.current) requestId.current = newRequestId();
    const args = { ...(trimmed ? { name: trimmed } : {}), projectType: type, ...(brief.trim() ? { scratchMd: brief.trim() } : {}),
      ...(ref?.ok ? { repo: `${ref.value.owner}/${ref.value.name}`, repoBranch: ref.value.branch } : {}) };
    create(args, requestId.current).then(
      (r) => { requestId.current = null; navigate(`/p/${r.project.id}/business`, { replace: true }); },
      (e: unknown) => { setFailure(isNotConfigured(e) ? NOT_CONFIGURED_MESSAGE : messageFor(e)); },
    );
  };

  if (legacy) {
    if (list.isPending) return <Skeleton />;
    const latest = (list.data ?? []).find((p) => p.status === "active");
    if (!latest) return <Navigate to="/projects" replace />;
    return <Navigate to={`/p/${latest.id}/requirements${step === "3" ? "?tab=objective" : ""}`} replace />;
  }
  if (!ready) return <Skeleton />;
  if (!canCreate) {
    return (
      <Card>
        <EmptyState
          title={viewerTip()}
          text={t("shell.newProject.askForMember", "Ask a Workspace admin for the Member role to start projects.")}
          action={<Button variant="primary" onClick={() => navigate("/dashboard")}>{t("shell.newProject.goToDashboard", "Go to the Dashboard")}</Button>}
        />
      </Card>
    );
  }
  return (
    <Card>
      {failure && (
        <div className="mb-4">
          <Banner tone="danger" title={t("shell.newProject.createFailed", "The project could not be created.")} text={failure} />
        </div>
      )}
      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-6">
        <fieldset className="min-w-0">
          <legend><Label>{t("shell.newProject.whatBuilding", "What are we building?")}</Label></legend>
          <div role="radiogroup" aria-label={t("shell.newProject.projectType", "Project type")} className="grid gap-3 md:grid-cols-3">
            {PROJECT_TYPES.map((pt) => (
              <TypeOption key={pt.id} {...pt} checked={type === pt.id}
                onChoose={() => { if (pt.id !== "greyfield") { setType(pt.id); setRepoError(null); requestId.current = null; } }} />
            ))}
          </div>
        </fieldset>
        <div className="max-w-xl">
          <Label>{t("shell.newProject.projectName", "Project name")}</Label>
          <Input
            value={name}
            maxLength={80}
            placeholder={t("shell.newProject.untitled", "Untitled project")}
            aria-label={t("shell.newProject.projectName", "Project name")}
            aria-invalid={error ? true : undefined}
            onChange={(e) => { setName(e.target.value); setError(null); requestId.current = null; }}
          />
          {error && <p role="alert" className="mt-1.5 text-[13px] text-danger">{error}</p>}
        </div>
        {brief !== "" && (
          <div className="max-w-xl">
            <Label>{t("shell.newProject.whatYouWant", "What you want to build")}</Label>
            <Textarea value={brief} maxLength={20000} aria-label={t("shell.newProject.whatYouWant", "What you want to build")} onChange={(e) => { setBrief(e.target.value); requestId.current = null; }} />
            <p className="mt-1.5 text-[13px] text-ink3">{t("shell.newProject.briefNote", "Saved as the project's first note in Project setup.")}</p>
          </div>
        )}
        {type === "greenfield" && (
          <p className="max-w-xl text-[13px] text-ink3">{t("shell.newProject.greenfieldNote", "MADP Factory keeps the code for you. Connecting GitHub is optional; you can do it any time in Project setup.")}</p>
        )}
        {type === "brownfield" && (
          <BrownfieldRepoField value={pick} skipped={skipped} disabled={isPending} error={repoError}
            onSkip={(v) => { setSkipped(v); setRepoError(null); requestId.current = null; }}
            onChange={(v) => { setPick(v); setSkipped(false); setRepoError(null); requestId.current = null; }} />
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={isPending} aria-busy={isPending}>{isPending ? t("shell.newProject.creating", "Creating…") : t("shell.newProject.create", "Create project")}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate("/projects")}>{t("common.actions.cancel", "Cancel")}</Button>
        </div>
      </form>
    </Card>
  );
}
