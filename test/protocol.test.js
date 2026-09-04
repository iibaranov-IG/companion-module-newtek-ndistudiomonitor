const assert = require("node:assert/strict");
const test = require("node:test");
const { createDigestAuthorization } = require("../protocol");

test("creates a Digest authorization header for the Studio Monitor challenge", () => {
  const header = createDigestAuthorization({
    method: "GET",
    path: "/v1/sources",
    challenge:
      'Digest realm="", nonce="nonce-123", qop="auth", opaque="opaque-1"',
    username: "admin",
    password: "secret",
    nonceCount: 1,
  });

  assert.match(header, /^Digest username="admin", realm="", nonce="nonce-123"/);
  assert.match(header, /uri="\/v1\/sources"/);
  assert.match(header, /qop=auth, nc=00000001, cnonce="[0-9a-f]{16}"/);
});

test("rejects an incomplete Digest challenge", () => {
  assert.equal(
    createDigestAuthorization({
      method: "GET",
      path: "/",
      challenge: 'Digest realm=""',
      username: "admin",
      password: "secret",
      nonceCount: 1,
    }),
    undefined,
  );
});
