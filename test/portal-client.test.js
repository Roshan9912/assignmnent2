import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PortalClient } from "../src/portal-client.js";

async function withPortal(handler, run) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => handler(request, response, body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));
  }
}

test("logs in with a form, persists the session cookie, and requests JSON", async () => {
  let loginCount = 0;
  await withPortal((request, response, body) => {
    if (request.url === "/login" && request.method === "GET") {
      response.writeHead(200).end("login");
      return;
    }
    if (request.url === "/login" && request.method === "POST") {
      loginCount += 1;
      assert.equal(new URLSearchParams(body).get("email"), "operator@example.test");
      assert.equal(new URLSearchParams(body).get("password"), "secret");
      response.writeHead(200, { "set-cookie": "session=abc; Path=/; HttpOnly" });
      response.end(JSON.stringify({ type: "redirect", status: 303, location: "/meters" }));
      return;
    }
    assert.equal(request.headers.cookie, "session=abc");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [] }));
  }, async (baseUrl) => {
    const client = new PortalClient({
      baseUrl,
      email: "operator@example.test",
      password: "secret"
    });
    assert.deepEqual(await client.getJson("/portal/meters/search?q=&page=1"), { data: [] });
    assert.equal(loginCount, 1);
  });
});

test("renews an expired session once and retries the request", async () => {
  let loginCount = 0;
  let protectedRequests = 0;
  await withPortal((request, response) => {
    if (request.url === "/login" && request.method === "GET") {
      response.writeHead(200).end("login");
      return;
    }
    if (request.url === "/login" && request.method === "POST") {
      loginCount += 1;
      response.writeHead(200, { "set-cookie": `session=token-${loginCount}; Path=/` });
      response.end(JSON.stringify({ type: "redirect", status: 303, location: "/meters" }));
      return;
    }
    protectedRequests += 1;
    if (protectedRequests === 1) {
      response.writeHead(401).end();
      return;
    }
    assert.equal(request.headers.cookie, "session=token-2");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  }, async (baseUrl) => {
    const client = new PortalClient({ baseUrl, email: "user", password: "password" });
    assert.deepEqual(await client.getJson("/protected"), { ok: true });
    assert.equal(loginCount, 2);
    assert.equal(protectedRequests, 2);
  });
});
