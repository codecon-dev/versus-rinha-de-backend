import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { randomString } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const OUTPUT_FILE = __ENV.OUTPUT_FILE || "throughput-results.json";

export const options = {
  stages: [
    { duration: "10s", target: 50 },
    { duration: "30s", target: 200 },
    { duration: "10s", target: 0 },
  ],
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
      JSON.stringify({ url: `https://example.com/page/${i}` }),
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

  if (rand < 0.55) {
    // 55% redirect (high volume to test caching)
    const url = urls[Math.floor(Math.random() * urls.length)];
    const res = http.get(`${BASE_URL}/${url.code}`, { redirects: 0 });
    check(res, {
      "redirect status 301": (r) => r.status === 301,
    });
  } else if (rand < 0.70) {
    // 15% create (mix of new and duplicate URLs to test idempotency)
    const isRepeat = Math.random() < 0.3;
    const targetUrl = isRepeat
      ? `https://example.com/page/${Math.floor(Math.random() * 100)}`
      : `https://example.com/load/${randomString(8)}`;
    const res = http.post(
      `${BASE_URL}/urls`,
      JSON.stringify({ url: targetUrl }),
      { headers: { "Content-Type": "application/json" } }
    );
    check(res, {
      "create status ok": (r) => r.status === 201 || r.status === 200,
    });
  } else if (rand < 0.80) {
    // 10% get details
    const url = urls[Math.floor(Math.random() * urls.length)];
    const res = http.get(`${BASE_URL}/urls/${url.id}`);
    check(res, {
      "get status 200": (r) => r.status === 200,
    });
  } else if (rand < 0.90) {
    // 10% stats
    const url = urls[Math.floor(Math.random() * urls.length)];
    const res = http.get(`${BASE_URL}/urls/${url.id}/stats`);
    check(res, {
      "stats status 200": (r) => r.status === 200,
    });
  } else {
    // 10% QR code
    const url = urls[Math.floor(Math.random() * urls.length)];
    const res = http.get(`${BASE_URL}/urls/${url.id}/qr`);
    check(res, {
      "qr status 200": (r) => r.status === 200,
    });
  }
}

export function handleSummary(data) {
  // Calculate error rate
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
    stdout: textSummary(data, { indent: "  ", enableColors: true }),
  };
}

function textSummary(data, opts) {
  // Minimal text summary
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
