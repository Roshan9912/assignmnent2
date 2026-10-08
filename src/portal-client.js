export class PortalError extends Error {
  constructor(message, { status = 502, code = "upstream_error", cause } = {}) {
    super(message, { cause });
    this.name = "PortalError";
    this.status = status;
    this.code = code;
  }
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/);
}

export class PortalClient {
  constructor({
    baseUrl,
    email,
    password,
    timeoutMs = 10000,
    fetchImpl = fetch
  }) {
    if (!baseUrl || !email || !password) {
      throw new Error("PORTAL_BASE_URL, PORTAL_EMAIL, and PORTAL_PASSWORD are required");
    }
    this.baseUrl = new URL(baseUrl);
    this.baseUrl.pathname = this.baseUrl.pathname.replace(/\/+$/, "");
    this.email = email;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.cookies = new Map();
    this.authenticated = false;
    this.loginPromise = null;
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  storeCookies(headers) {
    const cookieHeaders = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitSetCookieHeader(headers.get("set-cookie"));

    for (const header of cookieHeaders) {
      const [pair, ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) continue;

      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1);
      const expired = attributes.some((attribute) =>
        /^\s*max-age=0(?:\s|$)/i.test(attribute)
      );
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async fetch(url, options = {}) {
    try {
      const response = await this.fetchImpl(url, {
        ...options,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      this.storeCookies(response.headers);
      return response;
    } catch (error) {
      if (error instanceof PortalError) throw error;
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new PortalError(
        timeout ? "The Urja portal request timed out" : "The Urja portal could not be reached",
        { code: timeout ? "upstream_timeout" : "upstream_unavailable", cause: error }
      );
    }
  }

  async login() {
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      const loginUrl = new URL("/login", this.baseUrl);
      await this.fetch(loginUrl);
      const response = await this.fetch(loginUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: this.baseUrl.origin,
          referer: loginUrl.href,
          cookie: this.cookieHeader()
        },
        body: new URLSearchParams({
          email: this.email,
          password: this.password
        })
      });
      const body = await response.text();

      if (!response.ok) {
        throw new PortalError("The Urja portal rejected the login request", {
          code: "upstream_auth_failed"
        });
      }

      let action;
      try {
        action = JSON.parse(body);
      } catch {
        action = null;
      }
      if (action?.type === "failure" || action?.type === "error") {
        throw new PortalError("The Urja portal rejected the configured credentials", {
          code: "upstream_auth_failed"
        });
      }
      if (action?.type === "redirect" && typeof action.location !== "string") {
        throw new PortalError("The Urja portal returned an invalid login response", {
          code: "upstream_auth_failed"
        });
      }

      this.authenticated = true;
    })();

    try {
      await this.loginPromise;
    } catch (error) {
      this.authenticated = false;
      this.cookies.clear();
      throw error;
    } finally {
      this.loginPromise = null;
    }
  }

  async request(path, { accept = "application/json" } = {}) {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new Error("Portal request paths must stay on the configured origin");
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.authenticated) await this.login();
      const response = await this.fetch(url, {
        headers: {
          accept,
          cookie: this.cookieHeader(),
          referer: new URL("/meters", this.baseUrl).href
        }
      });
      const location = response.headers.get("location") || "";
      const expired = response.status === 401 ||
        response.status === 403 ||
        (response.status >= 300 && /\/login(?:[/?#]|$)/.test(location));

      if (expired && attempt === 0) {
        this.authenticated = false;
        this.cookies.clear();
        continue;
      }
      if (expired) {
        throw new PortalError("The Urja portal session could not be renewed", {
          code: "upstream_auth_failed"
        });
      }
      if (response.status >= 300 && response.status < 400) {
        throw new PortalError("The Urja portal redirected an API request unexpectedly", {
          code: "upstream_unexpected_redirect"
        });
      }
      if (!response.ok) {
        throw new PortalError(`The Urja portal returned HTTP ${response.status}`, {
          code: "upstream_http_error"
        });
      }
      return response;
    }

    throw new PortalError("The Urja portal session could not be renewed", {
      code: "upstream_auth_failed"
    });
  }

  async getJson(path) {
    const response = await this.request(path);
    try {
      return await response.json();
    } catch (error) {
      throw new PortalError("The Urja portal returned invalid JSON", {
        code: "upstream_invalid_response",
        cause: error
      });
    }
  }

  async getHtml(path) {
    const response = await this.request(path, { accept: "text/html" });
    return response.text();
  }
}
