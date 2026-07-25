import http from "k6/http";
import { check } from "k6";

const BASE_URL =
  __ENV.BASE_URL || `http://${__ENV.APP_HOST || "localhost"}:3000`;
const OUTPUT_FILE = __ENV.OUTPUT_FILE || "latency-results.json";

export const options = {
  // k6 v1 só emite p(90)/p(95) por padrão — o scorer precisa de p50/p95/p99
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(95)", "p(99)"],
  scenarios: {
    constant: {
      executor: "constant-vus",
      vus: 50,
      duration: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.50"],
  },
};

const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };
const ACCOUNTS = 50;
const SEED_BALANCE = 100000000;

export function setup() {
  const ids = [];
  const transferIds = [];

  for (let i = 0; i < ACCOUNTS; i++) {
    const id = `lat-${Date.now().toString(36)}-${i}`;
    const res = http.post(
      `${BASE_URL}/accounts`,
      JSON.stringify({ id, balance: SEED_BALANCE }),
      JSON_HEADERS,
    );
    if (res.status === 200 || res.status === 201) ids.push(id);
  }

  // Algumas transferências para o GET /transfers/{id} ter o que consultar
  for (let i = 0; i < 50 && ids.length >= 2; i++) {
    const res = http.post(
      `${BASE_URL}/transfers`,
      JSON.stringify({
        payerId: ids[i % ids.length],
        payeeId: ids[(i + 1) % ids.length],
        amount: 500,
        idempotencyKey: `seed-${Date.now().toString(36)}-${i}`,
      }),
      JSON_HEADERS,
    );
    if (res.status === 200 || res.status === 201) transferIds.push(JSON.parse(res.body).id);
  }

  return { ids, transferIds };
}

export default function (data) {
  const ids = data.ids || [];
  const transferIds = data.transferIds || [];
  if (ids.length < 2) return;

  const rand = Math.random();

  if (rand < 0.60) {
    // 60% recebimento de transferências
    const payerIdx = Math.floor(Math.random() * ids.length);
    let payeeIdx = Math.floor(Math.random() * ids.length);
    if (payeeIdx === payerIdx) payeeIdx = (payeeIdx + 1) % ids.length;

    const res = http.post(
      `${BASE_URL}/transfers`,
      JSON.stringify({
        payerId: ids[payerIdx],
        payeeId: ids[payeeIdx],
        amount: 100 + Math.floor(Math.random() * 900),
        idempotencyKey: `k-${__VU}-${__ITER}-${Math.random().toString(36).slice(2)}`,
      }),
      JSON_HEADERS,
    );
    check(res, { "transfer status 200/201": (r) => r.status === 200 || r.status === 201 });
  } else if (rand < 0.85) {
    // 25% extrato
    const id = ids[Math.floor(Math.random() * ids.length)];
    const res = http.get(`${BASE_URL}/accounts/${id}/statement`);
    check(res, { "statement status 200": (r) => r.status === 200 });
  } else {
    // 15% consulta de transferência
    if (transferIds.length === 0) return;
    const id = transferIds[Math.floor(Math.random() * transferIds.length)];
    const res = http.get(`${BASE_URL}/transfers/${id}`);
    check(res, { "get transfer status 200": (r) => r.status === 200 });
  }
}

export function handleSummary(data) {
  const totalReqs = data.metrics.http_reqs?.values?.count || 0;
  const failedReqs = data.metrics.http_req_failed?.values?.passes || 0;
  const errorRate = totalReqs > 0 ? failedReqs / totalReqs : 0;

  const result = {
    metrics: data.metrics,
    errorRate: errorRate,
    state: data.state,
  };

  return {
    [OUTPUT_FILE]: JSON.stringify(result, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const dur = data.metrics.http_req_duration?.values;
  return [
    `\n  Latency Test Results:`,
    `  p50: ${(dur?.["p(50)"] || 0).toFixed(1)}ms`,
    `  p95: ${(dur?.["p(95)"] || 0).toFixed(1)}ms`,
    `  p99: ${(dur?.["p(99)"] || 0).toFixed(1)}ms`,
    ``,
  ].join("\n");
}
