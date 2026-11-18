/** The development team's line while a build waits for a person (the Blocks sign-in, buildStep.ts waitsForPerson): the
 *  same place as the working line, without its animation, because nothing is being built until then. */
import { KeyRound } from "lucide-react";
import { waitingForYou } from "./buildStep";
import { useT } from "@/madp/i18n";

export function WaitingForYouLine({ text }: { text?: string }) {
  useT();
  return (
    <div role="status" className="flex flex-col gap-2 rounded-block bg-ai-soft px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-[rgb(var(--c-ai-text))]">
        <KeyRound size={15} aria-hidden className="shrink-0" />{text ?? waitingForYou()}
      </p>
    </div>
  );
}
