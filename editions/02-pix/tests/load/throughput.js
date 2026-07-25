import http from "k6/http";
import { check } from "k6";

const BASE_URL =
  __ENV.BASE_URL || `http://${__ENV.APP_HOST || "localhost"}:3000`;
const OUTPUT_FILE = __ENV.OUTPUT_FILE || "throughput-results.json";

export const options = {
  // k6 v1 só emite p(90)/p(95) por padrão — o scorer precisa de p50/p95/p99
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(95)", "p(99)"],
  stages: [
    { duration: "10s", target: 50 },
    { duration: "30s", target: 200 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.50"],
  },
};

const JSON_HEADERS = { headers: { "Content-Type": "application/json" } };
const ACCOUNTS = 50;
const SEED_BALANCE = 100000000; // saldo alto: a carga mede vazão, não recusa

export function setup() {
  const ids = [];
  for (let i = 0; i < ACCOUNTS; i++) {
    const id = `load-${Date.now().toString(36)}-${i}`;
    const res = http.post(
      `${BASE_URL}/accounts`,
      JSON.stringify({ id, balance: SEED_BALANCE }),
      JSON_HEADERS,
    );
    if (res.status === 200 || res.status === 201) ids.push(id);
  }
  return { ids };
}

export default function (data) {
  const ids = data.ids || [];
  if (ids.length < 2) return;

  const rand = Math.random();

  if (rand < 0.70) {
    // 70% recebimento de transferências — o caminho quente
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
  } else {
    // 30% consulta de extrato
    const id = ids[Math.floor(Math.random() * ids.length)];
    const res = http.get(`${BASE_URL}/accounts/${id}/statement`);
    check(res, { "statement status 200": (r) => r.status === 200 });
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
  const reqs = data.metrics.http_reqs?.values;
  const dur = data.metrics.http_req_duration?.values;
  return [
    `\n  Throughput Test Results:`,
    `  Total requests: ${reqs?.count || 0}`,
    `  RPS: ${(reqs?.rate || 0).toFixed(1)}`,
    `  Avg duration: ${(dur?.avg || 0).toFixed(1)}ms`,
    `  p95 duration: ${(dur?.["p(95)"] || 0).toFixed(1)}ms`,
    ``,
  ].join("\n");
}
