export function allowedOriginsFromEnv(env, port) {
  const origins = new Set();
  const add = value => {
    if (!value) return;
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) origins.add(url.origin);
    } catch { /* Invalid configured origins are not trusted. */ }
  };
  if (!env.VERCEL) {
    add(`http://localhost:${port}`);
    add(`http://127.0.0.1:${port}`);
  }
  add(env.APP_ORIGIN);
  for (const name of ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL']) {
    if (env[name]) add(`https://${env[name]}`);
  }
  return origins;
}
