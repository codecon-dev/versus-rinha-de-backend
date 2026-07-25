import { describe, it, expect, beforeEach } from "vitest";
import {
  api,
  createUrl,
  cleanup,
  futureDate,
  pastDate,
  randomCode,
} from "./helpers.ts";

describe("CRUD operations", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it("create-basic: POST /urls creates a short URL with correct response shape", async () => {
    const res = await api("/urls", {
      method: "POST",
      body: { url: "https://example.com" },
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("code");
    expect(body).toHaveProperty("url", "https://example.com");
    expect(body).toHaveProperty("short_url");
    expect(body).toHaveProperty("created_at");
    expect(body).toHaveProperty("updated_at");
    expect(body).toHaveProperty("click_count", 0);
  });

  it("create-with-custom-code: POST /urls with custom_code sets the code", async () => {
    const code = randomCode(8);
    const body = await createUrl({
      url: "https://example.com",
      custom_code: code,
    });

    expect(body.code).toBe(code);
    expect(body.short_url).toContain(code);
  });

  it("create-with-expiration: POST /urls with expires_at in future sets expiration", async () => {
    const expiresAt = futureDate(48);
    const body = await createUrl({
      url: "https://example.com",
      expires_at: expiresAt,
    });

    expect(body.expires_at).toBeDefined();
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("create-invalid-url: POST /urls with invalid URL returns 400", async () => {
    const res = await api("/urls", {
      method: "POST",
      body: { url: "not-a-url" },
    });

    expect(res.status).toBe(400);
  });

  it("create-duplicate-custom-code: POST /urls with duplicate custom_code returns 409", async () => {
    const code = randomCode(8);
    await createUrl({ url: "https://example.com", custom_code: code });

    const res = await api("/urls", {
      method: "POST",
      body: { url: "https://example.org", custom_code: code },
    });

    expect(res.status).toBe(409);
  });

  it("create-expired-date: POST /urls with expires_at in past returns 400", async () => {
    const res = await api("/urls", {
      method: "POST",
      body: { url: "https://example.com", expires_at: pastDate(1) },
    });

    expect(res.status).toBe(400);
  });

  it("get-existing: GET /urls/:id returns the created URL", async () => {
    const created = await createUrl({ url: "https://example.com" });

    const res = await api(`/urls/${created.id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.code).toBe(created.code);
    expect(body.url).toBe(created.url);
    expect(body.short_url).toBe(created.short_url);
  });

  it("get-nonexistent: GET /urls/:id with unknown ID returns 404", async () => {
    const res = await api("/urls/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("update-url: PATCH /urls/:id updates the url field", async () => {
    const created = await createUrl({ url: "https://example.com" });

    const res = await api(`/urls/${created.id}`, {
      method: "PATCH",
      body: { url: "https://updated.example.com" },
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.url).toBe("https://updated.example.com");
    expect(new Date(body.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated_at).getTime(),
    );
  });

  it("update-expiration: PATCH /urls/:id updates expires_at", async () => {
    const created = await createUrl({ url: "https://example.com" });
    const newExpiry = futureDate(72);

    const res = await api(`/urls/${created.id}`, {
      method: "PATCH",
      body: { expires_at: newExpiry },
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.expires_at).toBeDefined();
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("delete-existing: DELETE /urls/:id returns 204 and subsequent GET returns 404", async () => {
    const created = await createUrl({ url: "https://example.com" });

    const deleteRes = await api(`/urls/${created.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const getRes = await api(`/urls/${created.id}`);
    expect(getRes.status).toBe(404);
  });

  it("delete-nonexistent: DELETE /urls/:id with unknown ID returns 404", async () => {
    const res = await api("/urls/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("idempotent-create: POST /urls with same URL twice returns same code with 200", async () => {
    const url = "https://example.com/idempotent-test";

    const first = await api("/urls", { method: "POST", body: { url } });
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await api("/urls", { method: "POST", body: { url } });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    expect(secondBody.code).toBe(firstBody.code);
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.url).toBe(firstBody.url);
  });

  it("idempotent-create-with-custom-code: POST same URL with custom_code on second call is ignored, returns existing", async () => {
    const url = "https://example.com/idempotent-custom";
    const customCode = randomCode(8);

    const first = await createUrl({ url });

    const second = await api("/urls", {
      method: "POST",
      body: { url, custom_code: customCode },
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    expect(secondBody.code).toBe(first.code);
  });
});
