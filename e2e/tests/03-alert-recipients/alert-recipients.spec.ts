import type { Request } from "@playwright/test";
import { test, expect } from "../../support/test-base";
import {
  AlertRecipientsPage,
  MONITOR_DETAILS_URL,
  alertRecipientsMenuLink,
  createMonitorViaUi,
  deleteMonitorViaUi,
  detailsRecipientChips,
  e2eEmail,
  e2eRunId,
  openMonitorDetails,
} from "../../support/alert-recipients-helpers";

/**
 * Alert recipients page (SELISEdigitalplatforms/blocks-monitor#256, spec §10).
 *
 * Runs in the shared suite project after the `monitor` project. Fixtures are created through the
 * UI, and every monitor and person this run adds is removed again in `finally`. The project
 * already holds monitors from spec 02, so "All monitors (N)" uses the count the page reports, and
 * the expected "Added to"/"Removed from" counts come from what the server reported for the save:
 * a monitor in the shared project that already has 10 recipients is skipped as full.
 * Setup first removes "All monitors" people that earlier runs of this spec left behind.
 *
 * Covered elsewhere (approved #256 Q16): C5 (read-only identity) and H18/H19 + step 9 (Worker
 * reconciliation after a blocks-release deploy) by the backend tests; H17 by the perf script.
 */

test.describe("Alert recipients - page workflow", () => {
  test.setTimeout(600_000);

  test("manages alert recipients for all or selected monitors", async ({ page }, testInfo) => {
    const runId = e2eRunId();
    const monitorA = `e2e-alert-a-${runId}`;
    const monitorB = `e2e-alert-b-${runId}`;
    const monitorHb = `e2e-alert-hb-${runId}`;
    const monitorC = `e2e-alert-c-${runId}`;
    const opsEmail = e2eEmail("ops", runId);
    const allEmail = e2eEmail("all", runId);
    const selEmail = e2eEmail("sel", runId);
    const bad = "bad@";

    const recipients = new AlertRecipientsPage(page);
    const createdMonitors: { name: string; url: string }[] = [];
    const monitorUrl = (name: string) => {
      const created = createdMonitors.find((monitor) => monitor.name === name);
      if (!created) throw new Error(`Fixture monitor "${name}" was not created.`);
      return created.url;
    };
    // From the "All monitors" save: the monitor count the dialog reported, and how many of those
    // the person is on (the rest were full).
    let allCount = 0;
    let allOn = 0;

    try {
      await test.step("Setup — remove 'All monitors' people left by earlier failed runs", async () => {
        await recipients.open();
        // Only this spec's own addresses, from runs that started over 30 minutes ago (a run times
        // out after 10), so a run still in progress is never touched.
        const removed = await recipients.removeLeftoverPeople(["all"], 30 * 60_000);
        if (removed.length > 0) {
          testInfo.annotations.push({
            type: "note",
            description: `Removed ${removed.length} leftover "All monitors" people: ${removed.join(", ")}`,
          });
        }
      });

      await test.step("Fixtures — create e2e-alert-a, -b (HTTP) and -hb (Heartbeat) in the UI", async () => {
        for (const [name, kind] of [
          [monitorA, "HTTP Check"],
          [monitorB, "HTTP Check"],
          [monitorHb, "Heartbeat"],
        ] as const) {
          const url = await createMonitorViaUi(page, { name, kind });
          createdMonitors.push({ name, url });
        }
      });

      await test.step("H1, H2 — side menu opens the page with title, subtitle and actions", async () => {
        const link = alertRecipientsMenuLink(page);
        await expect(link).toBeVisible();
        await link.click();
        await recipients.waitForLoaded();
        await expect(page).toHaveURL(/\/app\/[^/]+\/alert-recipients\/?$/);
        await expect(
          page.getByText(
            /^People who get an email when a monitor in .+ goes down or comes back up\.$/,
          ),
        ).toBeVisible();
        await expect(recipients.addButton).toBeEnabled();
        await expect(recipients.search).toBeVisible();
        await expect(
          page.getByText(/^Alerts are sent to the emails saved on each monitor\./),
        ).toBeVisible();
      });

      await test.step("Fixture — seed e2e-alert-a with an ops recipient (Selected)", async () => {
        await recipients.addToSelectedMonitors(opsEmail, [monitorA]);
        await expect(
          recipients.table.getByRole("columnheader", { name: "Recipient" }),
        ).toBeVisible();
        await expect(
          recipients.table.getByRole("columnheader", { name: "Gets alerts for" }),
        ).toBeVisible();
        await expect(recipients.table.getByRole("columnheader", { name: "Actions" })).toBeVisible();
        await expect(recipients.editButton(opsEmail)).toBeVisible();
        await expect(recipients.removeButton(opsEmail)).toBeVisible();
        await recipients.expectSelectedMonitorsRow(opsEmail, [monitorA], [monitorB, monitorHb]);
      });

      await test.step("H4, H3, H16, H13 — add a person to All monitors", async () => {
        // Typed with spaces and capitals; stored and shown trimmed and lower-case (H16).
        const saved = await recipients.addToAllMonitors(allEmail, `  ${allEmail.toUpperCase()} `);
        allCount = saved.count;
        allOn = saved.added;
        expect(allCount).toBeGreaterThanOrEqual(3);
        // The steps below need the person on this run's fixtures, which start with only the
        // project's other "All monitors" people (and ops on a), so they have room.
        expect(allOn).toBeGreaterThanOrEqual(3);
        await recipients.expectAllMonitorsChoiceRow(allEmail, allCount, allOn);
        await expect(page.getByText(allEmail.toUpperCase(), { exact: true })).toHaveCount(0);
        // Every monitor now emails someone: the person, or the 10 recipients that made it full (H13).
        await expect(recipients.coverageBadge).toHaveText(
          allCount === 1
            ? "The 1 monitor emails someone"
            : `All ${allCount} monitors email someone`,
        );
      });

      await test.step("H12 — heartbeat details show the person read-only and link to the page", async () => {
        await openMonitorDetails(page, monitorUrl(monitorHb), monitorHb);
        await expect(page.getByText("Notification recipients", { exact: true })).toBeVisible();
        await expect(detailsRecipientChips(page).filter({ hasText: allEmail })).toHaveCount(1, {
          timeout: 30_000,
        });
        await expect(page.getByRole("button", { name: "Notification Settings" })).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: /Add email|Edit notification recipients/ }),
        ).toHaveCount(0);
        await expect(page.getByPlaceholder("Enter email address")).toHaveCount(0);
        await page.getByRole("link", { name: "Open Alert recipients" }).click();
        await recipients.waitForLoaded();
      });

      await test.step("H5, H14 — add a non-member address for Selected [b]", async () => {
        const suggestions = page.waitForResponse(
          (response) => response.url().includes("/GetAlertRecipientSuggestions"),
          { timeout: 30_000 },
        );
        await recipients.openAddDialog();

        // H14: when the project has members who are not recipients yet, picking one fills Email.
        const response = await suggestions.catch(() => null);
        const body = response?.ok() ? await response.json().catch(() => null) : null;
        const members: string[] = body?.isSuccess ? (body.data?.memberEmails ?? []) : [];
        if (members.length > 0) {
          await recipients.dialog.getByRole("button", { name: members[0], exact: true }).click();
          await expect(recipients.emailInput).toHaveValue(members[0]);
        } else {
          testInfo.annotations.push({
            type: "note",
            description: "H14 suggestion click skipped: the project lists no member suggestions.",
          });
        }

        // An address that belongs to no project member is accepted the same way.
        await recipients.emailInput.fill(selEmail);
        await recipients.chooseSelectedMonitors([monitorB]);
        await expect(recipients.submitButton).toHaveText("Add to 1 monitor");
        await recipients.submitAndExpectToast(/^Added to 1 monitor\./);
        await recipients.expectSelectedMonitorsRow(selEmail, [monitorB], [monitorA, monitorHb]);
      });

      await test.step("H6 — edit the All-monitors person down to Selected [a]", async () => {
        await recipients.openEditDialog(allEmail);
        await expect(recipients.emailInput).toHaveAttribute("readonly", "");
        await expect(recipients.allMonitorsRadio).toBeChecked();
        await recipients.chooseSelectedMonitors([monitorA]);
        await expect(recipients.submitButton).toHaveText("Save");
        // Removed from every monitor the person was on except a.
        const narrowed = await recipients.submitAndReadSummary();
        expect(narrowed).toEqual({ added: 0, removed: allOn - 1, skippedFull: 0 });
        await recipients.expectSelectedMonitorsRow(allEmail, [monitorA], [monitorB, monitorHb]);
      });

      await test.step("H7, C21 — Remove shows the notice with Undo and removes the row", async () => {
        await recipients.removeButton(selEmail).click();
        await expect(recipients.notice).toContainText(
          `${selEmail} removed from 1 monitor. They no longer get alert emails.`,
          { timeout: 30_000 },
        );
        await expect(recipients.row(selEmail)).toHaveCount(0, { timeout: 30_000 });
      });

      await test.step("H8 — Undo restores the previous Selected assignment", async () => {
        await recipients.notice.getByRole("button", { name: "Undo" }).click();
        await expect(page.getByText(/^Added to 1 monitor\./).first()).toBeVisible({
          timeout: 30_000,
        });
        await expect(recipients.notice).toHaveCount(0);
        await recipients.expectSelectedMonitorsRow(selEmail, [monitorB], [monitorA, monitorHb]);
      });

      await test.step("H9 — a monitor created after setting All monitors gets the person", async () => {
        await recipients.openEditDialog(allEmail);
        await recipients.allMonitorsRadio.check();
        allCount = await recipients.reportedMonitorCount();
        await expect(recipients.submitButton).toHaveText("Save");
        // Added to every monitor except a (already there) and the ones full right now.
        const widened = await recipients.submitAndReadSummary();
        expect(widened.removed).toBe(0);
        expect(widened.added + widened.skippedFull).toBe(allCount - 1);
        allOn = widened.added + 1;
        await recipients.expectAllMonitorsChoiceRow(allEmail, allCount, allOn);

        const url = await createMonitorViaUi(page, { name: monitorC, kind: "HTTP Check" });
        createdMonitors.push({ name: monitorC, url });
        await expect(page).toHaveURL(MONITOR_DETAILS_URL);
        await expect(detailsRecipientChips(page).filter({ hasText: allEmail })).toHaveCount(1, {
          timeout: 30_000,
        });
        // Only "All monitors" people are copied onto a new monitor.
        await expect(detailsRecipientChips(page).filter({ hasText: selEmail })).toHaveCount(0);
        await expect(detailsRecipientChips(page).filter({ hasText: opsEmail })).toHaveCount(0);

        await recipients.open();
        await recipients.expectAllMonitorsChoiceRow(allEmail, allCount + 1, allOn + 1);
      });

      await test.step("C1, C2, C18, C21 — invalid, empty and duplicate input keep Save disabled", async () => {
        await recipients.openAddDialog();

        // C1: invalid email, reported on blur.
        await recipients.emailInput.fill(bad);
        await recipients.emailInput.blur();
        await expect(
          recipients.dialog.getByText("Enter a valid email address.", { exact: true }),
        ).toBeVisible();
        await expect(recipients.emailInput).toHaveAttribute("aria-invalid", "true");
        await expect(recipients.submitButton).toBeDisabled();

        // C2: Selected monitors with nothing ticked.
        await recipients.emailInput.fill(e2eEmail("none", runId));
        await recipients.chooseSelectedMonitors([]);
        await expect(recipients.submitButton).toHaveText("Add to 0 monitors");
        await expect(recipients.submitButton).toBeDisabled();

        // C18: the address already gets alerts (typed with capitals, so it is normalized first).
        await recipients.emailInput.fill(opsEmail.toUpperCase());
        await expect(
          recipients.dialog.getByText(
            "This person already gets alerts. Use Edit to change their monitors.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(recipients.submitButton).toBeDisabled();

        // C21: Escape closes the dialog without saving.
        await page.keyboard.press("Escape");
        await expect(recipients.dialog).toBeHidden();
        await expect(recipients.row(e2eEmail("none", runId))).toHaveCount(0);
      });

      await test.step("H15 — search filters rows by email or monitor name, without a request", async () => {
        const listRequests: Request[] = [];
        const onRequest = (request: Request) => {
          if (request.url().includes("/GetAlertRecipients?")) listRequests.push(request);
        };
        page.on("request", onRequest);
        try {
          // b's name: sel (Selected [b]) and all (All monitors) match; ops (Selected [a]) does not.
          await recipients.search.fill(monitorB.toUpperCase());
          await expect(recipients.row(selEmail)).toBeVisible();
          await expect(recipients.row(allEmail)).toBeVisible();
          await expect(recipients.row(opsEmail)).toHaveCount(0);

          await recipients.search.fill(opsEmail);
          await expect(recipients.row(opsEmail)).toBeVisible();
          await expect(recipients.row(selEmail)).toHaveCount(0);
          await expect(recipients.row(allEmail)).toHaveCount(0);

          await recipients.search.fill(`no-match-${runId}`);
          await expect(
            page.getByText("No people or monitors match.", { exact: true }),
          ).toBeVisible();

          await recipients.search.fill("");
          await expect(recipients.row(opsEmail)).toBeVisible();
          expect(listRequests, "search must filter in the browser").toHaveLength(0);
        } finally {
          page.off("request", onRequest);
        }
      });

      await test.step("C22 — 390×844 dark: no page-level horizontal scroll; screenshot", async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ colorScheme: "dark" });
        await page.reload({ waitUntil: "domcontentloaded" });
        await recipients.waitForLoaded();

        const isDark = await expect
          .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")), {
            timeout: 10_000,
          })
          .toBe(true)
          .then(() => true)
          .catch(() => false);
        if (!isDark) {
          testInfo.annotations.push({
            type: "note",
            description:
              "C22: the account's saved theme overrides the system scheme; screenshot is light.",
          });
        }

        await expect(recipients.row(opsEmail)).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            ),
          )
          .toBe(true);
        // The table keeps its 760 px minimum and scrolls inside its card instead.
        await expect
          .poll(() =>
            recipients.table.evaluate((table) => {
              for (let el = table.parentElement; el && el !== document.body;) {
                const { overflowX } = getComputedStyle(el);
                const scrolls = overflowX === "auto" || overflowX === "scroll";
                if (scrolls && el.scrollWidth > el.clientWidth) return true;
                el = el.parentElement;
              }
              return false;
            }),
          )
          .toBe(true);

        await testInfo.attach("alert-recipients-390x844-dark", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });

        await page.emulateMedia({ colorScheme: "light" });
        await page.setViewportSize({ width: 1280, height: 720 });
      });
    } finally {
      await test.step("Cleanup — remove this run's people, then its monitors", async () => {
        await page.setViewportSize({ width: 1280, height: 720 }).catch(() => null);
        try {
          // People first: removing the All-monitors person also deletes the stored choice, so
          // later monitors in the shared project do not get them.
          await recipients.open();
          for (const email of [allEmail, selEmail, opsEmail, e2eEmail("none", runId)]) {
            await recipients.removeIfListed(email);
          }
        } catch (error) {
          console.warn(
            `[e2e] Alert recipient cleanup failed; remove ${allEmail}, ${selEmail} and ` +
              `${opsEmail} on the Alert recipients page. ${String(error)}`,
          );
        }
        for (const monitor of createdMonitors) {
          await deleteMonitorViaUi(page, monitor.url, monitor.name);
        }
      });
    }
  });
});
