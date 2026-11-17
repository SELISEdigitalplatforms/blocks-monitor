// The per-project MCP config for Claude Code runs with tools (the build, the product manager): it runs the developers'
// project-brief server (engine/selise-madp/mcp-servers/project-brief/index.mjs) on this project's knowledge-base folder,
// which holds the brief and the project context (context.json, ledger.jsonl). Read only, no network.
//
//   const file = mcpConfigFor(workspaceId, projectId);       // <project folder>/mcp.json, rewritten on every call
//   claude -p … --mcp-config <file> --strict-mcp-config --allowedTools "mcp__project-brief" …
//
// The tools then are mcp__project-brief__<tool>: the brief's six (get_project_brief, get_source_extraction,
// get_extracted_text, list_attachments, get_form_answers, search_findings) and the whole project's (get_project_context,
// get_requirements, get_scope, get_tickets, get_builds, get_decisions, trace).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kbDir } from "../api/knowledgeBase.ts";
import { concretePath } from "../local/engine/official/home.ts";
import { checkId, writeJsonAtomic } from "./store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** selise-madp/ */
const REPO = path.resolve(HERE, "..", "..", "..");
/** The developers' MCP server in this checkout (the only file of engine/ the Factory points at), links resolved. */
export const BRIEF_SERVER = concretePath(path.join(REPO, "engine", "selise-madp", "mcp-servers", "project-brief", "index.mjs"));

/** The MCP server the builds run: MF_MCP_BRIEF_SERVER (an absolute path, for an engine host whose service user cannot
 *  see this checkout, e.g. /srv/madp-factory/mcp/project-brief/index.mjs), else the checkout's own. Read on every call,
 *  with links resolved (concretePath): a session started on one release keeps that release's server. */
export function briefServer(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env.MF_MCP_BRIEF_SERVER ?? "").trim();
  if (!v) return BRIEF_SERVER;
  if (!path.isAbsolute(v)) throw new Error("MF_MCP_BRIEF_SERVER must be an absolute path");
  return concretePath(path.resolve(v));
}
export const MCP_SERVER_NAME = "project-brief";
/** The --allowedTools entry that allows every tool of the server. */
export const MCP_ALLOWED_TOOLS = `mcp__${MCP_SERVER_NAME}`;

export interface McpConfig {
  mcpServers: Record<string, { type: "stdio"; command: string; args: string[]; env: Record<string, string> }>;
}

/** The config for one project (no secrets: the server reads only the folder it is given). */
export function mcpConfigObject(workspaceId: string, projectId: string): { config: McpConfig; kb: string; projectDir: string } {
  checkId("workspace id", workspaceId);
  checkId("project id", projectId);
  const kb = kbDir({ workspaceId, projectId });
  // the knowledge base is this project's own folder and nothing else: <root>/projects/<workspaceId>/<projectId>/artifacts/brief
  const projectDir = path.resolve(kb, "..", "..");
  if (path.basename(projectDir) !== projectId.toLowerCase() && path.basename(projectDir) !== projectId) throw new Error("the knowledge base is not this project's");
  return {
    kb,
    projectDir,
    config: {
      mcpServers: {
        // MADP_KB_DIR is set too, so a server that reads the environment first can never fall back to another folder
        [MCP_SERVER_NAME]: { type: "stdio", command: process.execPath, args: [briefServer(), "--project", projectId, "--kb-dir", kb], env: { MADP_KB_DIR: kb } },
      },
    },
  };
}

/** Writes <project folder>/mcp.json for the project and answers its path (for `--mcp-config`). */
export function mcpConfigFor(workspaceId: string, projectId: string): string {
  const { config, projectDir } = mcpConfigObject(workspaceId, projectId);
  if (!fs.existsSync(briefServer())) throw new Error("the project-brief MCP server is missing");
  const file = path.join(projectDir, "mcp.json");
  writeJsonAtomic(file, config);
  return file;
}

/** The Claude Code arguments that give a run this project's context tools (and no other MCP server). */
export function mcpArgsFor(workspaceId: string, projectId: string): string[] {
  return ["--mcp-config", mcpConfigFor(workspaceId, projectId), "--strict-mcp-config"];
}
