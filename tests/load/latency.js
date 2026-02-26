import http from "k6/http";
import { check } from "k6";
import { randomString } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const OUTPUT_FILE = __ENV.OUTPUT_FILE || "latency-results.json";

export const options = {
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

let seedUrls = [];

export function setup() {
  // Create 100 seed URLs
  const urls = [];
  for (let i = 0; i < 100; i++) {
    const res = http.post(
      `${BASE_URL}/urls`,
      JSON.stringify({ url: `https://example.com/latency/${i}` }),
      { headers: { "Content-Type": "application/json" } }
    );
    if (res.status === 201) {
      urls.push(JSON.parse(res.body));
    }
  }
  return { urls };
}

export default function (data) {
  const urls = data.urls;
  if (!urls || urls.length === 0) return;

  const rand = Math.random();

  if (rand < 0.7) {
    // 70% redirect
    const url = urls[Math.floor(Math.random() * urls.length)];
    const res = http.get(`${BASE_URL}/${url.code}`, { redirects: 0 });
    check(res, {
      "redirect status 301": (r) => r.status === 301,
    });
  } else if (rand < 0.85) {
    // 15% create
    const res = http.post(
      `${BASE_URL}/urls`,
      JSON.stringify({ url: `https://example.com/lat/${randomString(8)}` }),
      { headers: { "Content-Type": "application/json" } }
    );
    check(res, {
      "create status 201": (r) => r.status === 201,
    });
  } else if (rand < 0.95) {
    // 10% get details
    const url = urls[Math.floor(Math.random() * urls.length)];
    const res = http.get(`${BASE_URL}/urls/${url.id}`);
    check(res, {
      "get status 200": (r) => r.status === 200,
    });
  } else {
    // 5% stats
    const url = urls[Math.floor(Math.random() * urls.length)];
    const res = http.get(`${BASE_URL}/urls/${url.id}/stats`);
    check(res, {
      "stats status 200": (r) => r.status === 200,
    });
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
