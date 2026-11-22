# Local factory data (seed)

`npm --prefix frontend run reset` wipes the local store and runs `seedAll` (seed/index.ts). The seed writes three
client workspaces and ten projects covering every step of the journey. Each project has its business material, real
files, engine jobs, tickets, approvals, releases, wiki, chats, notifications and audit log.

All dates are relative to the moment of the reset. Day 0 is today if it is a working day after 07:30; otherwise day 0
is the previous working day. "-3d" means three working days before day 0. Running the reset twice at the same moment
gives the same data.

Test: `cd frontend && npx --prefix .. vitest run --config seed/vitest.config.ts`. It seeds into the in-memory gateway
with the hosted rules and checks that:
- every row passes the schemas, validations and unique indexes;
- every id resolves;
- the app's own row mappers can read every row;
- notifications match the catalogue;
- each project is consistent with its step;
- no date is in the future and no wording reads as demo or test data;
- the output is deterministic.

## Accounts

Every account signs in with the password **`Factory2026`**.

| Person | E-mail | Access |
| --- | --- | --- |
| Daniel Ammann | daniel.ammann@selisegroup.com | **Platform super admin** (all workspaces, Admin) |
| Mira Schoch | mira.schoch@selisegroup.com | Platform role *Support desk*: people, workspaces and audit log, read-only |
| Sandra Keller | sandra.keller@selisegroup.com | Alpine Fresh: Workspace admin |
| Luca Bernasconi | luca.bernasconi@selisegroup.com | Alpine Fresh: Workspace admin · Talwerk: Member |
| Elena Frei | elena.frei@selisegroup.com | Alpine Fresh: Member · Lindenhof: Member |
| Marco Huber | marco.huber@selisegroup.com | Alpine Fresh: Member · Lindenhof: invited (joins on next sign-in) |
| Anna Rossi | anna.rossi@studio-rossi.ch | Alpine Fresh: Member (freelance designer, allowed as an e-mail exception) |
| Jonas Meier | jonas.meier@alpine-fresh.ch | Alpine Fresh: Viewer (client) |
| Petra Wyss | petra.wyss@alpine-fresh.ch | Alpine Fresh: *Client reviewer* (custom role) |
| Reto Arnold | reto.arnold@selisegroup.com | Lindenhof: Workspace admin |
| Simon Gerber | simon.gerber@selisegroup.com | Lindenhof: Member |
| Claudia Imhof | claudia.imhof@lindenhof-treuhand.ch | Lindenhof: Viewer (client) |
| Beat Zimmermann | beat.zimmermann@lindenhof-treuhand.ch | Lindenhof: *Client IT* (custom role) |
| Katrin Vogel | katrin.vogel@talwerk-fluid.de | Talwerk: Workspace admin |
| Stefan Brandt | stefan.brandt@talwerk-fluid.de | Talwerk: Workspace admin (architect approver) |
| Aylin Demir | aylin.demir@talwerk-fluid.de | Talwerk: *Product owner* (custom role) |
| Jan Kowalski | jan.kowalski@talwerk-fluid.de | Talwerk: *Release manager* (custom role, QA approver, promotes) |
| Florian Weber | florian.weber@talwerk-fluid.de | Talwerk: Viewer (security approver) |
| Martina Lang | martina.lang@talwerk-fluid.de | Talwerk: Viewer |
| Oliver Schmitt | oliver.schmitt@talwerk-fluid.de | Talwerk: suspended; account deactivated by the super admin (the app refuses him) |

Two people were invited but have no account yet. Both show under Admin → Access requests:
- nicole.graf@alpine-fresh.ch (viewer at Alpine Fresh);
- lena.hoffmann@talwerk-fluid.de (member at Talwerk).

The allowed e-mail domains are selisegroup.com, alpine-fresh.ch, lindenhof-treuhand.ch and talwerk-fluid.de. The one
exception is anna.rossi@studio-rossi.ch.

## Projects

| Project | Workspace | Type | Step | What it shows |
| --- | --- | --- | --- | --- |
| B2B Order Portal | Alpine Fresh | greenfield (repo not set up) | Scope, v1 draft | Below |
| Driver Delivery App | Alpine Fresh | greenfield, `alpine-fresh/driver-delivery-app` | Build | Below |
| Supplier Quality Portal | Alpine Fresh | greenfield | Business | Below |
| Client Document Portal | Lindenhof | **brownfield**, `lindenhof-treuhand/klientenportal` | Existing product analysis | Below |
| Payroll Self-Service | Lindenhof | greenfield | Requirements | Below |
| Expense Receipts App | Lindenhof | greenfield | **Paused** at sanitization | Below |
| Service Technician Portal | Talwerk | **brownfield**, `talwerk-fluid/service-portal` (develop) | Release | Below |
| Spare Parts Webshop | Talwerk | greenfield, `talwerk-fluid/spare-parts-shop` | Board | Below |
| Supplier Onboarding Portal | Talwerk | **brownfield**, `talwerk-fluid/supplier-portal` | Business | Below |
| Trade Fair Lead App | Talwerk | greenfield | **Abandoned** at business | Below |

**B2B Order Portal** (Alpine Fresh, from the blocks/seed/example-workspace scenario)
- Business: e-mail thread, call notes, an order form PDF, an order sheet CSV, an .eml and a whiteboard photo.
- Sanitization: questions, decisions and tech decisions.
- Requirements v1: 11 requirements and the objective.
- Design: 6 generated screens; one is accepted and one has changes requested.
- Scope: 8 features, stories and 3 milestones.
- Second opinion: 2 open challenges and 1 accepted.
- Feedback: Jonas's comment with an annotated screenshot.
- Shared: the scope with Jonas, the screens with Petra, and a public scope link.

**Driver Delivery App** (Alpine Fresh)
- Milestone 1: preview 0.1.0 is live.
- Milestone 2: building now (its build job is running at 45%); this build appears live on Studio and Timeline.
- Milestone 3: planned.
- Also: comments on tickets and agent chat threads with QA and the developer.

**Supplier Quality Portal** (Alpine Fresh)
- Business material only: kick-off notes, audit findings, a checklist PDF and an .eml.
- Not handed over yet.

**Client Document Portal** (Lindenhof)
- Existing product analysis of the repository: 3 open questions, answered and deferred questions, decisions and proposed tech decisions.
- The newest technical engine job failed because there is no repository access yet, so Simon sees it as needing attention.
- Also: a discussion thread and draft requirements.

**Payroll Self-Service** (Lindenhof)
- Sanitization completed (v1 snapshot); requirements are in draft.
- Design brief: draft in sample mode, with a style sheet and a reference screen.
- MADP suggestions: 2 open and 1 dismissed.
- A discussion on a requirement with a PDF attachment, and one new open question.

**Expense Receipts App** (Lindenhof)
- Paused at sanitization, waiting for the new accounting software.
- Open questions and a discussion that explains the pause.

**Service Technician Portal** (Talwerk)
- Releases:
  - dev, stage and production 1.0.0. The first production request was rejected by security; the second was approved.
  - CR-001: 1.1.0 is in production.
  - FX-2 (from the assistant's bug analysis): 1.1.1 is on stage, waiting for the production approval (the architect has approved).
- CR-003 is building now (change build running).
- CR-004 is a draft created from the planner chat.
- Wiki: 7 factory pages and 1 person page with history.
- Assistant threads on production and stage.

**Spare Parts Webshop** (Talwerk)
- Scope locked; 13 tickets are planned on the board, ready to start the build.
- Approval rules are set for stage and production.
- Share links: one live scope link and one revoked screen link.

**Supplier Onboarding Portal** (Talwerk)
- Existing purchasing portal named; business notes, a checklist PDF and an .eml.
- Not handed over yet.

**Trade Fair Lead App** (Talwerk)
- Stopped at business; the notes and the e-mail explain why.

Public share links (open them signed out):
- `/s/0a1e08aedfa50c0ced277cb774dfdb68036fbee7afe`: B2B Order Portal scope.
- `/s/3894fe07167a28844b857551fd61a2afff534a774af`: Spare Parts Webshop scope.

## Layout and how to change it

- `target.ts`: the contract with the local host (SeedTarget, SeedSummary).
- `index.ts`: `seedAll` (people → platform → workspaces → projects).
- `model.ts`: the shapes of the data tables. Add a field here first.
- `data/people.ts`, `data/workspaces.ts`: people, roles and memberships.
- `data/projects/*.ts`: one module per project, plain data. List a new project in `data/projects/index.ts`.
- `build/*.ts`: one builder per area. Each builder writes its own schemas and the rows behind them:
  - `docs`: business material.
  - `sanitization`: clarifications, decisions, requirements, v1 snapshot, suggestions.
  - `design`: brief, samples, screens.
  - `scope`: scope, second opinion, shares, links.
  - `delivery`: board, builds, previews, releases, approvals, changes.
  - `collab`: wiki, agent chat, assistant.
  - `feedback`: threads, comments and attachments.
  - `platform`, `workspaces`: accounts, settings, roles, members, invitations.
  - `world`: audit log and notifications.
- `core/*.ts`:
  - the writer, which does the stamping (WorkspaceId, ReaderIds, CreatedBy/UpdatedBy, SeedKey, RequestKey and the history dates CreatedDate / LastUpdatedDate);
  - the clock;
  - the file generators (PDF, PNG screens and whiteboard photos, .eml, CSV, text).

To add a field to a seeded row:
1. Add it to the plan type in `model.ts`, if it carries project data.
2. Set it in the builder that owns the schema; one row object per schema.
3. Fill it in the project tables.

The test tells you when a row no longer fits the schema rules or the app's mappers.
