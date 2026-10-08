import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";

async function withApp(client, run) {
  const server = createApp(client).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));
  }
}

test("returns a normalized meter page and validates pagination", async () => {
  const client = {
    async getJson(path) {
      assert.match(path, /^\/portal\/meters\/search\?/);
      return {
        data: [{
          meterId: "J100000",
          serialNo: "SE33962",
          make: "HPL",
          phaseType: "single",
          installStatus: "Decommissioned",
          dtCode: "DT-001"
        }],
        total: 403,
        page: 1,
        pageSize: 20
      };
    }
  };
  await withApp(client, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/meters?q=J100000`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data[0].meter_id, "J100000");

    const invalid = await fetch(`${baseUrl}/api/v1/meters?page=0`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "invalid_query");
  });
});

test("returns a not-found error for an unknown meter without loading its page", async () => {
  const client = {
    async getJson() {
      return { data: [] };
    },
    async getHtml() {
      assert.fail("Must not load a detail page for an unknown meter");
    }
  };
  await withApp(client, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/meters/J999999`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "meter_not_found");
  });
});
