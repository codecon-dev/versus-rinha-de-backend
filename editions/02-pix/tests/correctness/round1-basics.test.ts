import { describe, it, expect } from "vitest";
import {
  api,
  accountId,
  createAccount,
  transfer,
  getTransfer,
  statement,
  settle,
  idempotencyKey,
  type Transfer,
} from "./helpers.ts";


describe("Prova 1 — Transferência simples", () => {
  it("health-check: GET /health retorna ok", async () => {
    const res = await api("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("create-account-basic: POST /accounts cria conta com saldo inicial", async () => {
    const id = accountId();
    const res = await api("/accounts", {
      method: "POST",
      body: { id, balance: 100_000 },
    });

    expect(res.status).toBe(201);
    const account = await res.json();
    expect(account.id).toBe(id);
    expect(account.balance).toBe(100_000);

    const stmt = await statement(id);
    expect(stmt.balance).toBe(100_000);
  });

  it("create-account-zero: saldo inicial zero é válido", async () => {
    const id = accountId();
    const res = await api("/accounts", {
      method: "POST",
      body: { id, balance: 0 },
    });
    expect(res.status).toBe(201);
  });

  it("create-account-duplicate: id repetido retorna 409", async () => {
    const id = accountId();
    await createAccount(1000, id);

    const res = await api("/accounts", {
      method: "POST",
      body: { id, balance: 5000 },
    });
    expect(res.status).toBe(409);
  });

  it("create-account-invalid: payload inválido retorna 422", async () => {
    const noId = await api("/accounts", { method: "POST", body: { balance: 100 } });
    expect(noId.status).toBe(422);

    const emptyId = await api("/accounts", {
      method: "POST",
      body: { id: "", balance: 100 },
    });
    expect(emptyId.status).toBe(422);

    const noBalance = await api("/accounts", {
      method: "POST",
      body: { id: accountId() },
    });
    expect(noBalance.status).toBe(422);

    const negative = await api("/accounts", {
      method: "POST",
      body: { id: accountId(), balance: -1 },
    });
    expect(negative.status).toBe(422);

    const fractional = await api("/accounts", {
      method: "POST",
      body: { id: accountId(), balance: 10.5 },
    });
    expect(fractional.status).toBe(422);
  });

  it("transfer-basic: POST /transfers cria a transferência em pending", async () => {
    const payer = await createAccount(100_000);
    const payee = await createAccount(0);
    const key = idempotencyKey();

    const res = await api("/transfers", {
      method: "POST",
      body: { payerId: payer.id, payeeId: payee.id, amount: 2500, idempotencyKey: key },
    });

    expect([200, 201]).toContain(res.status);
    const t = await res.json();

    expect(t.id).toBeTruthy();
    expect(t.payerId).toBe(payer.id);
    expect(t.payeeId).toBe(payee.id);
    expect(t.amount).toBe(2500);
    expect(t.idempotencyKey).toBe(key);
    expect(t.status).toBe("pending");
    expect(t.failureReason).toBeNull();
    expect(t.createdAt).toBeTruthy();
  });

  it("non-blocking-post: o POST responde pending, sem esperar a liquidação", async () => {
    const payer = await createAccount(1_000_000);
    const payee = await createAccount(0);

    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        api("/transfers", {
          method: "POST",
          body: {
            payerId: payer.id,
            payeeId: payee.id,
            amount: 100,
            idempotencyKey: idempotencyKey(),
          },
        }),
      ),
    );

    const bodies = await Promise.all(responses.map((r) => r.json()));

    for (const res of responses) expect([200, 201]).toContain(res.status);
    for (const t of bodies) expect(t.status).toBe("pending");

    await settle(bodies.map((t) => t.id));
  });

  it("transfer-settles: o worker liquida e move o dinheiro", async () => {
    const payer = await createAccount(100_000);
    const payee = await createAccount(20_000);

    const t = await transfer({ payerId: payer.id, payeeId: payee.id, amount: 2500 });
    const [settled] = await settle([t.id]);

    expect(settled.status).toBe("completed");
    expect(settled.failureReason).toBeNull();

    expect((await statement(payer.id)).balance).toBe(97_500);
    expect((await statement(payee.id)).balance).toBe(22_500);
  });

  it("get-transfer: GET /transfers/{id} devolve o status atual", async () => {
    const payer = await createAccount(10_000);
    const payee = await createAccount(0);

    const created = await transfer({ payerId: payer.id, payeeId: payee.id, amount: 1000 });
    const fetched = await getTransfer(created.id);

    expect(fetched.id).toBe(created.id);
    expect(fetched.amount).toBe(1000);

    await settle([created.id]);
    expect((await getTransfer(created.id)).status).toBe("completed");
  });

  it("get-transfer-missing: transferência inexistente retorna 404", async () => {
    const res = await api("/transfers/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  it("statement-missing: extrato de conta inexistente retorna 404", async () => {
    const res = await api(`/accounts/${accountId("ghost")}/statement`);
    expect(res.status).toBe(404);
  });

  it("statement-empty: conta sem movimento retorna saldo inicial e lista vazia", async () => {
    const acc = await createAccount(50_000);

    const stmt = await statement(acc.id);
    expect(stmt.accountId).toBe(acc.id);
    expect(stmt.balance).toBe(50_000);
    expect(stmt.transfers).toEqual([]);
  });

  it("statement-both-sides: extrato traz o que a conta pagou e o que recebeu", async () => {
    const a = await createAccount(100_000);
    const b = await createAccount(100_000);

    const out = await transfer({ payerId: a.id, payeeId: b.id, amount: 3000 });
    const incoming = await transfer({ payerId: b.id, payeeId: a.id, amount: 1000 });
    await settle([out.id, incoming.id]);

    const stmt = await statement(a.id);
    const ids = stmt.transfers.map((t) => t.id).sort();
    expect(ids).toEqual([out.id, incoming.id].sort());
    expect(stmt.balance).toBe(100_000 - 3000 + 1000);
  });

  it("statement-only-completed: pendentes e falhas ficam fora do extrato", async () => {
    const rich = await createAccount(10_000);
    const poor = await createAccount(0);
    const dest = await createAccount(0);

    const ok = await transfer({ payerId: rich.id, payeeId: dest.id, amount: 1000 });
    const broke = await transfer({ payerId: poor.id, payeeId: dest.id, amount: 5000 });
    await settle([ok.id, broke.id]);

    const stmt = await statement(dest.id);
    expect(stmt.transfers.map((t) => t.id)).toEqual([ok.id]);
    for (const t of stmt.transfers) {
      expect(t.status).toBe("completed");
    }
  });

  it("statement-order: extrato vem do mais recente para o mais antigo", async () => {
    const payer = await createAccount(100_000);
    const payee = await createAccount(0);

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = await transfer({ payerId: payer.id, payeeId: payee.id, amount: 100 });
      ids.push(t.id);
    }
    await settle(ids);

    const stmt = await statement(payee.id);
    expect(stmt.transfers).toHaveLength(5);

    const times = stmt.transfers.map((t) => new Date(t.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

});
