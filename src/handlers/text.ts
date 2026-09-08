import { message } from 'telegraf/filters';
import type { Telegraf } from 'telegraf';
import { logger } from '../logger.js';
import { appendTurn } from '../services/history.js';
import { getLastPhoto, isConfirmGenerate, isImageEditIntent } from '../services/media.js';
import { askGpt, editImage, generateImage } from '../services/openai.js';
import { commandName, errorMessage, replyStreaming, replyWithImages } from './reply.js';
import { KNOWN_COMMANDS } from './commands.js';

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
          ? `${last.prompt}. Phiên bản phù hợp, trang phục kín đáo nếu cần.`
          : ctx.message.text;
        try {
          await ctx.sendChatAction('upload_photo');
          let image: Buffer;
          try {
            image = await editImage(last.buf, last.mime, prompt);
          } catch (err) {
            logger.error({ err: errorMessage(err) }, 'follow-up image edit failed, fallback generate');
            image = await generateImage(prompt);
          }
          await replyWithImages(ctx, [image], prompt);
          appendTurn(
            ctx.chat.id,
            { role: 'user', content: ctx.message.text },
            { role: 'assistant', content: 'Đã gửi ảnh trên Telegram.' },
          );
          return;
        } catch (err) {
          logger.error({ err: errorMessage(err) }, 'follow-up image create failed, fallback chat');
        }
      }

      const reply = await replyStreaming(ctx, (onDelta) =>
        askGpt(ctx.chat.id, ctx.message.text, onDelta),
      );

      if (!reply.images.length && last && wantsImage) {
        await ctx.sendChatAction('upload_photo');
        const image = await generateImage(ctx.message.text);
        await replyWithImages(ctx, [image]);
      }
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'text handler failed');
    }
  });
}
