import { randomUUID } from "node:crypto";

const defaultToolName = "lookup_user";

export function createToolCall(overrides = {}) {
  const {
    id = randomUUID(),
    name = defaultToolName,
    payload = { id: String(Math.floor(Math.random() * 1000)) },
  } = overrides;
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(payload),
    },
  };
}

export function createToolBurst(count = 2, overrides = {}) {
  return Array.from({ length: count }, (_, index) =>
    createToolCall({
      id: overrides.idFactory ? overrides.idFactory(index) : undefined,
      name: overrides.nameFactory ? overrides.nameFactory(index) : defaultToolName,
      payload: {
        id: String(42 + index),
        ...(overrides.payloadFactory ? overrides.payloadFactory(index) : {}),
      },
    })
  );
}

export function createUseToolBlock({ name = defaultToolName, id = "42", body = {} } = {}) {
  const args = JSON.stringify(body, null, 2);
  return `<use_tool>\n  <name>${name}</name>\n  <id>${id}</id>\n  <args>${args}</args>\n</use_tool>`;
}
