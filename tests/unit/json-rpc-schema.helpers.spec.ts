import { describe, expect, it } from "vitest";

import {
  JSONRPC_VERSION,
  buildInitializeParams,
  buildNewConversationParams,
  buildSendUserTurnParams,
  extractConversationId,
  extractRequestId,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcSuccessResponse,
  normalizeInputItems,
} from "../../src/lib/json-rpc/schema.ts";

describe("json-rpc schema helper behavior", () => {
  it("normalizes input items and falls back to provided text", () => {
    const items = normalizeInputItems(
      [
        { type: "image", data: { image_url: "https://example.com/image.png" } },
        { data: { text: "hello" } },
        { text: "world" },
      ],
      "fallback"
    );

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      type: "image",
      data: { image_url: "https://example.com/image.png" },
    });
    expect(items[1]).toMatchObject({ type: "text", data: { text: "hello" } });
    expect(items[2]).toMatchObject({ type: "text", data: { text: "world" } });

    const fallbackItems = normalizeInputItems([], "fallback");
    expect(fallbackItems).toHaveLength(1);
    expect(fallbackItems[0]).toMatchObject({ type: "text", data: { text: "fallback" } });
  });

  it("applies approval, summary, and sandbox fallbacks", () => {
    const params = buildSendUserTurnParams({
      items: [],
      conversationId: "conv",
      cwd: "/tmp",
      approvalPolicy: "invalid",
      sandboxPolicy: { type: "unknown" },
      model: "gpt-5.2",
      summary: "unknown",
    });

    expect(params.approvalPolicy).toBe("on-request");
    expect(params.summary).toBe("auto");
    expect(params.sandboxPolicy).toEqual({ type: "read-only" });
  });

  it("preserves workspace-write sandbox options", () => {
    const params = buildSendUserTurnParams({
      items: [],
      conversationId: "conv",
      cwd: "/tmp",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "workspace-write",
        writable_roots: ["/tmp"],
        network_access: true,
        exclude_tmpdir_env_var: true,
        exclude_slash_tmp: true,
      },
      model: "gpt-5.2",
      summary: "auto",
    });

    expect(params.sandboxPolicy).toMatchObject({
      type: "workspace-write",
      writable_roots: ["/tmp"],
      network_access: true,
      exclude_tmpdir_env_var: true,
      exclude_slash_tmp: true,
    });
  });

  it("parses choiceCount values when valid", () => {
    const params = buildSendUserTurnParams({
      items: [],
      conversationId: "conv",
      cwd: "/tmp",
      approvalPolicy: "never",
      sandboxPolicy: "read-only",
      model: "gpt-5.2",
      summary: "auto",
      choiceCount: "2",
    });

    expect(params.choiceCount).toBe(2);
    expect(params.choice_count).toBe(2);
  });

  it("normalizes optional approval and sandbox modes for new conversations", () => {
    const params = buildNewConversationParams({
      approvalPolicy: "bad",
      sandbox: { mode: "read-only" },
    });

    expect(params.approvalPolicy).toBe("on-request");
    expect(params.sandbox).toBe("read-only");

    const nullParams = buildNewConversationParams({ approvalPolicy: null });
    expect(nullParams.approvalPolicy).toBeUndefined();
  });

  it("builds initialize params with protocol versions and capabilities", () => {
    const params = buildInitializeParams({
      clientInfo: { name: "tester", version: "1.0.0" },
      capabilities: { feature: true },
      protocolVersion: "1.2.3",
    });

    expect(params.protocolVersion).toBe("1.2.3");
    expect(params.protocol_version).toBe("1.2.3");
    expect(params.capabilities).toEqual({ feature: true });
  });

  it("extracts conversation and request ids from nested payloads", () => {
    expect(extractConversationId({ conversation_id: "conv-1" })).toBe("conv-1");
    expect(extractConversationId({ conversation: { id: "conv-2" } })).toBe("conv-2");
    expect(extractConversationId({ context: { conversation_id: "conv-3" } })).toBe("conv-3");

    expect(extractRequestId({ request_id: "req-1" })).toBe("req-1");
    expect(extractRequestId({ context: { request_id: "req-2" } })).toBe("req-2");
  });

  it("identifies jsonrpc notifications and responses", () => {
    const notification = {
      jsonrpc: JSONRPC_VERSION,
      method: "requestTimeout",
      params: { request_id: "req-1", conversation_id: "conv-1" },
    };
    const success = { jsonrpc: JSONRPC_VERSION, id: 1, result: { ok: true } };
    const error = { jsonrpc: JSONRPC_VERSION, id: 2, error: { code: "bad", message: "boom" } };

    expect(isJsonRpcNotification(notification)).toBe(true);
    expect(isJsonRpcSuccessResponse(success)).toBe(true);
    expect(isJsonRpcErrorResponse(error)).toBe(true);
    expect(isJsonRpcNotification({})).toBe(false);
  });
});
