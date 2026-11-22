// The shared Popover's own scroll: a long menu (the workspace switcher with 14 workspaces) scrolls with the wheel, a
// trackpad, touch and the keyboard, and only a scroll that moves its anchor places it again. The fakes below lay out as
// a browser does where it matters: a panel's scroll range is its content less its height, and a layout (reading
// offsetHeight) clamps scrollTop to that range. jsdom has no layout at all, so it could not show the bug.
import { describe, expect, it, vi } from "vitest";
import { FOCUS_ITEMS, followAnchor, itemsPerView, pageIndex, pageThroughItems, placePanel, revealItem, revealTop, scrollMovesAnchor } from "./popover";
import { pageOption, type SelectOption } from "./kit";

type Listener = (e: Event) => void;

class FakeNode {
  parent: FakeNode | null = null;
  contains(n: unknown): boolean {
    for (let p = n as FakeNode | null; p; p = p.parent) if (p === this) return true;
    return false;
  }
  add<T extends FakeNode>(child: T): T { child.parent = this; return child; }
}

/** A position: fixed menu panel with `content` px of rows, laid out like a browser lays it out. */
class FakePanel extends FakeNode {
  style: Record<string, string> = {};
  #top = 0;
  constructor(public content: number, public cssMaxHeight = "none") { super(); }
  get clientHeight() {
    const inline = parseFloat(this.style.maxHeight), css = parseFloat(this.cssMaxHeight);
    return Math.min(this.content, Number.isFinite(inline) ? inline : Infinity, Number.isFinite(css) ? css : Infinity);
  }
  get scrollHeight() { return this.content; }
  get offsetWidth() { return 288; }
  /** a layout: the scroll range is what it is now, so scrollTop is clamped to it */
  get offsetHeight() { this.scrollTop = this.#top; return this.clientHeight; }
  get scrollTop() { return this.#top; }
  set scrollTop(v: number) { this.#top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)); }
}

const anchorRect = { top: 20, bottom: 68, left: 300, right: 340, width: 40, height: 48 };
const anchorIn = (parent: FakeNode) => Object.assign(parent.add(new FakeNode()), { getBoundingClientRect: () => anchorRect });
const view = { innerWidth: 1440, innerHeight: 900, getComputedStyle: (el: Element) => ({ maxHeight: (el as unknown as FakePanel).cssMaxHeight, overflowY: "auto", paddingTop: "8px" }) } as unknown as Window;

function fakeEvents() {
  const on = new Map<string, Listener>();
  return {
    events: { addEventListener: (t: string, f: Listener) => on.set(t, f), removeEventListener: (t: string) => on.delete(t) } as unknown as Window,
    fire: (type: string, target: unknown) => on.get(type)?.({ type, target } as unknown as Event),
    on,
  };
}

/** The page: body > main (scrolls) > top bar > the trigger, and the panel in a portal on body. */
function page(content = 1071, cssMaxHeight = "none") {
  const doc = new FakeNode(), body = doc.add(new FakeNode()), main = body.add(new FakeNode());
  const aside = body.add(new FakeNode());
  const anchor = anchorIn(main.add(new FakeNode()));
  const panel = body.add(new FakePanel(content, cssMaxHeight));
  const el = panel as unknown as HTMLElement, a = anchor as unknown as HTMLElement;
  const place = vi.fn(() => placePanel(el, a, {}, view));
  return { doc, body, main, aside, anchor, panel, el, a, place };
}

describe("which scrolls move a popover's anchor", () => {
  const p = page();
  it("the page and the anchor's scrolling containers do", () => {
    expect(scrollMovesAnchor(p.doc as unknown as EventTarget, p.a)).toBe(true);
    expect(scrollMovesAnchor(p.main as unknown as EventTarget, p.a)).toBe(true);
    // a window-level target, or none at all: placed again to be safe
    expect(scrollMovesAnchor({} as EventTarget, p.a)).toBe(true);
    expect(scrollMovesAnchor(null, p.a)).toBe(true);
  });
  it("the open panel's own scroll, and a container beside the anchor, do not", () => {
    expect(scrollMovesAnchor(p.panel as unknown as EventTarget, p.a)).toBe(false);
    expect(scrollMovesAnchor(p.panel.add(new FakeNode()) as unknown as EventTarget, p.a)).toBe(false);
    expect(scrollMovesAnchor(p.aside as unknown as EventTarget, p.a)).toBe(false);
  });
});

describe("placing a long panel", () => {
  it("caps it to the room below the anchor, so it scrolls", () => {
    const p = page();
    placePanel(p.el, p.a, {}, view);
    expect(p.panel.style.maxHeight).toBe("816px");
    expect(p.panel.style.top).toBe("76px");
    expect(p.panel.scrollHeight).toBeGreaterThan(p.panel.clientHeight);
  });

  it("keeps where the user scrolled to when it is placed again (measuring it clamps scrollTop to 0)", () => {
    const p = page();
    placePanel(p.el, p.a, {}, view);
    p.panel.scrollTop = 200;
    placePanel(p.el, p.a, {}, view);
    expect(p.panel.scrollTop).toBe(200);
    expect(p.panel.style.maxHeight).toBe("816px");
  });

  it("a Select list with its own CSS cap keeps its scroll too", () => {
    const p = page(900, "256px");
    placePanel(p.el, p.a, {}, view);
    p.panel.scrollTop = 300;
    placePanel(p.el, p.a, {}, view);
    expect(p.panel.style.maxHeight).toBe("256px");
    expect(p.panel.scrollTop).toBe(300);
  });
});

describe("an open popover follows its anchor, not its own scroll", () => {
  const open = (p: ReturnType<typeof page>, visible = () => true) => {
    const ev = fakeEvents(), close = vi.fn();
    p.place();
    const stop = followAnchor(() => p.a, p.place, close, { events: ev.events, visible });
    p.place.mockClear();
    return { ...ev, close, stop };
  };

  it("a wheel, swipe or key scroll inside the panel stays where it scrolled to (the bug: it jumped back to 0)", () => {
    const p = page(), o = open(p);
    p.panel.scrollTop = 255; // what the wheel / the touch scroll does, and the scroll event that follows it
    o.fire("scroll", p.panel);
    expect(p.place).not.toHaveBeenCalled();
    expect(o.close).not.toHaveBeenCalled();
    expect(p.panel.scrollTop).toBe(255);
    // to the end of the list, and back
    p.panel.scrollTop = 10_000;
    o.fire("scroll", p.panel);
    expect(p.panel.scrollTop).toBe(1071 - 816);
    p.panel.scrollTop = 0;
    o.fire("scroll", p.panel);
    expect(p.panel.scrollTop).toBe(0);
  });

  it("a scroll in a container inside the panel is the panel's own too", () => {
    const p = page(), o = open(p);
    o.fire("scroll", p.panel.add(new FakeNode()));
    expect(p.place).not.toHaveBeenCalled();
  });

  it("the page scrolling places it again and keeps its scroll; a resize too", () => {
    const p = page(), o = open(p);
    p.panel.scrollTop = 120;
    o.fire("scroll", p.doc);
    o.fire("scroll", p.main);
    o.fire("resize", undefined);
    expect(p.place).toHaveBeenCalledTimes(3);
    expect(p.panel.scrollTop).toBe(120);
  });

  it("a container beside the anchor scrolling leaves it alone", () => {
    const p = page(), o = open(p);
    o.fire("scroll", p.aside);
    expect(p.place).not.toHaveBeenCalled();
  });

  it("closes once a scroll takes the anchor out of view, and never for the panel's own scroll", () => {
    const p = page(), o = open(p, () => false);
    o.fire("scroll", p.panel);
    expect(o.close).not.toHaveBeenCalled();
    o.fire("scroll", p.doc);
    expect(o.close).toHaveBeenCalledTimes(1);
  });

  it("removes its listeners on close", () => {
    const p = page(), o = open(p);
    o.stop();
    expect(o.on.size).toBe(0);
  });
});

describe("the keyboard in a long menu", () => {
  it("a page is the rows that fit, less one; 10 before a layout", () => {
    expect(itemsPerView({ clientHeight: 816 }, { offsetHeight: 62 })).toBe(12);
    expect(itemsPerView({ clientHeight: 40 }, { offsetHeight: 62 })).toBe(1);
    expect(itemsPerView({ clientHeight: 0 }, { offsetHeight: 0 })).toBe(10);
    expect(itemsPerView({ clientHeight: 816 }, null)).toBe(10);
  });

  it("PageDown / PageUp move a page and stop at the first and last row", () => {
    expect(pageIndex(0, 16, 1, 12)).toBe(12);
    expect(pageIndex(12, 16, 1, 12)).toBe(15);
    expect(pageIndex(15, 16, -1, 12)).toBe(3);
    expect(pageIndex(3, 16, -1, 12)).toBe(0);
    expect(pageIndex(4, 16, 1, 0)).toBe(5);
  });

  const menu = (n: number, disabled: number[] = []) => {
    let active: unknown = null;
    const items = Array.from({ length: n }, (_, i) => ({
      i, disabled: disabled.includes(i), offsetHeight: 62, getAttribute: () => null, focus() { active = this; },
    }));
    const panel = { clientHeight: 816, querySelectorAll: vi.fn(() => items) };
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => {
      const e = { key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), ...mods };
      return { handled: pageThroughItems(e, panel as unknown as HTMLElement, active as Element), e };
    };
    return { items, panel, key, focus: (i: number) => { active = items[i]; }, active: () => (active as { i: number } | null)?.i };
  };

  it("moves focus through the menu rows a page at a time", () => {
    const m = menu(16);
    m.focus(0);
    expect(m.key("PageDown").handled).toBe(true);
    expect(m.active()).toBe(12);
    m.key("PageDown");
    expect(m.active()).toBe(15);
    m.key("PageUp");
    expect(m.active()).toBe(3);
    expect(m.panel.querySelectorAll).toHaveBeenCalledWith(FOCUS_ITEMS);
  });

  it("skips disabled rows", () => {
    const m = menu(16, [12, 13, 14, 15]);
    m.focus(0);
    m.key("PageDown");
    expect(m.active()).toBe(11);
  });

  it("leaves other keys, modified keys and focus outside the rows to the browser", () => {
    const m = menu(16);
    expect(m.key("PageDown").handled).toBe(false); // nothing focused yet
    m.focus(2);
    for (const r of [m.key("ArrowDown"), m.key("PageDown", { shiftKey: true }), m.key("PageDown", { ctrlKey: true })]) {
      expect(r.handled).toBe(false);
      expect(r.e.preventDefault).not.toHaveBeenCalled();
    }
    expect(m.active()).toBe(2);
    expect(m.key("PageDown").e.preventDefault).toHaveBeenCalled();
  });
});

describe("the focused row stays in view", () => {
  const box = { top: 76, bottom: 892 };
  it("scrolls as little as possible, keeping the panel's padding clear", () => {
    expect(revealTop(0, box, { top: 100, bottom: 160 }, 8)).toBe(0);
    expect(revealTop(0, box, { top: 900, bottom: 962 }, 8)).toBe(962 - 884);
    expect(revealTop(300, box, { top: 40, bottom: 100 }, 8)).toBe(300 - (84 - 40));
    // a row taller than the view: from its top
    expect(revealTop(0, box, { top: 120, bottom: 1200 }, 8)).toBe(120 - 84);
  });

  it("only a scrolling panel moves, and only for a row inside it", () => {
    const p = page();
    placePanel(p.el, p.a, {}, view);
    const rects = { panel: { top: 76, bottom: 892 }, row: { top: 900, bottom: 962 } };
    Object.assign(p.panel, { getBoundingClientRect: () => rects.panel });
    const row = Object.assign(p.panel.add(new FakeNode()), { getBoundingClientRect: () => rects.row }) as unknown as HTMLElement;
    revealItem(p.el, row, view);
    expect(p.panel.scrollTop).toBe(962 - 884);
    const outside = Object.assign(new FakeNode(), { getBoundingClientRect: () => ({ top: 2000, bottom: 2060 }) }) as unknown as HTMLElement;
    revealItem(p.el, outside, view);
    expect(p.panel.scrollTop).toBe(962 - 884);

    const short = page(300);
    placePanel(short.el, short.a, {}, view);
    Object.assign(short.panel, { getBoundingClientRect: () => rects.panel });
    revealItem(short.el, Object.assign(short.panel.add(new FakeNode()), { getBoundingClientRect: () => rects.row }) as unknown as HTMLElement, view);
    expect(short.panel.scrollTop).toBe(0);
  });
});

describe("PageDown / PageUp in a Select list", () => {
  const opts = (n: number, disabled: number[] = []): SelectOption[] => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `Option ${i}`, disabled: disabled.includes(i) }));
  it("moves a page of enabled options and holds at the ends", () => {
    expect(pageOption(opts(20), 0, 1, 5)).toBe(5);
    expect(pageOption(opts(20), 18, 1, 5)).toBe(19);
    expect(pageOption(opts(20), 3, -1, 5)).toBe(0);
    expect(pageOption(opts(20, [1, 2]), 0, 1, 3)).toBe(5);
    expect(pageOption(opts(20, [19]), 17, 1, 5)).toBe(18);
  });
  it("from no option: the first or the last enabled one", () => {
    expect(pageOption(opts(5, [0]), -1, 1, 3)).toBe(1);
    expect(pageOption(opts(5, [4]), -1, -1, 3)).toBe(3);
  });
});
