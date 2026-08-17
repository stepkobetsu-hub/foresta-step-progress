import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

test("browser dashboard reads use the same Google store as browser writes", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) });
    return Response.json({ success: true, data: { marker: "google-dashboard" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://local.invalid/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "getStudentDashboard", token: "test-token" }),
      }),
      { GOOGLE_API_URL: "https://google.invalid/exec" },
      { waitUntil() {} },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-data-source"), "google-v83");
    assert.deepEqual(await response.json(), {
      success: true,
      data: { marker: "google-dashboard" },
    });
    assert.deepEqual(calls, [{
      url: "https://google.invalid/exec",
      body: { action: "getStudentDashboard", token: "test-token" },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
