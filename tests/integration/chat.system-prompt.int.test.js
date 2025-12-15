import { describe, test, expect } from "vitest";

// Ensure secure config for tests
// Config.validateGlibc = false; // This line is commented out as testcontainers is no longer imported

describe("Chat System Prompt Integration", () => {
  // Check if we are running in an environment where we can spawn the stack or if it is already running
  // For this regression test, we assume the dev stack is running as per the current context,
  // but a robust test would spin up the stack.
  // Given the constraints, I'll write a test that can be run against the running dev stack using fetch.

  const BASE_URL = "http://localhost:18010";
  console.log("Using BASE_URL:", BASE_URL);
  const API_KEY =
    process.env.PROXY_API_KEY ||
    "sk-2dc76b03f45922e78f88d5524777e0c48e17b2ef68a3fa30dc7cd0ab4dd182fc";

  test("should accept system messages without error", { timeout: 30000 }, async () => {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5",
        stream: false,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" },
        ],
      }),
    });

    if (response.status !== 200) {
      const text = await response.text();
      console.error("Request failed:", text);
    }

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("choices");
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.choices[0]).toHaveProperty("message");
  });
});
