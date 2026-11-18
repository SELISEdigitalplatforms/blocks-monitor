/**
 * useNextAction: the ONE "Next for you" action of Business Analysis (next design), for the card at the top of the
 * analyst's column and the sticky bar. The facts come from the same hooks and rules as today's page (useNextFacts);
 * the words come from the pure nextActionFrom (nextAction.ts, unit-tested).
 */
import { useMemo } from "react";
import type { AnalysisCtx, NextAction } from "../model";
import { nextActionFrom } from "./nextAction";
import { useNextFacts } from "./useNextFacts";

export { nextActionFrom, type NextFacts } from "./nextAction";
export { useNextFacts } from "./useNextFacts";

export function useNextAction(ctx: AnalysisCtx): NextAction {
  const facts = useNextFacts(ctx);
  // one stable object while nothing that decides it changed (the card and the sticky bar re-render less)
  const key = JSON.stringify(facts);
  return useMemo(() => nextActionFrom(facts), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
