/**
 * Codex App Server JSON-RPC bindings for chat.
 *
 * Generated with codex-cli/codex-rs/app-server-protocol export tooling (v0.53.0)
 * and then trimmed to the subset needed by the proxy. Regenerate when the
 * upstream protocol changes.
 */

/* eslint-disable */

export const JSONRPC_VERSION = "2.0" as const;
export const CODEX_CLI_VERSION = "0.53.0" as const;

export type JsonRpcId = number | string;

export type JsonRpcMethod =
  | "initialize"
  | "newConversation"
  | "addConversationListener"
  | "removeConversationListener"
  | "sendUserTurn"
  | "sendUserMessage";

export interface JsonRpcBaseEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
}

export interface JsonRpcRequest<Method extends JsonRpcMethod, Params> extends JsonRpcBaseEnvelope {
  id: JsonRpcId;
  method: Method;
  params: Params;
}

export interface JsonRpcSuccessResponse<Result> extends JsonRpcBaseEnvelope {
  id: JsonRpcId;
  result: Result;
}

export interface JsonRpcErrorObject {
  code: number | string;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse extends JsonRpcBaseEnvelope {
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse<Result> = JsonRpcSuccessResponse<Result> | JsonRpcErrorResponse;

export type JsonRpcNotificationMethod = string;

export interface JsonRpcNotification<Method extends JsonRpcNotificationMethod, Params>
  extends JsonRpcBaseEnvelope {
  method: Method;
  params: Params;
}

export interface ClientInfo {
  name: string;
  version: string;
  title?: string | null;
  [key: string]: unknown;
}

export interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities?: Record<string, unknown> | null;
  protocolVersion?: string;
}

export interface InitializeResult {
  userAgent: string;
  [key: string]: unknown;
}

export type SandboxMode = "danger-full-access" | "read-only" | "workspace-write";

export type AskForApproval = "untrusted" | "on-failure" | "on-request" | "never";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";

export type SandboxPolicy =
  | { mode: "danger-full-access" }
  | { mode: "read-only" }
  | {
      mode: "workspace-write";
      writable_roots?: string[];
      network_access?: boolean;
      exclude_tmpdir_env_var?: boolean;
      exclude_slash_tmp?: boolean;
    };

export type InputItem =
  | { type: "text"; data: { text: string } }
  | { type: "image"; data: { image_url: string } }
  | { type: "localImage"; data: { path: string } };

export interface NewConversationParams {
  model?: string | null;
  modelProvider?: string | null;
  profile?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandbox?: SandboxMode | null;
  config?: Record<string, unknown> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  compactPrompt?: string | null;
  includeApplyPatchTool?: boolean | null;
  [key: string]: unknown;
}

export interface NewConversationResult {
  conversationId: string;
  model: string;
  reasoningEffort?: ReasoningEffort | null;
  rolloutPath?: string;
  [key: string]: unknown;
}

export interface AddConversationListenerParams {
  conversationId: string;
  experimentalRawEvents?: boolean;
  [key: string]: unknown;
}

export interface AddConversationListenerResult {
  subscriptionId: string;
  [key: string]: unknown;
}

export interface SendUserTurnParams {
  conversationId: string;
  items: InputItem[];
  cwd: string;
  approvalPolicy: AskForApproval;
  sandboxPolicy: SandboxPolicy;
  model: string;
  effort?: ReasoningEffort | null;
  summary: ReasoningSummary;
  metadata?: Record<string, unknown> | null;
  tools?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface SendUserTurnResult {
  [key: string]: unknown;
}

export interface SendUserMessageParams {
  conversationId: string;
  items: InputItem[];
  includeUsage?: boolean;
  include_usage?: boolean;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface SendUserMessageResult {
  [key: string]: unknown;
}

export interface RemoveConversationListenerParams {
  subscriptionId: string;
  [key: string]: unknown;
}

export interface RemoveConversationListenerResult {
  [key: string]: unknown;
}

export type JsonObject = Record<string, unknown>;

const APPROVAL_FALLBACK: AskForApproval = "on-request";
const SUMMARY_FALLBACK: ReasoningSummary = "auto";

const SANDBOX_FALLBACK: SandboxPolicy = { mode: "danger-full-access" };

export interface BuildInitializeOptions {
  clientInfo: ClientInfo;
  capabilities?: JsonObject | null;
  protocolVersion?: string;
}

export interface BuildNewConversationOptions {
  model?: string | null;
  modelProvider?: string | null;
  profile?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | string | null;
  sandbox?: SandboxMode | string | JsonObject | null;
  config?: JsonObject | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  compactPrompt?: string | null;
  includeApplyPatchTool?: boolean | null;
}

export interface BuildSendUserTurnOptions {
  conversationId?: string | null;
  items?: InputItem[] | null;
  cwd?: string;
  approvalPolicy?: AskForApproval | string | null;
  sandboxPolicy?: SandboxPolicy | { mode?: string; [key: string]: unknown } | null;
  model?: string;
  effort?: ReasoningEffort | string | null;
  summary?: ReasoningSummary | string | null;
}

export interface BuildSendUserMessageOptions {
  conversationId?: string | null;
  items?: InputItem[] | null;
  includeUsage?: boolean;
}

const VALID_APPROVAL_POLICIES: Set<string> = new Set([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);

const VALID_REASONING_SUMMARIES: Set<string> = new Set(["auto", "concise", "detailed", "none"]);

const VALID_REASONING_EFFORTS: Set<string> = new Set(["minimal", "low", "medium", "high"]);

const VALID_SANDBOX_MODES: Set<string> = new Set([
  "danger-full-access",
  "read-only",
  "workspace-write",
]);

export function createUserMessageItem(text: string, _metadata?: JsonObject | null): InputItem {
  return {
    type: "text",
    data: { text: text ?? "" },
  };
}

export function buildInitializeParams(
  options: BuildInitializeOptions
): InitializeParams & JsonObject {
  const clientInfo = { ...(options.clientInfo || {}) } as ClientInfo;
  if (!clientInfo.name) clientInfo.name = "codex-completions-api";
  if (!clientInfo.version) clientInfo.version = CODEX_CLI_VERSION;
  const params: InitializeParams & JsonObject = {
    clientInfo,
  };
  if (options.capabilities !== undefined) {
    params.capabilities = options.capabilities ?? null;
  }
  if (options.protocolVersion) {
    params.protocolVersion = options.protocolVersion;
  }
  // Maintain backward compatibility with older CLI versions that expected snake_case.
  params.client_info = clientInfo;
  if (options.capabilities !== undefined) {
    params.capabilities = options.capabilities ?? null;
  }
  if (options.protocolVersion) {
    params.protocol_version = options.protocolVersion;
  }
  return params;
}

export function buildNewConversationParams(
  options: BuildNewConversationOptions = {}
): NewConversationParams & JsonObject {
  const params: NewConversationParams & JsonObject = {};

  const model = toNullableString(options.model);
  if (typeof model === "string") params.model = model;

  const modelProvider = toNullableString(options.modelProvider);
  if (typeof modelProvider === "string") params.modelProvider = modelProvider;

  const profile = toNullableString(options.profile);
  if (typeof profile === "string") params.profile = profile;

  const cwd = toNullableString(options.cwd);
  if (typeof cwd === "string") params.cwd = cwd;

  const approval = normalizeOptionalApprovalPolicy(options.approvalPolicy);
  if (typeof approval === "string") params.approvalPolicy = approval;

  const sandbox = normalizeSandboxModeOption(options.sandbox);
  if (typeof sandbox === "string") params.sandbox = sandbox;

  if (options.config && typeof options.config === "object") {
    params.config = options.config ?? null;
  }

  const baseInstructions = toNullableString(options.baseInstructions);
  if (typeof baseInstructions === "string") params.baseInstructions = baseInstructions;

  const developerInstructions = toNullableString(options.developerInstructions);
  if (typeof developerInstructions === "string") {
    params.developerInstructions = developerInstructions;
  }

  const compactPrompt = toNullableString(options.compactPrompt);
  if (typeof compactPrompt === "string") params.compactPrompt = compactPrompt;

  if (typeof options.includeApplyPatchTool === "boolean") {
    params.includeApplyPatchTool = options.includeApplyPatchTool;
  }

  return params;
}

export function buildSendUserTurnParams(
  options: BuildSendUserTurnOptions
): SendUserTurnParams & JsonObject {
  const items: InputItem[] = Array.isArray(options.items)
    ? options.items.map((item) => ({ ...(item || {}) }) as InputItem)
    : [];

  const sandbox = normalizeSandboxPolicy(options.sandboxPolicy);
  const approval = normalizeApprovalPolicy(options.approvalPolicy);
  const effort = normalizeReasoningEffort(options.effort);
  const summary = normalizeReasoningSummary(options.summary);

  const params: SendUserTurnParams & JsonObject = {
    conversationId: String(options.conversationId ?? ""),
    items,
    cwd: String(options.cwd ?? ""),
    approvalPolicy: approval,
    sandboxPolicy: sandbox,
    model: String(options.model ?? ""),
    summary,
  };

  if (effort !== undefined) {
    params.effort = effort;
  }

  return params;
}

export function buildSendUserMessageParams(
  options: BuildSendUserMessageOptions
): SendUserMessageParams & JsonObject {
  const items: InputItem[] = Array.isArray(options.items)
    ? options.items.map((item) => ({ ...(item || {}) }) as InputItem)
    : [];

  const params: SendUserMessageParams & JsonObject = {
    conversationId: String(options.conversationId ?? ""),
    items,
  };

  if (options.includeUsage !== undefined) {
    const value = !!options.includeUsage;
    params.includeUsage = value;
    params.include_usage = value;
  }

  return params;
}

export function buildAddConversationListenerParams(
  options: AddConversationListenerParams
): AddConversationListenerParams & JsonObject {
  const params: AddConversationListenerParams & JsonObject = {
    conversationId: String(options.conversationId ?? ""),
  };
  if (options.experimentalRawEvents !== undefined) {
    params.experimentalRawEvents = !!options.experimentalRawEvents;
  }
  return params;
}

export function buildRemoveConversationListenerParams(
  options: RemoveConversationListenerParams
): RemoveConversationListenerParams & JsonObject {
  return {
    subscriptionId: String(options.subscriptionId ?? ""),
  };
}

function normalizeApprovalPolicy(
  value: BuildSendUserTurnOptions["approvalPolicy"]
): AskForApproval {
  if (typeof value === "string") {
    const normalized = (value as string).trim().toLowerCase();
    if (VALID_APPROVAL_POLICIES.has(normalized)) {
      return normalized as AskForApproval;
    }
  }
  return APPROVAL_FALLBACK;
}

function normalizeReasoningSummary(value: BuildSendUserTurnOptions["summary"]): ReasoningSummary {
  if (typeof value === "string") {
    const normalized = (value as string).trim().toLowerCase();
    if (VALID_REASONING_SUMMARIES.has(normalized)) {
      return normalized as ReasoningSummary;
    }
  }
  return SUMMARY_FALLBACK;
}

function normalizeReasoningEffort(
  value: BuildSendUserTurnOptions["effort"]
): ReasoningEffort | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const normalized = (value as string).trim().toLowerCase();
    if (VALID_REASONING_EFFORTS.has(normalized)) {
      return normalized as ReasoningEffort;
    }
  }
  return undefined;
}

function normalizeSandboxPolicy(value: BuildSendUserTurnOptions["sandboxPolicy"]): SandboxPolicy {
  if (value && typeof value === "object" && "mode" in value) {
    const mode = String(value.mode || "")
      .trim()
      .toLowerCase();
    if (!VALID_SANDBOX_MODES.has(mode)) {
      return SANDBOX_FALLBACK;
    }
    if (mode === "workspace-write") {
      const policy: SandboxPolicy = {
        mode: "workspace-write",
      };
      if (Array.isArray((value as any).writable_roots)) {
        policy.writable_roots = [...((value as any).writable_roots as string[])];
      }
      if (typeof (value as any).network_access === "boolean") {
        policy.network_access = (value as any).network_access as boolean;
      }
      if (typeof (value as any).exclude_tmpdir_env_var === "boolean") {
        policy.exclude_tmpdir_env_var = (value as any).exclude_tmpdir_env_var as boolean;
      }
      if (typeof (value as any).exclude_slash_tmp === "boolean") {
        policy.exclude_slash_tmp = (value as any).exclude_slash_tmp as boolean;
      }
      return policy;
    }
    if (mode === "read-only") {
      return { mode: "read-only" };
    }
    return { mode: "danger-full-access" };
  }

  if (typeof value === "string") {
    const normalized = (value as string).trim().toLowerCase();
    if (VALID_SANDBOX_MODES.has(normalized)) {
      if (normalized === "workspace-write") {
        return { mode: "workspace-write" };
      }
      if (normalized === "read-only") {
        return { mode: "read-only" };
      }
      return { mode: "danger-full-access" };
    }
  }

  return SANDBOX_FALLBACK;
}

function toNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const str = String(value);
  const trimmed = str.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalApprovalPolicy(
  value: BuildSendUserTurnOptions["approvalPolicy"]
): AskForApproval | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const normalized = (value as string).trim().toLowerCase();
    if (VALID_APPROVAL_POLICIES.has(normalized)) {
      return normalized as AskForApproval;
    }
    return APPROVAL_FALLBACK;
  }
  return value as AskForApproval;
}

function normalizeSandboxModeOption(
  value: BuildNewConversationOptions["sandbox"]
): SandboxMode | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const normalized = (value as string).trim().toLowerCase();
    if (VALID_SANDBOX_MODES.has(normalized)) {
      return normalized as SandboxMode;
    }
    return undefined;
  }
  if (value && typeof value === "object" && "mode" in value) {
    const mode = String((value as JsonObject).mode || "")
      .trim()
      .toLowerCase();
    if (VALID_SANDBOX_MODES.has(mode)) {
      return mode as SandboxMode;
    }
  }
  return undefined;
}
