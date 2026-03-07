import { describe, it, expect, beforeAll } from "vitest";
import { api, createUrl, cleanup, randomCode } from "./helpers.ts";

describe("Concurrency operations", () => {
  beforeAll(async () => {
    await cleanup();
  });

  it("concurrent-clicks-100: 100 parallel clicks are all counted", async () => {
    const created = await createUrl({
      url: "https://example.com/concurrent-100",
    });

    const requests = Array.from({ length: 100 }, () =>
      api(`/${created.code}`, { redirect: "manual" }),
    );

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toBe(301);
    }

    const res = await api(`/urls/${created.id}`);
    const body = await res.json();

    expect(body.click_count).toBe(100);
  });

  it("concurrent-clicks-500: 500 parallel clicks are all counted", async () => {
    const created = await createUrl({
      url: "https://example.com/concurrent-500",
    });

    const requests = Array.from({ length: 500 }, () =>
      api(`/${created.code}`, { redirect: "manual" }),
    );

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toBe(301);
    }

    const res = await api(`/urls/${created.id}`);
    const body = await res.json();

    expect(body.click_count).toBe(500);
  });

  it("concurrent-creates-same-code: 10 parallel creates with same custom_code yield exactly 1 success", async () => {
    const code = randomCode(8);

    const requests = Array.from({ length: 10 }, () =>
      api("/urls", {
        method: "POST",
        body: { url: "https://example.com/race", custom_code: code },
      }),
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);

    const successes = statuses.filter((s) => s === 201);
    const conflicts = statuses.filter((s) => s === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(9);
  });

  it("concurrent-creates-same-url: 20 parallel creates with same URL all return same code", async () => {
    const url = "https://example.com/concurrent-idempotent";

    const requests = Array.from({ length: 20 }, () =>
      api("/urls", {
        method: "POST",
        body: { url },
      }),
    );

    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const statuses = responses.map((r) => r.status);

    // One 201, rest 200
    const created = statuses.filter((s) => s === 201);
    const existing = statuses.filter((s) => s === 200);
    expect(created.length).toBe(1);
    expect(existing.length).toBe(19);

    // All should have the same code
    const codes = new Set(bodies.map((b) => b.code));
    expect(codes.size).toBe(1);
  });

  it.only("hash-uniqueness-50: 50 different URLs generate 50 unique codes", async () => {
    const requests = Array.from({ length: 50 }, (_, i) =>
      api("/urls", {
        method: "POST",
        body: { url: `https://example.com/unique/${i}/${randomCode(6)}` },
      }),
    );

    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((r) => r.json()));

    // for (const res of responses) {
    //   expect(res.status).toBe(201);
    // }

    const codes = new Set(bodies.map((b) => b.code));
    expect(codes.size).toBe(50);
  });

  it("concurrent-redirects-burst: 200 parallel redirects to same URL all return 301 correctly", async () => {
    const created = await createUrl({
      url: "https://example.com/burst-redirect",
    });

    const requests = Array.from({ length: 200 }, () =>
      api(`/${created.code}`, { redirect: "manual" }),
    );

    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(
        "https://example.com/burst-redirect",
      );
    }

    // Verify all clicks were counted
    const detail = await api(`/urls/${created.id}`);
    const body = await detail.json();
    expect(body.click_count).toBe(200);
  });
});
