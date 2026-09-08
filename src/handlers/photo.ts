import { message } from 'telegraf/filters';
import type { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { appendTurn } from '../services/history.js';
import { isImageEditIntent, rememberPhoto } from '../services/media.js';
import { askGptWithImage, editOrGenerateImage } from '../services/openai.js';
import { errorMessage, replyStreaming, replyWithImages, userErrorReply } from './reply.js';

async function downloadTelegramFile(
  bot: Telegraf,
  fileId: string,
  fileSize: number | undefined,
): Promise<Buffer> {
  if (fileSize != null && fileSize > config.maxImageBytes) {
    throw new Error('FILE_TOO_LARGE');
  }

  const link = await bot.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) {
    throw new Error(`Không tải được file Telegram (${res.status})`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > config.maxImageBytes) {
    throw new Error('FILE_TOO_LARGE');
  }
  return buf;
}

function toDataUrl(buf: Buffer, mime = 'image/jpeg'): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export function registerPhoto(bot: Telegraf): void {
  bot.on(message('photo'), async (ctx) => {
    try {
      const photo = ctx.message.photo.at(-1);
      if (!photo) {
        await ctx.reply('Không nhận được ảnh. Thử gửi lại nhé.');
        return;
      }

      await ctx.sendChatAction('upload_photo');
      const buf = await downloadTelegramFile(bot, photo.file_id, photo.file_size);
      const prompt = ctx.message.caption?.trim() || 'Mô tả chi tiết ảnh này.';
      const mime = 'image/jpeg';
      rememberPhoto(ctx.chat.id, buf, mime, prompt);

      if (isImageEditIntent(prompt)) {
        const image = await editOrGenerateImage(buf, mime, prompt);
        await replyWithImages(ctx, [image], prompt);
        appendTurn(
          ctx.chat.id,
          { role: 'user', content: `[Ảnh] ${prompt}` },
          { role: 'assistant', content: 'Đã gửi ảnh đã chỉnh trên Telegram.' },
        );
        return;
      }

      await replyStreaming(ctx, (onDelta) =>
        askGptWithImage(ctx.chat.id, prompt, toDataUrl(buf, mime), onDelta),
      );
    } catch (err) {
      if (errorMessage(err) === 'FILE_TOO_LARGE') {
        await ctx.reply('Ảnh vượt quá 20MB. Gửi ảnh nhỏ hơn nhé.');
        return;
      }
      logger.error({ err: errorMessage(err) }, 'photo handler failed');
      await ctx.reply(userErrorReply(err)).catch(() => undefined);
    }
  });

  bot.on(message('document'), async (ctx) => {
    try {
      const doc = ctx.message.document;
      if (!doc.mime_type?.startsWith('image/')) return;

      await ctx.sendChatAction('upload_photo');
      const buf = await downloadTelegramFile(bot, doc.file_id, doc.file_size);
      const prompt = ctx.message.caption?.trim() || 'Mô tả chi tiết ảnh này.';
      const mime = doc.mime_type || 'image/jpeg';
      rememberPhoto(ctx.chat.id, buf, mime, prompt);

      if (isImageEditIntent(prompt)) {
        const image = await editOrGenerateImage(buf, mime, prompt);
        await replyWithImages(ctx, [image], prompt);
        appendTurn(
          ctx.chat.id,
          { role: 'user', content: `[Ảnh] ${prompt}` },
          { role: 'assistant', content: 'Đã gửi ảnh đã chỉnh trên Telegram.' },
        );
        return;
      }

      await replyStreaming(ctx, (onDelta) =>
        askGptWithImage(ctx.chat.id, prompt, toDataUrl(buf, mime), onDelta),
      );
    } catch (err) {
      if (errorMessage(err) === 'FILE_TOO_LARGE') {
        await ctx.reply('Ảnh vượt quá 20MB. Gửi ảnh nhỏ hơn nhé.');
        return;
      }
      logger.error({ err: errorMessage(err) }, 'document image handler failed');
      await ctx.reply(userErrorReply(err)).catch(() => undefined);
    }
  });
}
