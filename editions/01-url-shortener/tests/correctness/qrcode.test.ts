import { describe, it, expect, beforeEach } from "vitest";
import { api, createUrl, cleanup } from "./helpers.ts";

describe("QR Code operations", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it.skip("qr-code-basic: GET /urls/:id/qr returns base64 PNG QR code", async () => {
    const created = await createUrl({ url: "https://example.com/qr-test" });

    const res = await api(`/urls/${created.id}/qr`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("qr_code");
    expect(typeof body.qr_code).toBe("string");
    expect(body.qr_code.length).toBeGreaterThan(0);

    // Decode base64 and verify PNG magic bytes
    const buffer = Buffer.from(body.qr_code, "base64");
    expect(buffer.length).toBeGreaterThan(8);

    // PNG starts with: 137 80 78 71 13 10 26 10
    const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < pngMagic.length; i++) {
      expect(buffer[i]).toBe(pngMagic[i]);
    }
  });

  it("qr-code-not-found: GET /urls/:id/qr with unknown ID returns 404", async () => {
    const res = await api("/urls/00000000-0000-0000-0000-000000000000/qr");
    expect(res.status).toBe(404);
  });

  it("qr-code-different-urls: different URLs generate different QR codes", async () => {
    const url1 = await createUrl({ url: "https://example.com/qr-1" });
    const url2 = await createUrl({ url: "https://example.com/qr-2" });

    const [res1, res2] = await Promise.all([
      api(`/urls/${url1.id}/qr`),
      api(`/urls/${url2.id}/qr`),
    ]);

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.qr_code).not.toBe(body2.qr_code);
  });

  it("qr-code-content-type: GET /urls/:id/qr returns application/json", async () => {
    const created = await createUrl({ url: "https://example.com/qr-ct" });

    const res = await api(`/urls/${created.id}/qr`);
    expect(res.status).toBe(200);

    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("application/json");
  });
});
