import { describe, it, expect, beforeAll } from "vitest";
import { api, createUrl, cleanup } from "./helpers.ts";

describe("Pagination operations", () => {
  beforeAll(async () => {
    await cleanup();

    // Create 15 URLs sequentially to ensure deterministic ordering
    for (let i = 1; i <= 15; i++) {
      await createUrl({ url: `https://example.com/page-${i}` });
    }
  });

  it("pagination-default: GET /urls returns 10 items with meta.total=15", async () => {
    const res = await api("/urls");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(10);
    expect(body.meta).toBeDefined();
    expect(body.meta.page).toBe(1);
    expect(body.meta.per_page).toBe(10);
    expect(body.meta.total).toBe(15);
  });

  it("pagination-page-2: GET /urls?page=2 returns remaining 5 items", async () => {
    const res = await api("/urls?page=2");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(5);
    expect(body.meta.page).toBe(2);
    expect(body.meta.total).toBe(15);
  });

  it("pagination-custom-per-page: GET /urls?per_page=5 returns 5 items", async () => {
    const res = await api("/urls?per_page=5");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(5);
    expect(body.meta.per_page).toBe(5);
    expect(body.meta.total).toBe(15);
  });

  it("pagination-order-desc: first item in list has the most recent created_at", async () => {
    const res = await api("/urls");
    expect(res.status).toBe(200);

    const body = await res.json();
    const items = body.data;

    expect(items.length).toBeGreaterThan(1);

    const firstCreatedAt = new Date(items[0].created_at).getTime();
    const secondCreatedAt = new Date(items[1].created_at).getTime();

    expect(firstCreatedAt).toBeGreaterThanOrEqual(secondCreatedAt);
  });
});
