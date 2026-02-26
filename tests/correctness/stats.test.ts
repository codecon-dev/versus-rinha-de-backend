import { describe, it, expect, beforeEach } from "vitest";
import { api, createUrl, cleanup } from "./helpers.ts";

describe("Stats operations", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it("stats-with-clicks: GET /urls/:id/stats returns click_count and clicks_per_day after clicks", async () => {
    const created = await createUrl({ url: "https://example.com/stats" });

    // Perform 5 clicks
    for (let i = 0; i < 5; i++) {
      await api(`/${created.code}`, { redirect: "manual" });
    }

    const res = await api(`/urls/${created.id}/stats`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.code).toBe(created.code);
    expect(body.url).toBe(created.url);
    expect(body.click_count).toBe(5);
    expect(body.clicks_per_day).toBeDefined();
    expect(Array.isArray(body.clicks_per_day)).toBe(true);

    // Today's date should appear in clicks_per_day
    const today = new Date().toISOString().split("T")[0];
    const todayEntry = body.clicks_per_day.find(
      (entry: { date: string; count: number }) => entry.date === today
    );
    expect(todayEntry).toBeDefined();
    expect(todayEntry.count).toBe(5);
  });

  it("stats-no-clicks: GET /urls/:id/stats returns click_count=0 with no clicks", async () => {
    const created = await createUrl({ url: "https://example.com/no-clicks" });

    const res = await api(`/urls/${created.id}/stats`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.click_count).toBe(0);
    expect(body.clicks_per_day).toBeDefined();
    expect(Array.isArray(body.clicks_per_day)).toBe(true);
    expect(body.clicks_per_day).toHaveLength(0);
  });

  it("stats-not-found: GET /urls/:id/stats with unknown ID returns 404", async () => {
    const res = await api("/urls/00000000-0000-0000-0000-000000000000/stats");
    expect(res.status).toBe(404);
  });
});
