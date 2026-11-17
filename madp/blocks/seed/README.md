# Seed scenarios

A seed scenario recreates a realistic example on demand as real records in the Blocks Data Gateway. No app code imports these fixtures and nothing seeds at boot. The seed is prepared here and applied only by a super admin through the `mf-admin` `seed.apply` operation (a later lane), or by a script that calls that function. The function stamps `WorkspaceId`, `ReaderIds`, `CreatedByUserId` / `UpdatedByUserId`, `IsExample` and `SeedKey`, and writes an `AuditEvent`.

## Scenario `example-workspace`

Alpine Fresh AG workspace with the B2B Order Portal project at Scope confirmation, in apply order (`manifest.json`):

- Workspace, Membership, Project, ProjectAssignment: the company workspace, its members and the project with its assignees.
- DocFolder, DocNote: Business folders and notes from the client emails and the call.
- Clarification, Decision, TechDecision: Product sanitization.
- Requirement, Objective: requirements and objective v1.
- DesignBrief: the confirmed design brief.
- ScopeVersion, Feature, Story, Milestone: scope v1 with its milestones.
- ApprovalPolicy, ApprovalStep: the release approval policy.

The users `qa-a` (workspace admin, project assignee, architect approver) and `qa-b` (workspace member, expert, security/QA approver) are placeholders. At apply time each is resolved to an IAM user by the email in `MF_SEED_QA_A_EMAIL` / `MF_SEED_QA_B_EMAIL`.

## Fixture format

`<Schema>.json` is a JSON array of records. A record has:

- `$key` (required, `^[a-z0-9][a-z0-9-]{1,62}$`, unique within the schema) and plain field values.
- `$ref`: `{ "Field": "Schema:key" }` (or an array of those) resolves to that seed record's `ItemId`, read by its `SeedKey` (see Seed keys). The target must exist and come earlier in `manifest.order`; the field must be String or ID.
- `$user`: `{ "Field": "qa-a" | "qa-a#email" | "qa-a#name" }` (or an array) resolves at apply time to the user's IAM id, email or display name.
- `$at`: `{ "Field": "-3d+2h" }` is a relative time (`^[+-][0-9]+d([+-][0-9]+h)?([+-][0-9]+m)?$`); the field must be DateTime.

A field is set once (plain value or one directive). Fixtures never contain the server-stamped fields (`WorkspaceId`, `ReaderIds`, `CreatedByUserId`, `UpdatedByUserId`, `IsExample`, `SeedKey`) or system fields (`ItemId`, `CreatedDate`, `CreatedBy`, `LastUpdatedDate`, `LastUpdatedBy`, `OrganizationId`, `Tags`, `Language`).

## Seed keys

The hosted Data Gateway rejects a client-supplied `ItemId` in every format, so ids cannot be derived. Every seedable schema (the schemas of the fixtures) has a `SeedKey` String field with a real unique index. The apply stamps it on every row it inserts and inserts without `ItemId`:

- Workspace rows: `<scenario>:<key>`.
- Every other row: `<workspaceId>:<scenario>:<key>` (the schema is implied by the collection), where `workspaceId` is the `--target-workspace` id or, with `new`, the `ItemId` of the Workspace row just created (stamped as `WorkspaceId` on everything). With an existing target, `Workspace.json` is skipped.

To apply, in manifest order, for each record: read the row by its `SeedKey`; if it exists reuse its `ItemId` and insert nothing, otherwise insert it. Each `$ref` is resolved by reading the referenced record's `ItemId` by its `SeedKey` (target workspace + scenario + schema + key). A second apply therefore finds every row by `SeedKey` and creates no duplicates, and the unique index rejects a concurrent duplicate. Fixtures keep stable `$key`s and never contain an `ItemId`.

## Dry run

```
node scripts/seed-plan.mjs [--scenario <name>] [--target-workspace <id>] [--json]
```

Validates every fixture against its schema file, validations and unique indexes, then prints the plan (each record's `SeedKey` and the `SeedKey` lookup for each of its `$ref`s with `--json`). It has no network access and applies nothing.

## Idempotent writes

Every schema the server inserts into also has a `RequestKey` String field (`<op>:<requestId>[:<n>]`, set by the server) with a real unique index, so a retried write is detected instead of duplicated.

## Copy rules

Fixture text follows the product rules: no demo, mock or pilot wording, and never a count of agents (say "MADP agents").
