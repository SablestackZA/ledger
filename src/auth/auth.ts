import { createHash, timingSafeEqual } from "node:crypto";

// Digest comparison is constant-time and length-independent.
// An unset or malformed expected hash denies everything.
export function verifyBearer(header: string | null, expectedSha256Hex: string | undefined): boolean {
  if (!expectedSha256Hex || !/^[0-9a-f]{64}$/i.test(expectedSha256Hex)) return false;
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return false;
  const presented = createHash("sha256").update(match[1]!).digest();
  return timingSafeEqual(presented, Buffer.from(expectedSha256Hex, "hex"));
}
