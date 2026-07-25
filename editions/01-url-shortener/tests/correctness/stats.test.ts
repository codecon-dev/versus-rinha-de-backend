import { describe, it, expect, beforeEach } from "vitest";
import { api, createUrl, cleanup } from "./helpers.ts";

describe("Stats operations", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it("stats-with-clicks: GET /urls/:id/stats returns click_count, clicks_per_day and clicks_per_hour after clicks", async () => {
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
      (entry: { date: string; count: number }) => entry.date === today,
    );
    expect(todayEntry).toBeDefined();
    expect(todayEntry.count).toBe(5);

    // clicks_per_hour should also be present
    expect(body.clicks_per_hour).toBeDefined();
    expect(Array.isArray(body.clicks_per_hour)).toBe(true);
    expect(body.clicks_per_hour.length).toBeGreaterThanOrEqual(1);

    // Current hour should have the 5 clicks
    const totalHourClicks = body.clicks_per_hour.reduce(
      (sum: number, entry: { hour: string; count: number }) =>
        sum + entry.count,
      0,
    );
    expect(totalHourClicks).toBe(5);

    // Each entry should have hour (ISO string) and count
    for (const entry of body.clicks_per_hour) {
      expect(entry).toHaveProperty("hour");
      expect(entry).toHaveProperty("count");
      expect(typeof entry.hour).toBe("string");
      expect(typeof entry.count).toBe("number");
    }
  });

  it("stats-no-clicks: GET /urls/:id/stats returns click_count=0 with empty arrays", async () => {
    const created = await createUrl({ url: "https://example.com/no-clicks" });

    const res = await api(`/urls/${created.id}/stats`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.click_count).toBe(0);
    expect(body.clicks_per_day).toBeDefined();
    expect(Array.isArray(body.clicks_per_day)).toBe(true);
    expect(body.clicks_per_day).toHaveLength(0);
    expect(body.clicks_per_hour).toBeDefined();
    expect(Array.isArray(body.clicks_per_hour)).toBe(true);
    expect(body.clicks_per_hour).toHaveLength(0);
  });

  it("stats-not-found: GET /urls/:id/stats with unknown ID returns 404", async () => {
    const res = await api("/urls/00000000-0000-0000-0000-000000000000/stats");
    expect(res.status).toBe(404);
  });
});
