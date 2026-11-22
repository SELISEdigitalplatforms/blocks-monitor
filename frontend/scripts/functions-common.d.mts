export interface FunctionSpec {
  slug: string;
  description: string;
  roles: string[];
}
export interface FunctionsConfig {
  projectKey: string;
  allowInstallScripts: boolean;
  trigger: Record<string, unknown>;
  variables: { key: string; value: string }[];
  functions: Record<string, FunctionSpec>;
}
export interface VitePluginLike {
  name: string;
  enforce?: "pre" | "post";
  [hook: string]: unknown;
}

export const ROOT: string;
export const FUNCTION_KEYS: string[];
export function sha256(data: string | Uint8Array): string;
export function stableJson(value: unknown): string;
export function readFunctionsConfig(root?: string): FunctionsConfig;
export function listOpFiles(root: string, fn: string): string[];
export function aclSchemaNames(root: string): string[];
export function generateOpsModule(root: string, fn: string): string;
export function generateAclModule(root: string): string;
export function mfVirtualModules(options?: { root?: string; config?: unknown }): VitePluginLike;
export function boundaryPlugin(options?: { root?: string }): VitePluginLike;
export function hashInputs(root?: string): string;
