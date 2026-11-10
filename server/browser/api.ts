import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { browser } from './index.ts';

/**
 * HTTP surface for the in-app browser. The panel and the CLI both speak it, and
 * the agent tools call the same module directly. One session means an agent's
 * navigation shows up in the user's panel as it happens.
 */
export function createBrowserApi() {
  const app = new Hono();

  app.get('/', (c) => c.json(browser().state()));

  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = browser().subscribe((state) => {
        void stream.writeSSE({ event: 'state', data: JSON.stringify(state) });
      });
      const heartbeat = setInterval(() => {
        void stream.write(': keepalive\n\n');
      }, 15_000);
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat);
          unsubscribe();
          resolve();
        });
      });
    }),
  );

  app.post('/open', async (c) => {
    try {
      const body = await c.req.json<{ url?: string; tabId?: string; newTab?: boolean }>();
      const result = await browser().open(String(body.url ?? ''), {
        tabId: body.tabId,
        newTab: Boolean(body.newTab),
        actor: 'user',
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post('/act', async (c) => {
    try {
      const body = await c.req.json<{ action?: 'back' | 'forward' | 'reload'; tabId?: string }>();
      if (body.tabId) browser().activateTab(body.tabId);
      if (body.action === 'back') return c.json(await browser().back('user'));
      if (body.action === 'forward') return c.json(await browser().forward('user'));
      if (body.action === 'reload') return c.json(await browser().reload('user'));
      return c.json({ error: 'Unknown browser action.' }, 400);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post('/tabs', async (c) => {
    try {
      const body = await c.req.json<{ url?: string }>().catch(() => ({ url: '' }));
      browser().createTab(body.url ? String(body.url) : '', 'user');
      return c.json(browser().state());
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post('/tabs/:id/activate', (c) => {
    try {
      return c.json(browser().activateTab(c.req.param('id')));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.delete('/tabs/:id', (c) => c.json(browser().closeTab(c.req.param('id'))));

  app.post('/click', async (c) => {
    try {
      const body = await c.req.json<{ target?: string | number }>();
      const raw = body.target;
      const result = await browser().click(typeof raw === 'number' ? raw : String(raw ?? ''));
      return c.json(result);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post('/find', async (c) => {
    try {
      const body = await c.req.json<{ query?: string }>();
      return c.json({ result: await browser().find(String(body.query ?? '')) });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  return app;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
