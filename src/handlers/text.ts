import { message } from 'telegraf/filters';
import type { Telegraf } from 'telegraf';
import { logger } from '../logger.js';
import { appendTurn } from '../services/history.js';
import { getLastPhoto, isConfirmGenerate, isImageEditIntent } from '../services/media.js';
import { askGpt, editOrGenerateImage } from '../services/openai.js';
import { KNOWN_COMMANDS } from './commands.js';
import { commandName, errorMessage, replyStreaming, replyWithImages, userErrorReply } from './reply.js';

export function registerText(bot: Telegraf): void {
  bot.on(message('text'), async (ctx) => {
    try {
      const cmd = commandName(ctx.message.text);
      if (cmd) {
        if (!KNOWN_COMMANDS.has(cmd)) {
          await ctx.reply('Lệnh không khả dụng. Gửi /help để xem các lệnh đang hỗ trợ.');
        }
        return;
      }

      const last = getLastPhoto(ctx.chat.id);
      const wantsImage = isImageEditIntent(ctx.message.text) || isConfirmGenerate(ctx.message.text);

      if (last && wantsImage) {
        const prompt = isConfirmGenerate(ctx.message.text)
          ? `${last.prompt}. ${ctx.message.text}`
          : ctx.message.text;
        await ctx.sendChatAction('upload_photo');
        const image = await editOrGenerateImage(last.buf, last.mime, prompt);
        await replyWithImages(ctx, [image], prompt);
        appendTurn(
          ctx.chat.id,
          { role: 'user', content: ctx.message.text },
          { role: 'assistant', content: 'Đã gửi ảnh trên Telegram.' },
        );
        return;
      }

      await replyStreaming(ctx, (onDelta) => askGpt(ctx.chat.id, ctx.message.text, onDelta));
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'text handler failed');
      await ctx.reply(userErrorReply(err)).catch(() => undefined);
    }
  });
}
