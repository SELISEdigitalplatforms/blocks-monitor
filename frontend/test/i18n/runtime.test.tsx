// t(): English by default, the bundled de-CH files, the UILM texts winning over them, {params}, never a key on screen;
// the switch (html lang, storage, the UILM load, the profile preference) and its markup in every place it sits.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
});
const doc = { documentElement: { lang: "" } };
vi.stubGlobal("document", doc);

const auth = vi.hoisted(() => ({ calls: [] as { path: string; payload: unknown }[], status: 200 }));
vi.mock("../../src/blocks/http", () => ({
  authCall: async (_method: string, path: string, payload: unknown) => { auth.calls.push({ path, payload }); return { status: auth.status, body: {} }; },
}));

import { bundledDicts, bundledFileOf, cultureOf, getCulture, resetI18nForTests, setCulture, setRemoteTexts, t } from "../../src/i18n";
import { LanguagePreference, LanguageSwitcher } from "../../src/i18n/LanguageSwitcher";
import { PENDING_KEY, applyProfileLanguage, chooseLanguage, forgetSignedIn, loadRemoteTexts, resetLanguageState, startI18n } from "../../src/i18n/language";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  resetI18nForTests();
  resetLanguageState();
  store.clear();
  auth.calls = [];
  auth.status = 200;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(answer(503, { ok: false }));
});
afterEach(() => { resetI18nForTests(); });

describe("t()", () => {
  it("answers the English of the call by default, with its {params}", () => {
    expect(getCulture()).toBe("en");
    expect(t("common.language.label", "Language")).toBe("Language");
    expect(t("platform.plans.count", "{count} plans for {name}", { count: 3, name: "Acme" })).toBe("3 plans for Acme");
    // a param the call does not give stays visible as written, never "undefined"
    expect(t("platform.plans.count", "{count} plans for {name}", { count: 3 })).toBe("3 plans for {name}");
  });

  it("answers the bundled de-CH text in German, the module taken from the file name (part files too)", () => {
    setCulture("de-CH");
    expect(t("common.language.label", "Language")).toBe("Sprache");
    expect(bundledFileOf("./locales/platform.de-CH.json")).toEqual({ module: "platform", culture: "de-CH" });
    expect(bundledFileOf("./locales/common-language.de-CH.json")).toEqual({ module: "common", culture: "de-CH" });
    expect(bundledFileOf("./locales/readme.md")).toBeNull();
    expect(bundledDicts({ "./locales/platform.de-CH.json": { plans: { saveButton: "Speichern" } } })).toEqual({ "de-CH": { "platform.plans.saveButton": "Speichern" } });
  });

  it("lets the UILM texts win over the bundled ones and falls back to English for a key nobody translated", () => {
    setCulture("de-CH");
    setRemoteTexts("de-CH", { "common.language.label": "Sprache (UILM)", "common.x.greet": "Hallo {name}" });
    expect(t("common.language.label", "Language")).toBe("Sprache (UILM)");
    expect(t("common.x.greet", "Hello {name}", { name: "Mia" })).toBe("Hallo Mia");
    // never a key: no text in German → the English of the call
    expect(t("common.x.unknown", "Not translated yet")).toBe("Not translated yet");
    // an empty UILM text does not blank the screen
    setRemoteTexts("de-CH", { "common.x.blank": "  " });
    expect(t("common.x.blank", "Shown in English")).toBe("Shown in English");
  });

  it("switches back to English at once, keeps the choice and sets the html lang", () => {
    setCulture("de-CH");
    expect(store.get("mf.culture")).toBe("de-CH");
    expect(doc.documentElement.lang).toBe("de-CH");
    setCulture("en");
    expect(t("common.language.label", "Language")).toBe("Language");
    expect(store.get("mf.culture")).toBe("en");
    expect(doc.documentElement.lang).toBe("en");
  });

  it("maps outside language codes to its own", () => {
    expect(cultureOf("de-CH")).toBe("de-CH");
    expect(cultureOf("de-DE")).toBe("de-CH");
    expect(cultureOf("de")).toBe("de-CH");
    expect(cultureOf("en-US")).toBe("en");
    expect(cultureOf("fr-CH")).toBeNull();
    expect(cultureOf(undefined)).toBeNull();
  });
});

describe("texts from Blocks UILM", () => {
  it("loads a language's texts once from the public route, without credentials", async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, data: { culture: "de-CH", texts: { "shell.top.search": "Suchen", "shell.top.bad": 4 } } }));
    expect(await loadRemoteTexts("de-CH")).toBe(true);
    expect(await loadRemoteTexts("de-CH")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/public/i18n/de-CH");
    expect(init.credentials).toBe("omit");
    setCulture("de-CH");
    expect(t("shell.top.search", "Search")).toBe("Suchen");
    expect(t("shell.top.bad", "Not a string")).toBe("Not a string");
  });

  it("never asks for English (the code holds it) and retries a failed load on the next switch", async () => {
    expect(await loadRemoteTexts("en")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(answer(503, { ok: false }));
    expect(await loadRemoteTexts("de-CH")).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await loadRemoteTexts("de-CH")).toBe(false);
    fetchMock.mockResolvedValueOnce(answer(200, { ok: true, data: { texts: {} } }));
    expect(await loadRemoteTexts("de-CH")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("starts with the html lang and the texts of the stored language", async () => {
    setCulture("de-CH");
    doc.documentElement.lang = "";
    startI18n();
    expect(doc.documentElement.lang).toBe("de-CH");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/public/i18n/de-CH", expect.anything()));
  });
});

describe("the language preference", () => {
  it("a choice while signed out is kept in the browser and goes to the profile at the next sign-in", async () => {
    await chooseLanguage("de-CH");
    expect(getCulture()).toBe("de-CH");
    expect(store.get(PENDING_KEY)).toBe("1");
    expect(auth.calls).toEqual([]);
    // the profile says English, but the person just chose German here: German stays and is saved
    applyProfileLanguage("en");
    expect(getCulture()).toBe("de-CH");
    expect(store.has(PENDING_KEY)).toBe(false);
    expect(auth.calls).toEqual([{ path: "language", payload: { language: "de-CH" } }]);
  });

  it("the profile's language applies at sign-in when nothing was chosen here", () => {
    applyProfileLanguage("de-CH");
    expect(getCulture()).toBe("de-CH");
    expect(auth.calls).toEqual([]);
  });

  it("a profile without a language gets the one in use (when not the default)", () => {
    setCulture("de-CH");
    applyProfileLanguage(null);
    expect(auth.calls).toEqual([{ path: "language", payload: { language: "de-CH" } }]);
    auth.calls = [];
    forgetSignedIn();
    resetI18nForTests();
    applyProfileLanguage(null);
    expect(auth.calls).toEqual([]);
  });

  it("a choice while signed in is saved to the profile at once", async () => {
    applyProfileLanguage("en");
    await chooseLanguage("de-CH");
    expect(auth.calls).toEqual([{ path: "language", payload: { language: "de-CH" } }]);
    expect(store.has(PENDING_KEY)).toBe(false);
    forgetSignedIn();
    await chooseLanguage("en");
    expect(auth.calls).toHaveLength(1);
    expect(store.get(PENDING_KEY)).toBe("1");
  });
});

describe("the switch", () => {
  const html = (el: JSX.Element) => renderToStaticMarkup(el);

  it("shows EN and DE in one group, the language in use pressed, each named in its own language", () => {
    const out = html(<LanguageSwitcher />);
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Language"');
    expect(out).toMatch(/<button[^>]*lang="en"[^>]*aria-pressed="true"[^>]*aria-label="English"[^>]*>EN<\/button>/);
    expect(out).toMatch(/<button[^>]*lang="de-CH"[^>]*aria-pressed="false"[^>]*aria-label="Deutsch \(Schweiz\)"[^>]*>DE<\/button>/);
    // the top bar's pill height
    expect(out).toContain("h-12");
  });

  it("marks German and labels itself in German once German is chosen", () => {
    setCulture("de-CH");
    const out = html(<LanguageSwitcher tone="auth" />);
    expect(out).toContain('aria-label="Sprache"');
    expect(out).toMatch(/lang="de-CH"[^>]*aria-pressed="true"/);
    expect(out).toContain("h-9");
  });

  it("has its row in Settings → You", () => {
    const out = html(<LanguagePreference />);
    expect(out).toContain("Language");
    expect(out).toContain("on every device you sign in on");
    setCulture("de-CH");
    expect(html(<LanguagePreference />)).toContain("auf jedem Gerät");
  });
});
