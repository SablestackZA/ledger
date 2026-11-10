import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyBearer } from "../../src/auth/auth";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("verifyBearer", () => {
  const expected = sha("right-key");

  it("accepts the matching key", () => {
    expect(verifyBearer("Bearer right-key", expected)).toBe(true);
  });
  it("rejects a wrong key, a missing header, and the wrong scheme", () => {
    expect(verifyBearer("Bearer wrong", expected)).toBe(false);
    expect(verifyBearer(null, expected)).toBe(false);
    expect(verifyBearer("Basic right-key", expected)).toBe(false);
    expect(verifyBearer("right-key", expected)).toBe(false);
  });
  it("denies everything when the expected hash is unset or malformed", () => {
    expect(verifyBearer("Bearer right-key", undefined)).toBe(false);
    expect(verifyBearer("Bearer right-key", "")).toBe(false);
    expect(verifyBearer("Bearer right-key", "abc")).toBe(false);
  });
});
