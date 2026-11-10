import { Hono } from 'hono';
import { saveVoiceSettings, synthesizeSpeech, testVoice, transcribeAudio, voiceInfo } from './index.ts';
import type { VoiceSettings } from '../../shared/types.ts';

export function createVoiceApi() {
  const app = new Hono();

  app.get('/', (c) => c.json(voiceInfo()));

  app.put('/', async (c) => {
    try {
      const body = (await c.req.json()) as { settings?: Partial<VoiceSettings>; key?: string };
      return c.json(saveVoiceSettings(body.settings ?? {}, body.key));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post('/test', async (c) => {
    try {
      return c.json(await testVoice());
    } catch (err) {
      return c.json({ ok: false, message: errorMessage(err) }, 400);
    }
  });

  app.post('/transcribe', async (c) => {
    try {
      const form = await c.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return c.json({ error: 'Attach an audio file as “file”.' }, 400);
      const text = await transcribeAudio(file);
      return c.json({ text });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.post('/speak', async (c) => {
    try {
      const body = (await c.req.json()) as { text?: string };
      const { audio, contentType } = await synthesizeSpeech(String(body.text ?? ''));
      return new Response(audio, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'no-store',
          'content-length': String(audio.byteLength),
        },
      });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  return app;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
