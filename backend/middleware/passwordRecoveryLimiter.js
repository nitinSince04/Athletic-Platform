const buckets = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 10;

// Per-process IP limit for the public recovery endpoints. Periodic cleanup keeps
// the map bounded during normal operation; deployments with multiple instances
// should use a shared store at the edge or a shared rate-limit backend.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= cutoff) buckets.delete(key);
  }
}, WINDOW_MS).unref();

function passwordRecoveryLimiter(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, entry);
  }
  entry.count += 1;
  res.set('RateLimit-Limit', String(MAX_REQUESTS));
  res.set('RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - entry.count)));
  if (entry.count > MAX_REQUESTS) {
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ success: false, message: 'Too many password recovery requests. Please try again later.' });
  }
  return next();
}

module.exports = { passwordRecoveryLimiter };
