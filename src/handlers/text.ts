import { message } from 'telegraf/filters';
import type { Telegraf } from 'telegraf';
import { logger } from '../logger.js';
import { askGpt } from '../services/openai.js';
import { commandName, errorMessage, replyChunked, userErrorReply } from './reply.js';

export function registerText(bot: Telegraf): void {
  bot.on(message('text'), async (ctx) => {
    try {
      if (commandName(ctx.message.text)) return;

      await ctx.sendChatAction('typing');
      const reply = await askGpt(ctx.chat.id, ctx.message.text);
      await replyChunked(ctx, reply);
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'text handler failed');
      await ctx.reply(userErrorReply(err));
    }
  });
}
