import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  reducer,
  useToast,
  toast,
  showSuccessToast,
  showInfoToast,
  showErrorToast,
} from "@/hooks/use-toast";

type State = Parameters<typeof reducer>[0];

describe("use-toast reducer", () => {
  const t1 = { id: "1", title: "one", open: true };
  const t2 = { id: "2", title: "two", open: true };

  it("ADD_TOAST caps the list at the toast limit (1)", () => {
    let state: State = { toasts: [] };
    state = reducer(state, { type: "ADD_TOAST", toast: t1 as never });
    state = reducer(state, { type: "ADD_TOAST", toast: t2 as never });
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].id).toBe("2");
  });

  it("UPDATE_TOAST merges fields into the matching toast", () => {
    const start: State = { toasts: [{ ...t1 } as never] };
    const next = reducer(start, {
      type: "UPDATE_TOAST",
      toast: { id: "1", title: "updated" } as never,
    });
    expect(next.toasts[0].title).toBe("updated");
  });

  it("DISMISS_TOAST closes the targeted toast", () => {
    const start: State = { toasts: [{ ...t1 } as never] };
    const next = reducer(start, { type: "DISMISS_TOAST", toastId: "1" });
    expect(next.toasts[0].open).toBe(false);
  });

  it("DISMISS_TOAST with no id closes all toasts", () => {
    const start: State = { toasts: [{ ...t1 } as never, { ...t2 } as never] };
    const next = reducer(start, { type: "DISMISS_TOAST" });
    expect(next.toasts.every((t) => t.open === false)).toBe(true);
  });

  it("REMOVE_TOAST removes a specific toast", () => {
    const start: State = { toasts: [{ ...t1 } as never, { ...t2 } as never] };
    const next = reducer(start, { type: "REMOVE_TOAST", toastId: "1" });
    expect(next.toasts.map((t) => t.id)).toEqual(["2"]);
  });

  it("REMOVE_TOAST with no id clears everything", () => {
    const start: State = { toasts: [{ ...t1 } as never] };
    const next = reducer(start, { type: "REMOVE_TOAST", toastId: undefined });
    expect(next.toasts).toEqual([]);
  });
});

describe("useToast integration", () => {
  afterEach(() => {
    // Ensure global memory state is cleared between tests.
    const { result } = renderHook(() => useToast());
    act(() => result.current.dismiss());
  });

  it("adds a toast that shows up in the hook state", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Hi" });
    });
    expect(result.current.toasts[0].title).toBe("Hi");
    expect(result.current.toasts[0].open).toBe(true);
  });

  it("toast() returns handles to update and dismiss", () => {
    const { result } = renderHook(() => useToast());
    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = result.current.toast({ title: "First" });
    });
    act(() => handle!.update({ id: handle!.id, title: "Second" } as never));
    expect(result.current.toasts[0].title).toBe("Second");
    act(() => handle!.dismiss());
    expect(result.current.toasts[0].open).toBe(false);
  });
});

describe("toast helper variants", () => {
  beforeEach(() => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.dismiss());
  });

  it("showSuccessToast sets the success variant", () => {
    const { result } = renderHook(() => useToast());
    act(() => showSuccessToast({ description: "done" }));
    expect(result.current.toasts[0].variant).toBe("success");
    expect(result.current.toasts[0].title).toBe("Success");
  });

  it("showInfoToast sets the info variant", () => {
    const { result } = renderHook(() => useToast());
    act(() => showInfoToast({ description: "fyi" }));
    expect(result.current.toasts[0].variant).toBe("info");
  });

  it("showErrorToast sets the destructive variant from an error object", () => {
    const { result } = renderHook(() => useToast());
    act(() => showErrorToast({ errors: { name: "Name required" } }));
    expect(result.current.toasts[0].variant).toBe("destructive");
    expect(result.current.toasts[0].title).toBe("Failed");
  });

  it("showErrorToast renders multiple messages as elements", () => {
    const { result } = renderHook(() => useToast());
    act(() =>
      showErrorToast({
        errors: { email: ["too short", "invalid"], name: "required" },
      }),
    );
    // description becomes a React fragment array for multi-message errors
    expect(result.current.toasts[0].description).toBeTruthy();
  });
});

describe("toast removal queue", () => {
  // TOAST_REMOVE_DELAY is a little over 16 minutes, so the delay has to be
  // driven by fake timers rather than waited out.
  const REMOVE_DELAY = 1000000;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    const { result } = renderHook(() => useToast());
    act(() => result.current.dismiss());
  });

  it("drops a dismissed toast from the list once the remove delay elapses", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Bye" });
    });
    const id = result.current.toasts[0].id;

    act(() => result.current.dismiss(id));
    // dismissing only closes it, the toast is still mounted so it can animate out
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].open).toBe(false);

    act(() => {
      vi.advanceTimersByTime(REMOVE_DELAY);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("queues a toast for removal only once", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Once" });
    });
    const id = result.current.toasts[0].id;

    // A second dismiss must not schedule a second removal for the same toast.
    act(() => result.current.dismiss(id));
    act(() => result.current.dismiss(id));

    act(() => {
      vi.advanceTimersByTime(REMOVE_DELAY);
    });

    expect(result.current.toasts).toHaveLength(0);
  });
});

describe("toast onOpenChange", () => {
  afterEach(() => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.dismiss());
  });

  it("dismisses the toast when the ui reports it has closed", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Closable" });
    });

    act(() => result.current.toasts[0].onOpenChange?.(false));

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("leaves the toast alone while the ui reports it still open", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Staying" });
    });

    act(() => result.current.toasts[0].onOpenChange?.(true));

    expect(result.current.toasts[0].open).toBe(true);
  });
});
