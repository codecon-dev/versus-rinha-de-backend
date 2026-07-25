import { describe, it, expect } from "vitest";
import {
  api,
  createAccount,
  statement,
  settle,
  totalBalance,
  idempotencyKey,
  fireConcurrent,
  replayStatement,
  type Transfer,
} from "./helpers.ts";

describe("Prova 4 — Concorrência", () => {
  it("concurrent-overdraft-200: 200 transferências de R$1 sobre saldo de R$100", async () => {
    const payer = await createAccount(100_00); // R$ 100,00
    const payee = await createAccount(0);

    const responses = await fireConcurrent(200, () => ({
      payerId: payer.id,
      payeeId: payee.id,
      amount: 100, // R$ 1,00
      idempotencyKey: idempotencyKey("overdraft"),
    }));

    for (const res of responses) expect([200, 201]).toContain(res.status);
    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));

    const settled = await settle(created.map((t) => t.id));
    const completed = settled.filter((t) => t.status === "completed");
    const failed = settled.filter((t) => t.status === "failed");

    expect(completed).toHaveLength(100);
    expect(failed).toHaveLength(100);
    for (const t of failed) expect(t.failureReason).toBe("insufficient_funds");

    expect((await statement(payer.id)).balance).toBe(0);
    expect((await statement(payee.id)).balance).toBe(100_00);
  });

  it("exact-balance-race: saldo para uma só, duas concorrentes, uma completa e uma falha", async () => {
    for (let round = 0; round < 5; round++) {
      const payer = await createAccount(5000);
      const payee = await createAccount(0);

      const responses = await fireConcurrent(2, () => ({
        payerId: payer.id,
        payeeId: payee.id,
        amount: 5000,
        idempotencyKey: idempotencyKey("race"),
      }));

      const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
      const settled = await settle(created.map((t) => t.id));

      const completed = settled.filter((t) => t.status === "completed");
      expect(completed, `rodada ${round}`).toHaveLength(1);
      expect(settled.filter((t) => t.status === "failed")).toHaveLength(1);

      expect((await statement(payer.id)).balance).toBe(0);
      expect((await statement(payee.id)).balance).toBe(5000);
    }
  });

  it("circular-transfers: A→B, B→C, C→A sob concorrência conservam o total", async () => {
    const a = await createAccount(50_000);
    const b = await createAccount(50_000);
    const c = await createAccount(50_000);
    const accounts = [a.id, b.id, c.id];
    const initial = 150_000;

    const pairs: Array<[string, string]> = [
      [a.id, b.id],
      [b.id, c.id],
      [c.id, a.id],
    ];

    const responses = await Promise.all(
      Array.from({ length: 300 }, (_, i) => {
        const [payerId, payeeId] = pairs[i % pairs.length];
        return api("/transfers", {
          method: "POST",
          body: {
            payerId,
            payeeId,
            amount: 500,
            idempotencyKey: idempotencyKey("circular"),
          },
        });
      }),
    );

    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    await settle(created.map((t) => t.id));

    expect(await totalBalance(accounts)).toBe(initial);

    for (const id of accounts) {
      expect((await statement(id)).balance).toBeGreaterThanOrEqual(0);
    }
  });

  it("concurrent-drain-and-fill: saques e depósitos simultâneos não quebram o saldo", async () => {
    const hot = await createAccount(10_000);
    const other = await createAccount(10_000);
    const accounts = [hot.id, other.id];

    const responses = await Promise.all(
      Array.from({ length: 200 }, (_, i) => {
        const outgoing = i % 2 === 0;
        return api("/transfers", {
          method: "POST",
          body: {
            payerId: outgoing ? hot.id : other.id,
            payeeId: outgoing ? other.id : hot.id,
            amount: 200,
            idempotencyKey: idempotencyKey("churn"),
          },
        });
      }),
    );

    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    await settle(created.map((t) => t.id));

    expect(await totalBalance(accounts)).toBe(20_000);
    expect((await statement(hot.id)).balance).toBeGreaterThanOrEqual(0);
    expect((await statement(other.id)).balance).toBeGreaterThanOrEqual(0);
  });

  it("fan-in: 100 contas transferindo para a mesma conta ao mesmo tempo", async () => {
    const target = await createAccount(0);
    const payers = await Promise.all(
      Array.from({ length: 100 }, () => createAccount(1000)),
    );

    const responses = await Promise.all(
      payers.map((p) =>
        api("/transfers", {
          method: "POST",
          body: {
            payerId: p.id,
            payeeId: target.id,
            amount: 1000,
            idempotencyKey: idempotencyKey("fanin"),
          },
        }),
      ),
    );

    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    const settled = await settle(created.map((t) => t.id));

    expect(settled.every((t) => t.status === "completed")).toBe(true);
    expect((await statement(target.id)).balance).toBe(100_000);

    for (const p of payers.slice(0, 10)) {
      expect((await statement(p.id)).balance).toBe(0);
    }
  });

  it("conservation-total: nenhum centavo é criado ou perdido sob carga", async () => {
    const initialBalances = [80_000, 60_000, 40_000, 20_000, 0];
    const accounts = await Promise.all(
      initialBalances.map((b) => createAccount(b)),
    );
    const ids = accounts.map((a) => a.id);
    const initialTotal = initialBalances.reduce((a, b) => a + b, 0);

    expect(await totalBalance(ids)).toBe(initialTotal);

    const responses = await Promise.all(
      Array.from({ length: 400 }, (_, i) => {
        const payer = ids[i % ids.length];
        const payee = ids[(i * 3 + 1) % ids.length];
        if (payer === payee) return null;
        return api("/transfers", {
          method: "POST",
          body: {
            payerId: payer,
            payeeId: payee,
            amount: 100 + (i % 7) * 50,
            idempotencyKey: idempotencyKey("conserve"),
          },
        });
      }).filter((p): p is Promise<Response> => p !== null),
    );

    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    await settle(created.map((t) => t.id));

    expect(await totalBalance(ids)).toBe(initialTotal);
  });

  it("no-negative-balance: nenhuma conta fica negativa, nem a mais disputada", async () => {
    const victim = await createAccount(3000);
    const sinks = await Promise.all(
      Array.from({ length: 5 }, () => createAccount(0)),
    );

    const responses = await Promise.all(
      Array.from({ length: 150 }, (_, i) =>
        api("/transfers", {
          method: "POST",
          body: {
            payerId: victim.id,
            payeeId: sinks[i % sinks.length].id,
            amount: 500,
            idempotencyKey: idempotencyKey("drain"),
          },
        }),
      ),
    );

    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    const settled = await settle(created.map((t) => t.id));

    // Saldo de R$30 e saques de R$5: exatamente 6 podem passar
    expect(settled.filter((t) => t.status === "completed")).toHaveLength(6);

    const finalBalance = (await statement(victim.id)).balance;
    expect(finalBalance).toBe(0);
    expect(finalBalance).toBeGreaterThanOrEqual(0);

    for (const s of sinks) {
      expect((await statement(s.id)).balance).toBeGreaterThanOrEqual(0);
    }

    const all = [victim.id, ...sinks.map((s) => s.id)];
    expect(await totalBalance(all)).toBe(3000);
  });

  it("statement-consistency: o saldo bate com o replay das transferências do extrato", async () => {
    const a = await createAccount(70_000);
    const b = await createAccount(30_000);
    const c = await createAccount(10_000);

    const plan: Array<[string, string, number]> = [];
    for (let i = 0; i < 60; i++) {
      if (i % 3 === 0) plan.push([a.id, b.id, 300]);
      else if (i % 3 === 1) plan.push([b.id, c.id, 200]);
      else plan.push([c.id, a.id, 100]);
    }

    const responses = await Promise.all(
      plan.map(([payerId, payeeId, amount]) =>
        api("/transfers", {
          method: "POST",
          body: {
            payerId,
            payeeId,
            amount,
            idempotencyKey: idempotencyKey("consistency"),
          },
        }),
      ),
    );

    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    await settle(created.map((t) => t.id));

    for (const [account, initial] of [
      [a.id, 70_000],
      [b.id, 30_000],
      [c.id, 10_000],
    ] as const) {
      const stmt = await statement(account);
      expect(stmt.transfers.every((t) => t.status === "completed")).toBe(true);
      expect(replayStatement(account, initial, stmt.transfers)).toBe(stmt.balance);
    }
  });

});
