import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useBoolean } from "@/hooks/use-boolean";
import { useDebounce } from "@/hooks/use-debounce";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import useIsMobile from "@/hooks/use-is-mobile";
import usePopoverWidth from "@/hooks/use-popover-width";
import { useLanguageSwitcher } from "@/hooks/use-language-switcher";

describe("useBoolean", () => {
  it("defaults to false", () => {
    const { result } = renderHook(() => useBoolean());
    expect(result.current.value).toBe(false);
  });

  it("honours the initial value", () => {
    const { result } = renderHook(() => useBoolean(true));
    expect(result.current.value).toBe(true);
  });

  it("setTrue / setFalse / toggle mutate the value", () => {
    const { result } = renderHook(() => useBoolean(false));
    act(() => result.current.setTrue());
    expect(result.current.value).toBe(true);
    act(() => result.current.setFalse());
    expect(result.current.value).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.value).toBe(true);
  });
});

describe("useDebounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("a", 200));
    expect(result.current).toBe("a");
  });

  it("updates only after the delay", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 200),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "b" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("b");
  });
});

describe("useCopyToClipboard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes text and calls onSuccess", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy("hello", onSuccess);
    });

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("calls onError when clipboard API is unavailable", async () => {
    Object.assign(navigator, { clipboard: undefined });
    const onError = vi.fn();

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy("x", undefined, onError);
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("calls onError when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    const onError = vi.fn();

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy("x", undefined, onError);
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("useIsMobile", () => {
  afterEach(() => {
    window.innerWidth = 1024;
  });

  it("is true below the breakpoint", () => {
    window.innerWidth = 500;
    const { result } = renderHook(() => useIsMobile(768));
    expect(result.current).toBe(true);
  });

  it("is false above the breakpoint and reacts to resize", () => {
    window.innerWidth = 1200;
    const { result } = renderHook(() => useIsMobile(768));
    expect(result.current).toBe(false);

    act(() => {
      window.innerWidth = 400;
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(true);
  });
});

describe("usePopoverWidth", () => {
  it("returns a ref and an initially undefined width", () => {
    const { result } = renderHook(() => usePopoverWidth());
    const [ref, width] = result.current;
    expect(ref).toHaveProperty("current");
    expect(width).toBeUndefined();
  });
});

describe("useLanguageSwitcher", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to en and persists changes", async () => {
    const { result } = renderHook(() => useLanguageSwitcher());
    expect(result.current.language).toBe("en");

    act(() => result.current.changeLanguage("fr"));
    await waitFor(() => expect(result.current.language).toBe("fr"));
    expect(localStorage.getItem("language")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("reads an existing language from localStorage", () => {
    localStorage.setItem("language", "de");
    const { result } = renderHook(() => useLanguageSwitcher());
    expect(result.current.language).toBe("de");
  });
});
