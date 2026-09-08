import type { Context, MiddlewareFn } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ALLOWED_BOT_COMMANDS, PUBLIC_BOT_COMMANDS } from './commands.js';
import { commandName, errorMessage } from './reply.js';

const PUBLIC_COMMANDS = new Set(['/getid']);
const scopedMenus = new Set<string>();

export function isAllowedUser(userId: number | undefined): boolean {
  return userId != null && config.allowedUserIds.has(userId);
}

async function syncCommandMenu(ctx: Context, allowed: boolean): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId == null) return;
  const key = `${chatId}:${allowed ? 'ok' : 'public'}`;
  if (scopedMenus.has(key)) return;
  scopedMenus.add(key);
  try {
    await ctx.telegram.setMyCommands(allowed ? ALLOWED_BOT_COMMANDS : PUBLIC_BOT_COMMANDS, {
      scope: { type: 'chat', chat_id: chatId },
    });
  } catch (err) {
    logger.error({ err: errorMessage(err) }, 'setMyCommands failed');
  }
}

export const authMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  try {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    const cmd = commandName(text);
    if (PUBLIC_COMMANDS.has(cmd ?? '')) {
      await syncCommandMenu(ctx, isAllowedUser(ctx.from?.id));
      return await next();
    }

    if (isAllowedUser(ctx.from?.id)) {
      await syncCommandMenu(ctx, true);
      return await next();
    }

    await syncCommandMenu(ctx, false);
    if (ctx.chat?.type === 'private') {
      await ctx.reply(
        'Bạn chưa được phép dùng bot.\nChỉ dùng được lệnh /getid để lấy ID Telegram, rồi nhờ admin thêm vào ALLOWED_USER_IDS.',
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
