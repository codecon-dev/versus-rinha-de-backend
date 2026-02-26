import { describe, it, expect, beforeEach } from "vitest";
import { api, createUrl, cleanup, randomCode } from "./helpers.ts";

describe("Validation operations", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it("code-format: auto-generated code is at least 6 alphanumeric characters", async () => {
    const created = await createUrl({ url: "https://example.com" });

    expect(created.code).toBeDefined();
    expect(created.code.length).toBeGreaterThanOrEqual(6);
    expect(created.code).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it("custom-code-too-long: POST /urls with custom_code exceeding 16 chars returns 400", async () => {
    const longCode = randomCode(20);

    const res = await api("/urls", {
      method: "POST",
      body: { url: "https://example.com", custom_code: longCode },
    });

    expect(res.status).toBe(400);
  });

  it("url-very-long: POST /urls with a valid 2000-char URL returns 201", async () => {
    // Build a valid URL that is approximately 2000 characters long
    const base = "https://example.com/path?data=";
    const padding = "a".repeat(2000 - base.length);
    const longUrl = base + padding;

    const res = await api("/urls", {
      method: "POST",
      body: { url: longUrl },
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.url).toBe(longUrl);
  });

  it("content-type-json: POST /urls response has Content-Type application/json", async () => {
    const res = await api("/urls", {
      method: "POST",
      body: { url: "https://example.com" },
    });

    expect(res.status).toBe(201);

    const contentType = res.headers.get("content-type");
    expect(contentType).toBeDefined();
    expect(contentType).toContain("application/json");
  });
});
