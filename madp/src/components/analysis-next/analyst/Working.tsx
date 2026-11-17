/** "I'm working on it": three soft dots that breathe one after another, and a calm sentence. With reduced motion the
 *  dots stand still (the sentence says it all). */
import { cn } from "@/lib/cn";

export function WorkingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot motion-reduce:animate-none"
          style={{ animationDelay: `${i * 0.22}s` }} />
      ))}
    </span>
  );
}

export function Working({ text, className }: { text: string; className?: string }) {
  return (
    <p role="status" className={cn("flex items-start gap-2.5 text-[15px] leading-6 text-ink2", className)}>
      <WorkingDots className="mt-2.5 shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}
