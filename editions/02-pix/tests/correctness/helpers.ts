const BASE_URL =
  process.env.API_URL ||
  `http://${process.env.APP_HOST ?? "localhost"}:3000`;

/** Quanto tempo esperar o worker liquidar antes de desistir. */
export const SETTLE_TIMEOUT_MS = 20_000;

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function api(
  path: string,
  opts: RequestOptions = {},
): Promise<Response> {
  const hasBody = opts.body !== undefined;

  // Content-Type só quando há corpo: mandar application/json numa requisição sem
  // corpo faz vários frameworks responderem 400 por "JSON vazio".
  const headers: Record<string, string> = {
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...opts.headers,
  };

  return fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
}

export type TransferStatus = "pending" | "completed" | "failed";

export interface Transfer {
  id: string;
  payerId: string;
  payeeId: string;
  amount: number;
  idempotencyKey: string | null;
  status: TransferStatus;
  failureReason: string | null;
  createdAt: string;
}

export interface Account {
  id: string;
  balance: number;
}

export interface Statement {
  accountId: string;
  balance: number;
  transfers: Transfer[];
}

let seq = 0;

/** Id único por execução, para os cenários não interferirem uns nos outros. */
export function accountId(prefix = "acc"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function idempotencyKey(prefix = "key"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export async function createAccount(
  balance: number,
  id = accountId(),
): Promise<Account> {
  const res = await api("/accounts", { method: "POST", body: { id, balance } });
  if (res.status !== 201) {
    throw new Error(`createAccount falhou com ${res.status}: ${await res.text()}`);
  }
  return { id, balance };
}

export interface TransferInput {
  payerId: string;
  payeeId: string;
  amount: number;
  idempotencyKey?: string;
}

export async function transfer(input: TransferInput): Promise<Transfer> {
  const body = { idempotencyKey: idempotencyKey(), ...input };
  const res = await api("/transfers", { method: "POST", body });
  if (![200, 201].includes(res.status)) {
    throw new Error(`transfer falhou com ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function getTransfer(id: string): Promise<Transfer> {
  const res = await api(`/transfers/${id}`);
  if (res.status !== 200) {
    throw new Error(`getTransfer falhou com ${res.status}`);
  }
  return res.json();
}

export async function statement(id: string): Promise<Statement> {
  const res = await api(`/accounts/${id}/statement`);
  if (res.status !== 200) {
    throw new Error(`statement falhou com ${res.status}`);
  }
  return res.json();
}

export async function balanceOf(id: string): Promise<number> {
  return (await statement(id)).balance;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Espera o worker liquidar as transferências indicadas (nenhuma mais `pending`).
 * Estoura se passar de SETTLE_TIMEOUT_MS — worker que não liquida é falha.
 */
export async function settle(ids: string[]): Promise<Transfer[]> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let pending = [...ids];
  const settled = new Map<string, Transfer>();

  while (pending.length > 0) {
    const results = await Promise.all(pending.map((id) => getTransfer(id)));
    const stillPending: string[] = [];

    for (const t of results) {
      if (t.status === "pending") stillPending.push(t.id);
      else settled.set(t.id, t);
    }

    pending = stillPending;
    if (pending.length === 0) break;

    if (Date.now() > deadline) {
      throw new Error(
        `${pending.length} de ${ids.length} transferências continuaram pending após ${SETTLE_TIMEOUT_MS}ms`,
      );
    }
    await sleep(100);
  }

  return ids.map((id) => settled.get(id)!);
}

/** Soma dos saldos das contas indicadas. */
export async function totalBalance(ids: string[]): Promise<number> {
  const balances = await Promise.all(ids.map((id) => balanceOf(id)));
  return balances.reduce((a, b) => a + b, 0);
}

/** Dispara N transferências em paralelo e devolve as respostas cruas. */
export async function fireConcurrent(
  count: number,
  build: (i: number) => Record<string, unknown>,
): Promise<Response[]> {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      api("/transfers", { method: "POST", body: build(i) }),
    ),
  );
}

/** Aplica ao saldo inicial as transferências completed do extrato. */
export function replayStatement(
  account: string,
  initial: number,
  transfers: Transfer[],
): number {
  return transfers.reduce((balance, t) => {
    if (t.payerId === account) return balance - t.amount;
    if (t.payeeId === account) return balance + t.amount;
    return balance;
  }, initial);
}

export { BASE_URL };
