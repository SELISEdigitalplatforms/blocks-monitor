/** One definition of an "open question" for every count in the app: a clarification that is open or deferred. */
export const OPEN_QUESTION_STATUSES = ["open", "deferred"] as const;

export function isOpenQuestion(status: string | null | undefined): boolean {
  return status === "open" || status === "deferred";
}

export function countOpenQuestions(rows: readonly { Status?: string | null }[]): number {
  return rows.filter((r) => isOpenQuestion(r.Status)).length;
}

/** The label that follows a count wherever it is shown. */
export const OPEN_QUESTIONS_LABEL = "open or deferred";
