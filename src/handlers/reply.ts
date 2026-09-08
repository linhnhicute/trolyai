import type { Context } from 'telegraf';

const TELEGRAM_MAX_MESSAGE = 4096;

export async function replyChunked(ctx: Context, text: string): Promise<void> {
  const body = text.trim() ? text : '(trống)';
  for (let offset = 0; offset < body.length; offset += TELEGRAM_MAX_MESSAGE) {
    await ctx.reply(body.slice(offset, offset + TELEGRAM_MAX_MESSAGE));
  }
}

export function commandName(text: string | undefined): string | null {
  if (!text?.startsWith('/')) return null;
  const token = text.split(/\s/, 1)[0] ?? '';
  const name = token.split('@', 1)[0];
  return name || null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
