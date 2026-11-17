# blocks/data: the MADP Factory data model as code

Everything the app stores lives in SELISE Blocks Data Gateway. These files describe it so it can be provisioned through the API at any time. Design: `design/BLOCKS-DATA-DESIGN.md`.

## Files

| File | Purpose |
| --- | --- |
| `schemas/<Name>.json` | One file per schema (51), in the format of the blocks-data-gateway-configuration skill. |
| `policies.json` | The policy table per schema. The only place access is edited. |
| `rules.json` | GENERATED from `policies.json` by `node scripts/data-rules.mjs` (303 policies, 204 security entries). Never edit by hand. `node scripts/data-rules.mjs --check` fails when it is stale. |
| `indexes.json` | Real unique and query indexes (max 15 per schema). `node scripts/data-indexes.mjs` prints the dry-run commands. |
| `validations.json` | Our own format: allowed enum values, required keys, length caps, 32-bit bounds. Applied later with `data validation save --type regex\|maxlength\|notempty\|range`. |

## Conventions

- Blocks scalars only. `Int` is 32-bit (money and sizes respect that).
- Enums are `String` plus an entry in `validations.json` (hosted Enum is rejected, MF-B20).
- System fields are never declared.
- Field order for workspace-owned schemas: `WorkspaceId`, `ReaderIds`, `CreatedByUserId`, `UpdatedByUserId` (PACL and AUD variants for platform and audit schemas).
- Only IAM user ids are stored, never display names.
- No `Type`, `Group` or `Order` field names.
- `isUniqueData` is never used; uniqueness comes from real compound unique indexes on always-set fields.
- Reads are by row ACL, own row or super admin; every write, edit and delete is `mf-service` only. No schema is ever Public or User (MF-B18).

## Platform system fields

The platform adds these to every row; they are never declared in a schema.

- `ItemId`: the row id.
- `CreatedDate`: when the row was created.
- `LastUpdatedDate`: when the row was last changed.
- `CreatedBy`: the creating user id (empty for service writes).
- `LastUpdatedBy`: the last updating user id (empty for service writes).
- `Language`: the row language.
- `OrganizationIds`: the organizations the row belongs to.
- `Tags`: the row tags.
- `IsDeleted`: the soft-delete flag.
- `DeletedDate`: when the row was soft-deleted.
- `DeletedBy`: who soft-deleted the row.

CreatedBy and LastUpdatedBy are always empty in MADP Factory (every write is a service write): read CreatedByUserId / UpdatedByUserId / RequestedByUserId instead. Every other field a read selects, sorts or filters on, and every field a function writes or reads, must be a field of blocks/data/schemas/<Schema>.json (checked by test/schema-contract-web.test.ts and test/schema-contract-server.test.ts).

## Decisions against the design text

- Run is folded into EngineJob (Progress plus a unique ActiveKey guard), since the engine replaces simulated runs (12.3).
- AssignmentEvent is named ProjectAssignment; WikiRevision is WikiPageHistory; AgentChat rows are AgentChatMessage.
- ActorUserId becomes CreatedByUserId / UpdatedByUserId because service writes leave CreatedBy empty.
- Approval steps are ApprovalStep rows (no CAS, MF-B03).
- Invitation holds invites and pending-account requests (12.1).
- Platform schemas carry ReaderIds stamped with the platform-role holders.
- Project.Status and DocFolder.Status (active|deleting; absent counts as active) mark a delete cascade in progress, and Project.BusinessHandedOverByUserId records who handed Business over (added by LX, additive; apply with the expand-first data-apply).
- DocFile is the Business document store; Attachment covers brief, design samples, feedback and change requests; ChangeRequestAttachment links a change request to an Attachment.

## The 51 schemas

### user (2): read own row, super admin (Account), service
- Account: one row per person, keyed by IAM UserId.
- Notification: a person's inbox (RecipientUserId; no super admin read).

### audit (1)
- AuditEvent: append-only audit trail (super admin, service).

### service (1)
- Operation: idempotency records by RequestId (service only).

### platform (3): ACL, super admin, service
- PlatformRole: customisable platform roles.
- PlatformRoleAssignment: who holds which platform role (also readable by the holder).
- PlatformSetting: platform-wide settings.

### workspace (44): ACL (ReaderIds), super admin, service
- Workspace, WorkspaceRole, Membership, Invitation: tenancy, roles, members, invites and pending-account requests.
- Project, ProjectAssignment, ProjectAnswer, Share: projects, who is assigned, intake answers, shares.
- DocFolder, DocNote, DocFile, Attachment: Business documents and Storage references.
- Clarification, Decision, TechDecision: Product sanitization.
- Requirement, Objective, ItemVersion, Suggestion: requirements, objective and their history.
- DesignBrief, DesignScreen: screens and design.
- ScopeVersion, Feature, Story, Milestone: scope confirmation.
- SecondOpinion, Challenge, EngineJob: engine job outputs and progress.
- Board, Ticket, TicketEvent: the board.
- ChangeRequest, ChangeRequestAttachment: change requests.
- Release, Preview: dev, stage and production releases and previews.
- ApprovalPolicy, ApprovalRequest, ApprovalStep: release-promotion approvals.
- FeedbackThread, FeedbackComment: feedback.
- WikiPage, WikiPageHistory: the wiki.
- AgentChatMessage, AssistantMessage: chats.

## Provisioning order (coordinator only, never from a lane)

1. `data sync --dry-run` on the empty project.
2. The index commands from `node scripts/data-indexes.mjs`.
3. The validations.

Warning: `data rules pull` would overwrite the generated `rules.json`. Edit `policies.json` and regenerate instead.
