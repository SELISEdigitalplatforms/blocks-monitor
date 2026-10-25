import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs`. Reading the clock in an initializer and an
 * effect keeps render pure (react-hooks purity rules) while letting durations and time windows
 * move forward for as long as the page stays open.
 */
export const useNow = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
};
