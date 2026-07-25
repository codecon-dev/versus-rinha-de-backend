import { describe, it, expect } from "vitest";
import {
  api,
  accountId,
  createAccount,
  transfer,
  statement,
  settle,
  idempotencyKey,
  type Transfer,
} from "./helpers.ts";


describe("Prova 2 — Saldo insuficiente", () => {
  it("insufficient-funds: saldo insuficiente vira failed sem mover dinheiro", async () => {
    const payer = await createAccount(1000);
    const payee = await createAccount(500);

    const t = await transfer({ payerId: payer.id, payeeId: payee.id, amount: 5000 });
    const [settled] = await settle([t.id]);

    expect(settled.status).toBe("failed");
    expect(settled.failureReason).toBe("insufficient_funds");

    expect((await statement(payer.id)).balance).toBe(1000);
    expect((await statement(payee.id)).balance).toBe(500);
  });

  it("failed-moves-nothing: transferências reprovadas não alteram saldo nenhum", async () => {
    const payer = await createAccount(1000);
    const payee = await createAccount(2000);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        api("/transfers", {
          method: "POST",
          body: {
            payerId: payer.id,
            payeeId: payee.id,
            amount: 99_999,
            idempotencyKey: idempotencyKey("nofunds"),
          },
        }),
      ),
    );

    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    const settled = await settle(created.map((t) => t.id));

    expect(settled.every((t) => t.status === "failed")).toBe(true);
    for (const t of settled) expect(t.failureReason).toBe("insufficient_funds");

    expect((await statement(payer.id)).balance).toBe(1000);
    expect((await statement(payee.id)).balance).toBe(2000);
    expect((await statement(payee.id)).transfers).toEqual([]);
  });

  it("transfer-exact-balance: transferir o saldo exato zera a conta e completa", async () => {
    const payer = await createAccount(7_777);
    const payee = await createAccount(0);

    const t = await transfer({ payerId: payer.id, payeeId: payee.id, amount: 7_777 });
    const [settled] = await settle([t.id]);

    expect(settled.status).toBe("completed");
    expect((await statement(payer.id)).balance).toBe(0);
    expect((await statement(payee.id)).balance).toBe(7_777);
  });

  it("validation-amount: valor zero, negativo ou fracionário retorna 422", async () => {
    const payer = await createAccount(100_000);
    const payee = await createAccount(0);
    const base = { payerId: payer.id, payeeId: payee.id };

    for (const amount of [0, -1, -5000, 10.5]) {
      const res = await api("/transfers", {
        method: "POST",
        body: { ...base, amount, idempotencyKey: idempotencyKey() },
      });
      expect(res.status, `amount=${amount}`).toBe(422);
    }
  });

  it("validation-unknown-account: conta inexistente retorna 422", async () => {
    const real = await createAccount(100_000);

    const noPayer = await api("/transfers", {
      method: "POST",
      body: {
        payerId: accountId("ghost"),
        payeeId: real.id,
        amount: 1000,
        idempotencyKey: idempotencyKey(),
      },
    });
    expect(noPayer.status).toBe(422);

    const noPayee = await api("/transfers", {
      method: "POST",
      body: {
        payerId: real.id,
        payeeId: accountId("ghost"),
        amount: 1000,
        idempotencyKey: idempotencyKey(),
      },
    });
    expect(noPayee.status).toBe(422);

    // Nada foi movido
    expect((await statement(real.id)).balance).toBe(100_000);
  });

  it("validation-missing-fields: campo obrigatório ausente retorna 422", async () => {
    const payer = await createAccount(100_000);
    const payee = await createAccount(0);

    const bodies = [
      { payeeId: payee.id, amount: 1000, idempotencyKey: idempotencyKey() },
      { payerId: payer.id, amount: 1000, idempotencyKey: idempotencyKey() },
      { payerId: payer.id, payeeId: payee.id, idempotencyKey: idempotencyKey() },
    ];

    for (const body of bodies) {
      const res = await api("/transfers", { method: "POST", body });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it("validation-self-transfer: payer igual a payee retorna 422", async () => {
    const acc = await createAccount(100_000);

    const res = await api("/transfers", {
      method: "POST",
      body: {
        payerId: acc.id,
        payeeId: acc.id,
        amount: 1000,
        idempotencyKey: idempotencyKey(),
      },
    });
    expect(res.status).toBe(422);
    expect((await statement(acc.id)).balance).toBe(100_000);
  });

});
