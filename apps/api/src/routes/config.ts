import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { JobDb } from '@job-fetcher/database';
import {
  listConfigFields,
  resetConfigField,
  updateConfigField,
  type ApplyContext,
} from '../config-registry';

export function configRoutes(db: Kysely<JobDb>, ctx?: ApplyContext) {
  const app = new Hono();

  app.get('/', async (c) => {
    const fields = await listConfigFields(db);
    return c.json({ data: fields });
  });

  app.put('/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => null);
    if (body === null || !('value' in body)) {
      return c.json({ error: 'invalid_body' }, 400);
    }

    try {
      const field = await updateConfigField(db, key, body.value, ctx);
      return c.json({ data: field });
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'unknown_config_key') return c.json({ error: message }, 404);
      return c.json({ error: 'invalid_value', message }, 400);
    }
  });

  app.post('/:key/reset', async (c) => {
    const key = c.req.param('key');
    try {
      const field = await resetConfigField(db, key, ctx);
      return c.json({ data: field });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  return app;
}
