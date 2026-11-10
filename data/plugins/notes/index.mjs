import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const file = (ctx) => join(ctx.workspace, 'NOTES.md');

export const tools = {
  async note_add(input, ctx) {
    const text = String(input?.text ?? '').trim();
    if (!text) return 'No note text provided.';
    const tag = input?.tag ? ` **#${input.tag}**` : '';
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    await appendFile(file(ctx), `- \`${stamp}\`${tag} ${text}\n`, 'utf8').catch(async () => {
      await writeFile(file(ctx), `# Notes\n\n- \`${stamp}\`${tag} ${text}\n`, 'utf8');
    });
    return `Saved to ${file(ctx)}`;
  },

  async note_list(_input, ctx) {
    const body = await readFile(file(ctx), 'utf8').catch(() => '');
    return body.trim() || 'No notes yet.';
  },
};
