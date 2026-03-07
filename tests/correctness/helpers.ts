const BASE_URL = process.env.API_URL || "http://localhost:3000";

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  redirect?: RequestRedirect;
}

export async function api(
  path: string,
  opts: RequestOptions = {},
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  };

  return fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: opts.redirect ?? "manual",
  });
}

export async function createUrl(
  data: {
    url: string;
    custom_code?: string;
    expires_at?: string;
  } = { url: "https://example.com" },
): Promise<any> {
  const res = await api("/urls", { method: "POST", body: data });
  if (![200, 201].includes(res.status)) {
    const text = await res.text();
    throw new Error(`Create failed with ${res.status}: ${text}`);
  }
  return res.json();
}

export async function cleanup(): Promise<void> {
  // List all URLs and delete them
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const res = await api(`/urls?page=${page}&per_page=100`);
      if (res.status !== 200) break;
      const body = await res.json();
      const urls = body.data ?? [];
      for (const url of urls) {
        await api(`/urls/${url.id}`, { method: "DELETE" });
      }
      hasMore = urls.length === 100;
      page++;
    }
  } catch {
    // ignore cleanup errors
  }
}

export function futureDate(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function pastDate(hours = 1): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function randomCode(length = 6): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export { BASE_URL };
