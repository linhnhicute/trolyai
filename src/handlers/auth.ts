import type { Context, MiddlewareFn } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { commandName, errorMessage } from './reply.js';

const PUBLIC_COMMANDS = new Set(['/getid']);

export function isAllowedUser(userId: number | undefined): boolean {
  return userId != null && config.allowedUserIds.has(userId);
}

export const authMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  try {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    if (PUBLIC_COMMANDS.has(commandName(text) ?? '')) {
      return await next();
    }

    if (isAllowedUser(ctx.from?.id)) {
      return await next();
    }

    if (ctx.chat?.type === 'private') {
      await ctx.reply(
        'Bạn chưa được phép chat với bot.\nGửi /getid để lấy ID Telegram, rồi nhờ admin thêm vào ALLOWED_USER_IDS.',
      );
    }
  } catch (err) {
    logger.error({ err: errorMessage(err) }, 'auth middleware failed');
    try {
      await ctx.reply('Xin lỗi, mình gặp lỗi khi xử lý. Thử lại nhé.');
    } catch {
      // ignore reply failure
    }
  }
};
