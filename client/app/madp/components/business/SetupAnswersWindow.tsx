/** A Project setup chip's saved answers, read-only: what was entered for About, Code and Material, from
 *  the same records the setup saved (the Project record's fields, the guided start's answers, the Project brief note).
 *  Opened by the chips once the project has moved on from its setup, or for people without edit rights; while the
 *  project is in setup the chips open their own windows to change the answers. One plain line says why it is read-only;
 *  there are no disabled inputs. */
import type { ReactNode } from "react";
import { ChevronRight, ExternalLink, FolderGit2, Lock } from "lucide-react";
import { AiTag, Button, Modal } from "@/madp/ui/kit";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { isRepoVisibility } from "@/madp/domain/projectType";
import { visibilityName } from "./businessUi";
import { codeStillOpenText, notAnsweredText, type SetupChipId, type SetupValues, type SharedItem, type SourcedText } from "./setupChips";
import { NOTE_ICON, SCRATCH_ICON, fileIconFor } from "./icons";
import { formatSize } from "./fileUi";
import { websiteLabel } from "./WebsiteLink";
import { SCRATCH_ID } from "./treeModel";
// the body is also rendered and walked outside React (tests, server): it reads texts with t, not a hook; the window
// itself subscribes with useT so the whole body follows the language
import { t, useT } from "@/madp/i18n";

/** The window's title of each chip. */
export function answersTitle(section: SetupChipId, existing: boolean): string {
  switch (section) {
    case "about": return existing ? t("analysis.business.answers.aboutProduct", "About the product") : t("analysis.business.answers.aboutProject", "About the project");
    case "where": return existing ? t("analysis.business.repo.productCode", "The product's code") : t("analysis.business.repo.whereCode", "Where the code lives");
    default: return t("analysis.business.answers.material", "Material you shared");
  }
}

const isWebAddress = (s: string) => /^https?:\/\/\S+$/i.test(s);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-[12px] font-medium uppercase tracking-wider text-ink3">{label}</dt>
      <dd className="mt-1 break-words text-[14px] leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

const NotAnswered = () => <span className="text-ink3">{notAnsweredText()}</span>;
const Muted = ({ children }: { children: ReactNode }) => <span className="mt-1 block text-[13px] text-ink3">{children}</span>;

function Answer({ value }: { value: SourcedText }) {
  if (!value.text) return <NotAnswered />;
  return (
    <>
      <span className="block whitespace-pre-line">{value.text}</span>
      {value.source === "agent" && <span className="mt-1.5 block"><AiTag>{t("analysis.business.answers.foundByAnalyst", "Found by the business analyst in your material")}</AiTag></span>}
      {value.source === "scratch" && <Muted>{t("analysis.business.answers.fromScratch", "From your Scratch pad")}</Muted>}
      {value.source === "brief" && <Muted>{t("analysis.business.answers.fromBrief", "From the Project brief")}</Muted>}
    </>
  );
}

function WebLink({ url, label }: { url: string; label?: string }) {
  if (!isWebAddress(url)) return <span>{url}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 text-accent underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-accent/60">
      <span className="min-w-0 truncate">{label ?? websiteLabel(url)}</span><ExternalLink size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span className="sr-only"> {t("analysis.business.answers.opensInTab", "(opens in a new tab)")}</span>
    </a>
  );
}

/** An existing product attached as it is live: its profile (the Project record's own Brief, Goal and TargetUsers,
 *  written by its people or documented from the live product), shown in the About window. */
export interface LiveProfile {
  about: string;
  goal: string;
  users: string;
  /** "Documented from the live product on 9 Nov 2026, 02:40." when it was; null otherwise */
  documented: string | null;
}

function AboutAnswers({ v, profile }: { v: SetupValues; profile?: LiveProfile | null }) {
  if (profile) {
    const about = profile.about.trim() || v.description.text;
    return (
      <dl className="divide-y divide-line">
        <Row label={t("analysis.business.answers.name", "Name")}>{v.name || <NotAnswered />}</Row>
        <Row label={t("analysis.business.answers.whatItDoes", "What it does")}>{about ? <span className="block whitespace-pre-line">{about}</span> : <NotAnswered />}</Row>
        <Row label={t("analysis.business.answers.itsGoal", "Its goal")}>{profile.goal.trim() ? <span className="block whitespace-pre-line">{profile.goal.trim()}</span> : <NotAnswered />}</Row>
        <Row label={t("analysis.business.answers.whoUses", "Who uses it")}>{profile.users.trim() ? <span className="block whitespace-pre-line">{profile.users.trim()}</span> : <NotAnswered />}</Row>
        <Row label={t("analysis.business.answers.theProduct", "The product")}>{t("analysis.business.answers.existingLive", "An existing product, live: it changes through change requests")}</Row>
        <Row label={t("analysis.business.answers.website", "Website")}>{v.website ? <WebLink url={v.website} /> : <NotAnswered />}</Row>
        {profile.documented && <div className="pt-3 text-[13px] text-ink3">{profile.documented}</div>}
      </dl>
    );
  }
  return (
    <dl className="divide-y divide-line">
      <Row label={t("analysis.business.answers.name", "Name")}>{v.name || <NotAnswered />}</Row>
      <Row label={v.existing ? t("analysis.business.answers.doesAndChange", "What it does, and what should change") : t("analysis.business.answers.whatAbout", "What it is about")}><Answer value={v.description} /></Row>
      <Row label={t("analysis.business.answers.building", "You're building")}>{v.existing ? t("analysis.business.answers.existingProduct", "An existing product: we add to it or change it") : t("analysis.business.answers.newProduct", "A new product: built from scratch")}</Row>
      {(v.existing || v.website) && <Row label={t("analysis.business.answers.website", "Website")}>{v.website ? <WebLink url={v.website} /> : <NotAnswered />}</Row>}
    </dl>
  );
}

function RepoLink({ owner, name, branch }: { owner: string; name: string; branch: string }) {
  return (
    <a href={`https://github.com/${owner}/${name}/tree/${encodeURIComponent(branch)}`} target="_blank" rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 text-accent underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-accent/60">
      <span className="min-w-0 truncate">{owner}/{name}</span><ExternalLink size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span className="sr-only"> {t("analysis.business.answers.opensGithub", "(opens GitHub in a new tab)")}</span>
    </a>
  );
}

function CodeAnswers({ v }: { v: SetupValues }) {
  const c = v.code;
  const github = c.home === "github" ? c : null;
  if (v.existing) {
    return (
      <dl className="divide-y divide-line">
        <Row label={t("analysis.business.answers.codeOnGithub", "Its code on GitHub")}>{github ? <RepoLink owner={github.owner} name={github.name} branch={github.branch} /> : <NotAnswered />}</Row>
        {github && <Row label={t("analysis.business.answers.branch", "Branch")}>{github.branch}</Row>}
        <Row label={t("analysis.business.answers.webpage", "Webpage")}>{v.appUrl ? <WebLink url={v.appUrl} /> : <NotAnswered />}</Row>
        <Row label={t("analysis.business.answers.testVersion", "Safe test version")}>{v.testEnv || <NotAnswered />}</Row>
        <Row label={t("analysis.business.answers.howStarted", "How it is started")}>{v.runInstructions ? <span className="block whitespace-pre-line">{v.runInstructions}</span> : <NotAnswered />}</Row>
      </dl>
    );
  }
  return (
    <dl className="divide-y divide-line">
      <Row label={t("analysis.business.repo.whereCode", "Where the code lives")}>
        {c.home === "github" ? (c.existingRepo ? t("analysis.business.answers.teamRepo", "A GitHub repository the team already has") : t("analysis.business.answers.newRepoCreated", "A new GitHub repository, created for this project"))
          : c.home === "factory" ? <>{t("analysis.business.answers.keptInFactory", "Kept safe in MADP Factory")}<Muted>{t("analysis.business.answers.githubOptional", "Connecting GitHub is optional.")}</Muted></>
          : c.home === "create" ? <>{t("analysis.business.answers.newPrivateRepo", "A new private GitHub repository")}<Muted>{t("analysis.business.answers.notCreatedYet", "Not created yet: it is created once GitHub is connected.")}</Muted></>
          : c.home === "pick" ? <>{t("analysis.business.answers.teamRepo", "A GitHub repository the team already has")}<Muted>{t("analysis.business.answers.notPicked", "Not picked yet.")}</Muted></>
          : <NotAnswered />}
      </Row>
      {github && <Row label={t("analysis.business.answers.repository", "Repository")}><RepoLink owner={github.owner} name={github.name} branch={github.branch} /></Row>}
      {github && <Row label={t("analysis.business.answers.branch", "Branch")}>{github.branch}</Row>}
      {github && isRepoVisibility(github.visibility) && <Row label={t("analysis.business.answers.visibility", "Visibility")}>{visibilityName(github.visibility)}</Row>}
      {v.blocksProjectRef && <Row label={t("analysis.business.answers.blocksProject", "SELISE Blocks project")}>{v.blocksProjectRef}</Row>}
    </dl>
  );
}

function MaterialAnswers({ items, onOpenItem }: { items: readonly SharedItem[]; onOpenItem?: (id: string) => void }) {
  if (items.length === 0) return <p className="text-[14px] text-ink3">{t("analysis.business.answers.nothingShared", "Nothing shared yet.")}</p>;
  return (
    <>
      <p className="mb-3 text-[13px] text-ink2">
        {items.length === 1 ? t("analysis.business.answers.oneShared", "1 item shared. Open one to read it in “Your material”.") : t("analysis.business.answers.manyShared", "{count} items shared. Open one to read it in “Your material”.", { count: items.length })}
      </p>
      <ul aria-label={t("analysis.business.answers.material", "Material you shared")} className="flex flex-col gap-1 rounded-block bg-surface2 p-1.5">
        {items.map((it) => {
          const Icon = it.kind === "file" ? fileIconFor({ name: it.title, mime: it.mime }) : it.scratch ? SCRATCH_ICON : NOTE_ICON;
          const meta = [it.kind === "file" ? t("analysis.business.file.file", "File") : t("analysis.business.pane.note", "Note"), it.folderName, it.kind === "file" && it.sizeBytes > 0 ? formatSize(it.sizeBytes) : ""].filter(Boolean).join(" · ");
          return (
            <li key={`${it.kind}:${it.id}`}>
              <button type="button" onClick={() => onOpenItem?.(it.scratch ? SCRATCH_ID : it.id)} data-item={it.kind}
                className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left outline-none transition hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent/60">
                <Icon size={17} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink2" />
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{t("analysis.business.file.open", "Open")} </span>
                  <span className="block truncate text-[14px] text-ink">{it.title}</span>
                  <span className="block truncate text-[12px] text-ink3">{meta}</span>
                </span>
                <ChevronRight size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink3" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export interface SetupAnswersBodyProps {
  section: SetupChipId;
  values: SetupValues;
  /** The one plain line that says why the answers are read-only. */
  note: string;
  material: readonly SharedItem[];
  onOpenItem?: (id: string) => void;
  /** An existing product attached as it is live: About shows its profile. */
  profile?: LiveProfile | null;
}

/** The window's content (no portal: it renders anywhere, also on the server). */
export function SetupAnswersBody({ section, values, note, material, onOpenItem, profile }: SetupAnswersBodyProps) {
  return (
    <div className="flex flex-col gap-4" data-answers={section}>
      <p className="flex items-start gap-2 rounded-block bg-surface2 px-3.5 py-2.5 text-[13px] text-ink2">
        <Lock size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
        <span>{note}</span>
      </p>
      {section === "about" && <AboutAnswers v={values} profile={profile} />}
      {section === "where" && <CodeAnswers v={values} />}
      {section === "share" && <MaterialAnswers items={material} onOpenItem={onOpenItem} />}
    </div>
  );
}

/** `onChangeCode`: the Code window can still change where the code lives (the project team, before the build). */
export function SetupAnswersWindow({ section, values, material, note, onClose, onOpenItem, onChangeCode, profile }: {
  project: ProjectRecord; section: SetupChipId; values: SetupValues; material: readonly SharedItem[]; note: string;
  onClose: () => void; onOpenItem: (id: string) => void; onChangeCode?: () => void; profile?: LiveProfile | null;
}) {
  useT();
  const change = section === "where" && onChangeCode ? onChangeCode : null;
  const github = values.code.home === "github";
  return (
    <Modal open onClose={onClose} width={640} title={answersTitle(section, values.existing)}
      footer={<>
        {change && (
          <Button variant="ghost" icon={<FolderGit2 size={16} strokeWidth={1.75} aria-hidden />} onClick={change}>
            {github ? t("analysis.business.answers.changeRepo", "Change the repository") : values.existing ? t("analysis.business.answers.addRepo", "Add the repository") : t("analysis.business.answers.connectGithub", "Connect GitHub")}
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>{t("analysis.business.close", "Close")}</Button>
      </>}>
      <SetupAnswersBody section={section} values={values} note={change ? codeStillOpenText() : note}
        material={material} onOpenItem={onOpenItem} profile={profile} />
    </Modal>
  );
}
