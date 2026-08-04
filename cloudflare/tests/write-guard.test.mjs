import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

test("student 1320 save endpoints remain HTTP 403", async () => {
  const env = {
    MIRROR_COMPARE_TOKEN: "local-test-token",
    MIRROR_READ_ENABLED: "true",
    EMERGENCY_STOP: "false",
    TEST_WRITE_APPROVED: "true",
    TEST_STUDENT_ID: "TEST-STUDENT-01",
  };
  const cases = [
    ["PATCH", "/students/1320/progress/record-1"],
    ["PATCH", "/students/1320/homework/homework-1/dates"],
    ["POST", "/students/1320/homework/homework-1/archive"],
    ["POST", "/students/1320/homework/homework-1/restore"],
    ["PATCH", "/students/1320/targets/target-1"],
  ];
  for (const [method, path] of cases) {
    const request = new Request(`https://local.invalid${path}`, {
      method,
      headers: { authorization: "Bearer local-test-token", "content-type": "application/json" },
      body: JSON.stringify({ requestId: "guard-test-0001", expectedVersion: 1 }),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error: "TEST_STUDENT_ONLY" });
  }
});
