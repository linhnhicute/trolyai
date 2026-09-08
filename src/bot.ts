import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { authMiddleware } from './handlers/auth.js';
import { registerCommands } from './handlers/commands.js';
import { registerPhoto } from './handlers/photo.js';
import { registerText } from './handlers/text.js';
import { logger } from './logger.js';
import { errorMessage, userErrorReply } from './handlers/reply.js';

export function createBot(): Telegraf {
  const bot = new Telegraf(config.telegramBotToken);

  bot.use(authMiddleware);
  registerCommands(bot);
  registerText(bot);
  registerPhoto(bot);

  bot.catch(async (err, ctx) => {
    logger.error({ err: errorMessage(err) }, 'unhandled bot error');
    try {
      await ctx.reply(userErrorReply(err));
    } catch {
      // ignore reply failure
    }
  });

  return bot;
}
