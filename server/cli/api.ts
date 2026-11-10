import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { adapterInfos, defaultRoles } from './adapters.ts';
import { cancelCrew, getRun, listRuns, startCrew, subscribeCrew } from './crew.ts';
import type { CliCrewRequest } from '../../shared/types.ts';

/**
 * HTTP surface for the crew. The UI, the CLI and the agent tools all go through
 * the same coordinator, so a run started from one surface is visible everywhere.
 */
export function createCliApi() {
  const app = new Hono();

  app.get('/adapters', async (c) => {
    const infos = await adapterInfos(c.req.query('refresh') === '1');
    return c.json({ adapters: infos, roles: defaultRoles(infos) });
  });

  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'ready', data: '{}' });
      const unsubscribe = subscribeCrew((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
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

  app.get('/runs', (c) => c.json({ runs: listRuns() }));

  app.get('/runs/:id', (c) => {
    const run = getRun(c.req.param('id'));
    if (!run) return c.json({ error: 'No such run.' }, 404);
    return c.json(run);
  });

  app.post('/runs/:id/cancel', (c) => {
    try {
      return c.json(cancelCrew(c.req.param('id')));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post('/crew', async (c) => {
    try {
      const body = (await c.req.json()) as CliCrewRequest;
      return c.json(await startCrew(body));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  return app;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
