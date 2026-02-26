import { describe, it, expect, beforeEach } from "vitest";
import { api, createUrl, cleanup, randomCode } from "./helpers.ts";

describe("Redirect operations", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it("redirect-basic: GET /:code returns 301 with Location header pointing to original URL", async () => {
    const created = await createUrl({ url: "https://example.com/target" });

    const res = await api(`/${created.code}`, { redirect: "manual" });

    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://example.com/target");
  });

  it("redirect-increments-clicks: GET /:code three times increments click_count to 3", async () => {
    const created = await createUrl({ url: "https://example.com" });

    await api(`/${created.code}`, { redirect: "manual" });
    await api(`/${created.code}`, { redirect: "manual" });
    await api(`/${created.code}`, { redirect: "manual" });

    const res = await api(`/urls/${created.id}`);
    const body = await res.json();

    expect(body.click_count).toBe(3);
  });

  it("redirect-not-found: GET /:code with nonexistent code returns 404", async () => {
    const res = await api("/nonexistent-code-xyz", { redirect: "manual" });

    expect(res.status).toBe(404);
  });

  it("redirect-expired: GET /:code for expired URL returns 410", async () => {
    // Create a URL that expires 2 seconds from now
    const expiresAt = new Date(Date.now() + 2000).toISOString();
    const created = await createUrl({
      url: "https://example.com",
      expires_at: expiresAt,
    });

    // Wait for the URL to expire
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const res = await api(`/${created.code}`, { redirect: "manual" });

    expect(res.status).toBe(410);
  });
});
