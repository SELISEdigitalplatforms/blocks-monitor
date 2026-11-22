import type { StageId } from '@/data/types';
import { t } from '@/i18n';
import { isBuildActive, isChatRole, type ChatFacts, type ChatRole } from '@/domain/agentChat';
import { HUMAN_ROLE_TEXT as HUMAN_ROLE } from '@/components/engine/jobWords';

export { HUMAN_ROLE, isChatRole };

export const STAGE_OF: Record<ChatRole, StageId> = {
  planner: '01', dev: '02', reviewer: '03', qa: '04', secops: '05', docs: '06', shipper: '07',
};

/** The quick prompts under the chat, in the current language; the last one only fills the composer. */
export const quickPrompts = (): string[] => [
  t('studio.office.chat.promptWorkingOn', 'What are you working on?'),
  t('studio.office.chat.promptBlockers', 'Any blockers?'),
  t('studio.office.chat.promptTask', 'I have a task for you'),
];

/** "n tickets" with the right singular or plural */
const tickets = (n: number) => (n === 1 ? t('studio.office.chat.ticketOne', '1 ticket') : t('studio.office.chat.ticketMany', '{n} tickets', { n }));

/** The status line under the agent's name, from the project's real records: an agent "works on" a ticket only while
 *  a build runs and the ticket sits in its column; planned tickets are planned, not started. */
export function statusLine(f: ChatFacts): string {
  const building = f.build !== null && isBuildActive(f.build.status);
  const b = f.board;
  if (f.role === 'planner') {
    if (b.total === 0) return t('studio.office.chat.statusNoTickets', 'No tickets planned yet');
    if (building) {
      const build = f.build!.status === 'running'
        ? t('studio.office.chat.statusBuildRunningAt', 'Build running at {progress} %', { progress: f.build!.progress })
        : t('studio.office.chat.statusBuildStarting', 'Build starting');
      return t('studio.office.chat.statusBuildDone', '{build} · {done} of {tickets} done', { build, done: b.done, tickets: tickets(b.total) });
    }
    if (b.done === b.total) return b.total === 1 ? t('studio.office.chat.statusTicketDone', 'The ticket is done') : t('studio.office.chat.statusAllDone', 'All {n} tickets done', { n: b.total });
    if (b.done === 0 && b.planned === b.total) return t('studio.office.chat.statusPlannedNotStarted', '{tickets} planned · not started yet', { tickets: tickets(b.total) });
    return t('studio.office.chat.statusDoneStillPlanned', '{done} of {tickets} done · {planned} still planned', { done: b.done, tickets: tickets(b.total), planned: b.planned });
  }
  const first = f.openTickets[0];
  if (first && building) return t('studio.office.chat.statusWorkingOn', 'Working on {code} · {title}', { code: first.code, title: first.title });
  if (first) return t('studio.office.chat.statusWaitsNextBuild', '{code} waits for the next build · {title}', { code: first.code, title: first.title });
  if ((f.role === 'dev' || f.role === 'shipper') && building) {
    return f.build!.status === 'running'
      ? t('studio.office.chat.statusBuildRunningAt', 'Build running at {progress} %', { progress: f.build!.progress })
      : t('studio.office.chat.statusBuildStarting', 'Build starting');
  }
  if (f.total > 0 && f.done === f.total) return t('studio.office.chat.statusDoneWithTickets', 'Done with my tickets');
  if (b.total > 0 && b.done === 0 && b.planned === b.total) return t('studio.office.chat.statusWaitingFirstBuild', 'Waiting for the first build');
  return t('studio.office.chat.statusNothingOpen', 'Nothing open right now');
}

const GREETING: Record<ChatRole, () => string> = {
  planner: () => t('studio.office.chat.greetingPlanner', 'Hi, I plan the work. Ask me about priorities, or tell me what you need.'),
  dev: () => t('studio.office.chat.greetingDev', 'Hi, I write the code. Ask me what I am building.'),
  reviewer: () => t('studio.office.chat.greetingReviewer', 'Hi, I review the code. Ask me what I found.'),
  qa: () => t('studio.office.chat.greetingQa', 'Hi, I run the tests. Ask me how they look.'),
  secops: () => t('studio.office.chat.greetingSecops', 'Hi, I look after security. Ask me what I checked.'),
  docs: () => t('studio.office.chat.greetingDocs', 'Hi, I write the docs. Ask me which pages are done.'),
  shipper: () => t('studio.office.chat.greetingShipper', 'Hi, I run the release gate. Ask me about the gate or the environments.'),
};
export const greetingLine = (f: ChatFacts): string => GREETING[f.role]();
