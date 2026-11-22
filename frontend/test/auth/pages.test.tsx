// The sign-up, confirmation and reset screens as they render in each state: the form (fields, live policy, hidden field,
// terms, the plan from the pricing page), invite-only, check-your-email (sent or refused by the mail service), the link
// states (checking, confirmed with the first sign-in, expired with a new link, invalid, already used), the reset request
// page, and words the product never uses.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SignUpView } from "../../src/components/signin/SignUpView";
import { VerifyEmailView } from "../../src/components/signin/VerifyEmailView";
import { ForgotPasswordView } from "../../src/components/signin/ForgotPasswordView";
import { PasswordStrength } from "../../src/components/signin/PasswordStrength";
import { planNext, authHref } from "../../src/components/signin/auth";

const html = (el: ReactElement, url = "/sign-up") => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const OPEN = { state: "open" as const, ticket: "1762682400000.x", issuedAt: 0 };
const NEVER = /\b(demo|mock|sample|fake|simulated|prototype|magic)\b/i;
const TOKEN = "signup000001.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

describe("sign-up page", () => {
  it("shows the form: name, work email, password with the policy, optional organization, terms; the hidden field stays hidden", () => {
    const m = html(<SignUpView leaving={false} initialForm={OPEN} />);
    for (const id of ["su-name", "su-email", "su-password", "su-organization", "su-terms", "su-website"]) expect(m).toContain(`id="${id}"`);
    const t = text(m);
    expect(t).toContain("Create your account");
    expect(t).toContain("At least 12 characters, or a phrase of a few words");
    expect(t).toContain("Not a common or easy-to-guess password");
    expect(t).toContain("Not your email address");
    expect(t).toContain("Organization name (optional)");
    expect(t).toMatch(/I accept the terms of service and the privacy policy/);
    expect(t).toContain("Start on the Free plan");
    expect(m).toMatch(/aria-hidden="true" class="absolute -left-\[10000px\][^"]*"><label for="su-website"/);
    expect(m).toMatch(/id="su-website"[^>]*tabindex="-1"/);
    expect(t).not.toMatch(NEVER);
  });

  it("names the plan picked on the pricing page and keeps it on the way to sign-in", () => {
    const m = html(<SignUpView leaving={false} initialForm={OPEN} />, "/sign-up?plan=speed");
    expect(text(m)).toContain("You picked the Speed plan");
    expect(m).toContain('href="/sign-in?plan=speed"');
    expect(planNext("speed")).toBe("/billing/checkout?plan=speed");
    expect(planNext("free")).toBeNull();
    expect(authHref("signup", { plan: "classic", next: "/projects" })).toBe("/sign-up?next=%2Fprojects&plan=classic");
  });

  it("explains invite-only instead of the form", () => {
    const t = text(html(<SignUpView leaving={false} initialForm={{ state: "invite-only" }} />));
    expect(t).toContain("MADP Factory is invite-only.");
    expect(t).not.toContain("Create account");
  });

  it("says check your email, or plainly that the mail service refused, with a new link either way", () => {
    const sent = text(html(<SignUpView leaving={false} initialForm={OPEN} initialDone={{ email: "ada@example.org", mail: "sent" }} />));
    expect(sent).toContain("Check your email");
    expect(sent).toContain("ada@example.org");
    expect(sent).toContain("24 hours");
    expect(sent).toContain("Send a new link");
    const refused = text(html(<SignUpView leaving={false} initialForm={OPEN} initialDone={{ email: "ada@example.org", mail: "not-sent" }} />));
    expect(refused).toContain("We couldn't send the email right now");
    expect(refused).not.toContain("We sent a link");
  });

  it("is loading before the server answers", () => {
    expect(text(html(<SignUpView leaving={false} />))).toContain("One moment");
  });
});

describe("confirmation link page", () => {
  const page = (initial?: Parameters<typeof VerifyEmailView>[0]["initial"], token = TOKEN) => text(html(<VerifyEmailView token={token} leaving={false} initial={initial} />, "/activate"));

  it("checks the link first", () => {
    expect(page()).toContain("Checking your link");
  });

  it("confirmed: the first sign-in with the address filled in", () => {
    const m = html(<VerifyEmailView token={TOKEN} leaving={false} initial={{ status: "verified", email: "ada@example.org", plan: "classic", firstName: "Ada" }} />, "/activate");
    expect(text(m)).toContain("Welcome, Ada");
    expect(m).toMatch(/id="vf-email"[^>]*value="ada@example.org"[^>]*readOnly|id="vf-email"[^>]*readOnly[^>]*value="ada@example.org"/i);
    expect(text(m)).toContain("Sign in and continue");
    expect(m).toContain('href="/forgot-password?email=ada%40example.org"');
  });

  it("expired: offers a new link; invalid: points to the newest e-mail; used: sign in", () => {
    const expired = page({ status: "expired" });
    expect(expired).toContain("This link has expired");
    expect(expired).toContain("Send a new link");
    const invalid = page({ status: "invalid" });
    expect(invalid).toContain("This link isn't valid");
    expect(invalid).not.toContain("Send a new link");
    expect(page({ status: "used" })).toContain("already confirmed");
    expect(page(undefined, "garbage")).toContain("This link isn't valid");
  });
});

describe("reset request page and the policy checklist", () => {
  it("asks for the work email and says the link works once, for one hour", () => {
    const t = text(html(<ForgotPasswordView />, "/forgot-password?email=ada%40example.org"));
    expect(t).toContain("Reset your password");
    expect(t).toContain("one hour");
    expect(t).toContain("Send reset link");
  });

  it("marks each rule met or not as the password is typed", () => {
    const none = text(html(<PasswordStrength password="" id="p" />));
    expect(none.match(/not met/g)).toHaveLength(3);
    const all = text(html(<PasswordStrength password="violet harbor lantern" id="p" email="ada@example.org" />));
    expect(all).not.toContain("not met");
  });
});
