const crypto = require("node:crypto");

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function parseDigestChallenge(challenge) {
  if (typeof challenge !== "string") return undefined;

  const values = {};
  for (const match of challenge.matchAll(
    /([a-z]+)=(?:"([^"]*)"|([^,\s]+))/gi,
  )) {
    values[match[1].toLowerCase()] = match[2] ?? match[3];
  }

  return values.realm !== undefined && values.nonce ? values : undefined;
}

function createDigestAuthorization({
  method,
  path,
  challenge,
  username,
  password,
  nonceCount,
}) {
  const values = parseDigestChallenge(challenge);
  if (!values) return undefined;

  const qop = values.qop?.split(",")[0].trim();
  const nc = String(nonceCount).padStart(8, "0");
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${username}:${values.realm}:${password}`);
  const ha2 = md5(`${method.toUpperCase()}:${path}`);
  const response = qop
    ? md5(`${ha1}:${values.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${values.nonce}:${ha2}`);

  const fields = [
    `username="${username}"`,
    `realm="${values.realm}"`,
    `nonce="${values.nonce}"`,
    `uri="${path}"`,
    `response="${response}"`,
  ];
  if (values.opaque) fields.push(`opaque="${values.opaque}"`);
  if (qop) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);

  return `Digest ${fields.join(", ")}`;
}

module.exports = { createDigestAuthorization };
