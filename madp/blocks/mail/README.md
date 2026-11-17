# Blocks Mail templates

MADP Factory sends workspace invitations, access requests, and build failure alerts through the project's default Blocks Mail configuration.

| Notification kind | Purpose (template name) | Subject placeholders | Body placeholders |
|---|---|---|---|
| `invited` | `mf-workspace-added` | `workspaceName` | `actorName`, `workspaceName`, `roleName`, `link` |
| `access-requested` | `mf-access-requested` | `email` | `actorName`, `email`, `workspaceName`, `link` |
| `job.failed` (build jobs only) | `mf-build-failed` | `projectName` | `projectName`, `jobKind`, `failure`, `failedAt`, `link` |
| (public sign-up, sent by the server) | `mf-verify-email` | none | `name`, `link`, `validFor` |
| (public sign-up, sent by the server) | `mf-account-exists` | none | `signInLink`, `resetLink` |
| (password reset, sent by the server) | `mf-password-changed` | none | `name`, `changedAt`, `resetLink` |

The source of truth is `src/domain/notificationEmail.ts`; the Shape node of `blocks/logic/workflows/mf-doorbell.json` is a literal copy, and tests keep both and these files equal.

Each template is a `<purpose>.en-US.json` (name, language, subject, `bodyFile`) plus the HTML body. Bodies are plain tables with inline styles, no images, no remote resources, one link (`{{link}}`).

## Rules

- **IAM's own emails are never touched.** Account activation and password reset use IAM's templates. `scripts/logic-apply.mjs` refuses any template name that does not start with `mf-`.
- **en-US only.** Blocks Mail has no language fallback, so the workflow always sends `en-US`. Other languages come later with UILM.
- **Placeholders** are `{{key}}` replacement only. Every placeholder must be supplied or the send is refused. Body values are HTML-encoded by Blocks Mail; subject values are not, so the workflow strips control characters and caps them.
- **Prerequisite (D6):** `blocks mail config list --json` must show an outbound default configuration. The From address and provider are that configuration.
- **SES delivery tracking and inbound mailboxes stay OFF** (MF-B09).
- **EmailStatus ends at `pending`.** A workflow has no run-as identity (SeroBook N-6) and Blocks Mail reports no delivery outcome without SES tracking (MF-B09), so nothing can safely record `sent` or `failed`. `none` = no email; `pending` = handed to the mail workflow. This is a register candidate.
- Approval notifications (`approval.requested`, `approval.decided`) have no template: D6 says in-app only.

Apply and verify with `node scripts/logic-apply.mjs` (dry run), `--yes`, `--verify`. Only the coordinator runs it.

## Build failure alerts

The Blocks worker resolves recipients from the project's ReaderIds intersected with active Membership rows in that project's workspace. This includes owners who retain project access and collaborators; IAM membership alone never grants project access. Email addresses and active-user status are read from Factory IAM using the service client's `iam.users.get`.

Apply the new `mf-build-failed` template and the updated doorbell workflow with the Blocks CLI, dry-run first. The template JSON here is a local manifest; pass its HTML using `mail template save --template-body`, not the manifest as an API request body. Resolve the workflow's `__API_URL__`, `__TENANT_KEY__`, and `__APP_URL__` placeholders for the target environment before import and publish. Preserve the existing notification channel configuration.

After deploying the worker code and publishing the workflow/template, set `MF_BUILD_FAILURE_EMAIL_SINCE` to the rollout time in ISO UTC form (for example `2026-11-08T12:00:00.000Z`) on each build worker and restart it. Absent this setting, hosted failure emails remain disabled. The cutoff prevents old failures from being mailed during rollout; preserve it across restarts to recover missed alerts.

Normal failures, change-build failures, timeouts, and exhausted attempts are covered. Notification RequestKey deduplicates each failure occurrence and recipient. Every recipient gets the in-app alert (the bell); the e-mail goes with it only when the address can be read. When it cannot (the service role may not read IAM users and gets 403, the IAM read fails, the user has no usable address, or another recipient has the same address) the alert is written in-app only (EmailStatus `none`, no `emailTo`) and the worker logs it once. A failure whose alerts are all written is settled and not read again by that worker; failed reads or inserts are retried by reconciliation every minute. Local development uses active Account emails and the existing mail drop. The production worker uses IAM only.

Reconciliation retries notification creation, not delivery after a successful workflow handoff. EmailStatus remains `pending`; use workflow runs and Blocks Mail history to diagnose sending failures. Exactly-once email delivery is not guaranteed by the platform. A test email must be approved separately with its intended recipient.

## Sign-up, verification and password-changed e-mails

The public sign-up (`server/fnHost/signup.ts`, routes in `server/fnHost/authRoutes.ts`) sends three e-mails itself, with
the service identity and `mail.send` (purpose = template name, language `en-US`), not through the doorbell workflow:
the link secret must never be written into a Notification row.

- `mf-verify-email`: the confirmation link `/activate?token=<sign-up id>.<secret>`, single use, valid 24 hours. Only the
  secret's SHA-256 is stored (SignUp.TokenHash); a new link replaces the old one.
- `mf-account-exists`: sent instead when someone signs up with an address that already has an account, so the visitor's
  answer is the same either way (no account enumeration).
- `mf-password-changed`: after a completed password reset, when IAM names the account in its answer.

These bodies carry a button and the same address as plain text below it (a client that blocks buttons still has the link).
Password reset and invitation e-mails stay IAM's own (rule above).

Prerequisites on each environment (the owner's or the coordinator's step, dry-run first):

1. `blocks mail config list --json` shows an outbound default configuration with the From address the product uses.
2. The three templates are saved (`mail template save`, the HTML as `--template-body`).
3. The service role (mf-service) may create, read and activate IAM users and send mail. Without these rights the sign-up
   answers "MADP Factory can't be reached right now" (user create refused) or "We couldn't send the email" (mail refused);
   both are logged as one `[auth]` line without addresses or tokens. Nothing pretends an e-mail was sent.
4. IAM tenant self-signup (`blocks iam signup-settings`) stays OFF: the server's route is the only way to create an account,
   with its rate limits, form checks and the `auth.signup` setting.
