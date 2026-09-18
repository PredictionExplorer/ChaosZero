/** Local tooling must never silently attach to public or unrelated infrastructure. */
export function localPort(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(`${name} must be an integer from 1024 to 65535.`);
  }
  return parsed;
}

export function localRpc(deployment) {
  const url = new URL(deployment.rpcUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    deployment.chainId !== 31337
  ) {
    throw new Error("Smoke tests are restricted to the disposable local chain.");
  }
  return url;
}
