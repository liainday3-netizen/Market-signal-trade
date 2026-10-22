// Attaches the admin token to every /api request made by the dashboard.
// The server rejects control actions (start/stop, live mode, wallet, risk,
// kill switch) without it. The token is stored only in this browser.
const KEY = "mst.adminToken";

export function getAdminToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token.trim());
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}

function isApiRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

let _prompting = false;

export function installAdminFetch(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiRequest(input)) return original(input, init);
    const withToken = (): RequestInit => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const token = getAdminToken();
      if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
      return { ...init, headers };
    };
    let res = await original(input, withToken());
    if (res.status === 401 && !_prompting) {
      _prompting = true;
      try {
        const entered = window.prompt("Admin token required for this action. Enter your ADMIN_TOKEN:");
        if (entered) {
          setAdminToken(entered);
          res = await original(input, withToken());
        }
      } finally {
        _prompting = false;
      }
    }
    return res;
  };
}
