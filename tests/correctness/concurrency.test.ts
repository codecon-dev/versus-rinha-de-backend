import { describe, it, expect, beforeAll } from "vitest";
import { api, createUrl, cleanup, randomCode } from "./helpers.ts";

describe("Concurrency operations", () => {
  beforeAll(async () => {
    await cleanup();
  });

  it("concurrent-clicks-100: 100 parallel clicks are all counted", async () => {
    const created = await createUrl({ url: "https://example.com/concurrent-100" });

    const requests = Array.from({ length: 100 }, () =>
      api(`/${created.code}`, { redirect: "manual" })
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
    const created = await createUrl({ url: "https://example.com/concurrent-500" });

    const requests = Array.from({ length: 500 }, () =>
      api(`/${created.code}`, { redirect: "manual" })
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
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);

    const successes = statuses.filter((s) => s === 201);
    const conflicts = statuses.filter((s) => s === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(9);
  });
});
