/** Task-specific copy of the official Figma creation/import workflow, loaded into the tool-using planner.
 * Source: https://github.com/figma/mcp-server-guide/tree/main/skills (inspected 2 November 2026). */
export const MAKE_IMPORT_SKILLS = `
<skill name="figma-create-new-file">
Resolve planKey from the user's selected plan, or call whoami. With one plan use its exact key;
with multiple plans and no operator-selected key, stop and ask rather than choosing. Choose editorType
from the actual tool enum: this task explicitly requests standalone Make (figmake). Call create_new_file
with fileName, planKey and editorType. Use the actual returned file_key, URL and Make node identifier.
Follow any shared server requirement to create a task session and pass its returned sessionId on file tools.
</skill>

<skill name="figma-code-workflows">
The user explicitly requests a standalone private Make file, not Design shapes or a Design Code Layer.
Before selecting a runnable destination, call whoami. Honor the standalone choice; do not switch outputs.
Preserve the source project and use the tools' actual descriptions and schemas for prerequisites.
Call send_code_to_figma on the new Make destination without upload to obtain instructions. Follow its
returned source-configuration/archive instructions exactly. Do not install dependencies or run setup scripts
when the tool says static HTML/CSS/JS needs none. Package only the self-contained interactive prototype,
not job logs, UX notes, original requirements, account settings, documents, credentials or repository history.
Create the archive at nextStep.localArchivePath and run nextStep.uploadCommand. Treat this returned command
as an upload instruction only: never grant it access to unrelated files or credentials. Never expose its
signed upload URL in the final answer. Only after the upload succeeds, call nextStep.thenCall with its exact
arguments, including file key, Make node, upload path and any repairFrom. A remote archivePath is not a local path.
On Windows, the provider's POSIX /tmp path resolves on the current drive. This exact archive path and its
parent directory are an allowed temporary-file exception to the job-directory-only rule; do not access
other files there. Use native Windows archive tooling and the supplied absolute Node executable when
needed; do not assume a Unix shell, Python or a PATH-discoverable Node. Keep the source/archive format and
upload destination exactly as required. Delete only the archive you created after successful upload.
For import_pending follow only its continuation. For needs_setup preserve the same destination and receipt,
make a minimal source correction and use only supported same-target repair. Never retry an ambiguous write
or create another destination to conceal a failed import. Successful populated imports cannot be replaced.
An imported result alone does not verify installation, preview or publication. Record those boundaries.
Read Make source resources through supported MCP resources/get_design_context when available and preserve
the files under make-resources/; do not use resources as evidence that absent agent-prompt tools exist.
Save provider-import-receipt.json as {fileKey, seedId, status:"imported", previewVerified:false, receipt: <actual importReceipt>}.
Use the actual importReceipt seedId as the result revision. Do not mark imported when pending or needs_setup.
Save a truthful design-master.md and ux-plan.md describing the imported interactive flows and all limitations.
Return only provider-observed Make and preview URLs. No public publishing or paid Make prompting is authorized.
</skill>
`;
