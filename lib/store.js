// Tiny key-value store over the Upstash Redis REST API (the database you connect from Vercel > Storage).
// No extra packages needed. Works with the variable names Vercel sets for either flavor of the integration.

function endpoint() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
}
function token() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
}

function configured() {
  return Boolean(endpoint() && token());
}

async function command(args) {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(3000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `store HTTP ${res.status}`);
  return data.result;
}

async function get(key) {
  if (!configured()) return null;
  return command(['GET', key]);
}

async function set(key, value, ttlSeconds) {
  if (!configured()) throw new Error('settings database is not connected');
  const args = ['SET', key, String(value)];
  if (ttlSeconds) args.push('EX', ttlSeconds);
  return command(args);
}

module.exports = { configured, get, set };
