/** Ported from blocks-release deployment-logs.utils — badge + elapsed helpers only. */

export const DURATION_PLACEHOLDER = "--";

export const DEPLOYMENT_LOG_EVENT_STATUS = {
  PENDING: "Pending",
  PUBLISHED: "Published",
  PASSED: "Passed",
  RUNNING: "Running",
  STARTED: "Started",
  COMPLETED: "Completed",
  SUCCESS: "Succeeded",
  FAILED: "Failed",
  UNKNOWN: "Unknown",
  ERROR: "Error",
  NO_BUILD: "NoBuild",
  EVENT_STARTED: "EventStarted",
  EVENT_FINISHED: "EventFinished",
  EVENT_FAILED: "EventFailed",
} as const;

export function getDeploymentLogEventBadgeStyle(status: string) {
  const styles: Record<string, { bg: string; text: string; hoverBg: string; hoverText: string }> = {
    [DEPLOYMENT_LOG_EVENT_STATUS.PENDING]: {
      bg: "bg-gray-100",
      text: "text-gray-800",
      hoverBg: "hover:bg-gray-100",
      hoverText: "hover:text-gray-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.PUBLISHED]: {
      bg: "bg-green-100",
      text: "text-green-800",
      hoverBg: "hover:bg-green-100",
      hoverText: "hover:text-green-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.PASSED]: {
      bg: "bg-green-100",
      text: "text-green-800",
      hoverBg: "hover:bg-green-100",
      hoverText: "hover:text-green-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.RUNNING]: {
      bg: "bg-blue-100",
      text: "text-blue-800",
      hoverBg: "hover:bg-blue-100",
      hoverText: "hover:text-blue-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.STARTED]: {
      bg: "bg-blue-100",
      text: "text-blue-800",
      hoverBg: "hover:bg-blue-100",
      hoverText: "hover:text-blue-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.COMPLETED]: {
      bg: "bg-green-100",
      text: "text-green-800",
      hoverBg: "hover:bg-green-100",
      hoverText: "hover:text-green-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.SUCCESS]: {
      bg: "bg-green-100",
      text: "text-green-800",
      hoverBg: "hover:bg-green-100",
      hoverText: "hover:text-green-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.FAILED]: {
      bg: "bg-red-100",
      text: "text-red-800",
      hoverBg: "hover:bg-red-100",
      hoverText: "hover:text-red-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.UNKNOWN]: {
      bg: "bg-gray-100",
      text: "text-gray-800",
      hoverBg: "hover:bg-gray-100",
      hoverText: "hover:text-gray-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.ERROR]: {
      bg: "bg-red-100",
      text: "text-red-800",
      hoverBg: "hover:bg-red-100",
      hoverText: "hover:text-red-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.EVENT_STARTED]: {
      bg: "bg-blue-100",
      text: "text-blue-800",
      hoverBg: "hover:bg-blue-100",
      hoverText: "hover:text-blue-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.EVENT_FINISHED]: {
      bg: "bg-green-100",
      text: "text-green-800",
      hoverBg: "hover:bg-green-100",
      hoverText: "hover:text-green-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.EVENT_FAILED]: {
      bg: "bg-red-100",
      text: "text-red-800",
      hoverBg: "hover:bg-red-100",
      hoverText: "hover:text-red-800",
    },
    [DEPLOYMENT_LOG_EVENT_STATUS.NO_BUILD]: {
      bg: "bg-secondary",
      text: "text-medium-emphasis",
      hoverBg: "hover:bg-secondary",
      hoverText: "hover:text-medium-emphasis",
    },
  };

  return (
    styles[status] || {
      bg: "bg-yellow-100",
      text: "text-yellow-700",
      hoverBg: "hover:bg-yellow-100",
      hoverText: "hover:text-yellow-700",
    }
  );
}

export function getDeploymentLogEventBadgeClassName(status: string) {
  const style = getDeploymentLogEventBadgeStyle(status);
  return `inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text} ${style.hoverBg} ${style.hoverText}`;
}

export const formatElapsedTime = (durationMs: number): string => {
  if (!Number.isFinite(durationMs)) return DURATION_PLACEHOLDER;
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
};

const LIVE_BUILD_STATUSES: ReadonlySet<string> = new Set([
  DEPLOYMENT_LOG_EVENT_STATUS.PENDING,
  DEPLOYMENT_LOG_EVENT_STATUS.RUNNING,
  DEPLOYMENT_LOG_EVENT_STATUS.STARTED,
  DEPLOYMENT_LOG_EVENT_STATUS.EVENT_STARTED,
  "Queued",
  "Paused",
  "Resumed",
]);

export const isLiveBuildStatus = (status?: string | null): boolean =>
  !!status && LIVE_BUILD_STATUSES.has(status);
