import { describe, it, expect } from "vitest";
import {
  api,
  createAccount,
  statement,
  settle,
  idempotencyKey,
  fireConcurrent,
  type Transfer,
} from "./helpers.ts";


describe("Prova 3 — Idempotência", () => {
  it("idempotent-transfer: mesma idempotencyKey retorna 200 com a transferência original", async () => {
    const payer = await createAccount(100_000);
    const payee = await createAccount(0);
    const key = idempotencyKey();

    const first = await api("/transfers", {
      method: "POST",
      body: { payerId: payer.id, payeeId: payee.id, amount: 2500, idempotencyKey: key },
    });
    expect([200, 201]).toContain(first.status);
    const original = await first.json();

    const second = await api("/transfers", {
      method: "POST",
      body: { payerId: payer.id, payeeId: payee.id, amount: 9999, idempotencyKey: key },
    });
    expect(second.status).toBe(200);
    const repeated = await second.json();

    expect(repeated.id).toBe(original.id);
    expect(repeated.amount).toBe(2500); // o corpo repetido não altera a original

    await settle([original.id]);
    expect((await statement(payer.id)).balance).toBe(97_500); // um único débito
  });

  it("idempotent-transfer-50: mesma chave 50 vezes em paralelo gera um único débito", async () => {
    const payer = await createAccount(100_000);
    const payee = await createAccount(0);
    const key = idempotencyKey("dedupe");

    const responses = await fireConcurrent(50, () => ({
      payerId: payer.id,
      payeeId: payee.id,
      amount: 2500,
      idempotencyKey: key,
    }));

    const statuses = responses.map((r) => r.status);
    // aceita 200 ou 201 na criação; o que importa é o débito único, checado abaixo
    for (const s of statuses) expect([200, 201]).toContain(s);
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(1);

    const bodies: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    const ids = new Set(bodies.map((t) => t.id));
    expect(ids.size).toBe(1);

    await settle([...ids]);

    expect((await statement(payer.id)).balance).toBe(97_500);
    expect((await statement(payee.id)).balance).toBe(2500);
  });

  it("no-double-settle: transferência liquidada não é reprocessada", async () => {
    const payer = await createAccount(10_000);
    const payee = await createAccount(0);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        api("/transfers", {
          method: "POST",
          body: {
            payerId: payer.id,
            payeeId: payee.id,
            amount: 500,
            idempotencyKey: idempotencyKey("once"),
          },
        }),
      ),
    );

    const created: Transfer[] = await Promise.all(responses.map((r) => r.json()));
    await settle(created.map((t) => t.id));

    const afterSettle = (await statement(payee.id)).balance;
    expect(afterSettle).toBe(5000);

    // Uma janela extra de worker não pode mexer em nada
    await new Promise((r) => setTimeout(r, 2000));

    expect((await statement(payee.id)).balance).toBe(5000);
    expect((await statement(payer.id)).balance).toBe(5000);
    expect((await statement(payee.id)).transfers).toHaveLength(10);
  });

});
