import test from "node:test";
import assert from "node:assert/strict";

let server;
let baseUrl;

test.before(async () => {
  process.env.VERCEL = "1";
  process.env.CRON_SECRET = "unit-test-secret";

  const { default: app } = await import("../server.js");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  delete process.env.CRON_SECRET;
  delete process.env.VERCEL;
});

test("rejects unauthenticated /api/alerts/btc when CRON_SECRET is set", async () => {
  const response = await fetch(`${baseUrl}/api/alerts/btc?provider=auto`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.match(body.error, /Unauthorized cron request/i);
});

test("accepts x-cron-secret auth on /api/alerts/btc", async () => {
  const response = await fetch(`${baseUrl}/api/alerts/btc?provider=invalid`, {
    headers: { "x-cron-secret": "unit-test-secret" }
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Unsupported provider/i);
});

test("accepts bearer auth on /api/alerts/btc", async () => {
  const response = await fetch(`${baseUrl}/api/alerts/btc?provider=invalid`, {
    headers: { Authorization: "Bearer unit-test-secret" }
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Unsupported provider/i);
});
