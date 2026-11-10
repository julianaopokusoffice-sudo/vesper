import { Hono } from 'hono';
import { checkForUpdate, currentUpdate } from './index.ts';

export function createUpdateApi(currentVersion: string) {
  const app = new Hono();

  app.get('/', async (c) => {
    const cached = currentUpdate();
    if (cached) return c.json(cached);
    return c.json(await checkForUpdate(currentVersion));
  });

  app.post('/check', async (c) => c.json(await checkForUpdate(currentVersion, true)));

  return app;
}
