import type { Telegraf } from 'telegraf';
import { logger } from '../logger.js';
import { resetHistory } from '../services/history.js';
import { findModel, formatModelLine, getChatModel, listHocaiModels, setChatModel } from '../services/models.js';
import { generateImage } from '../services/openai.js';
import { errorMessage, replyChunked, replyWithImages, userErrorReply } from './reply.js';

const HELP_TEXT = [
  'Các lệnh đang hỗ trợ:',
  '/help — xem danh sách lệnh',
  '/getid — lấy Telegram user ID của bạn',
  '/checkmodel — xem model đang dùng, danh sách và giá Input/Output',
  '/setmodel <id> — đổi model chat',
  '/img <mô tả> — tạo ảnh mới từ mô tả',
  '/reset — xoá lịch sử hội thoại',
  '',
  'Gửi tin nhắn hoặc ảnh để hỏi bot.',
  'Gửi ảnh kèm caption (chỉnh/ghép/sửa…) để chỉnh đúng tấm ảnh đó, không tạo ảnh mới.',
  'Lệnh không có trong danh sách sẽ báo không khả dụng.',
].join('\n');

export const KNOWN_COMMANDS = new Set([
  '/start',
  '/help',
  '/getid',
  '/checkmodel',
  '/setmodel',
  '/img',
  '/reset',
]);

export const PUBLIC_BOT_COMMANDS = [{ command: 'getid', description: 'Lấy Telegram user ID' }];

export const ALLOWED_BOT_COMMANDS = [
  { command: 'help', description: 'Xem danh sách lệnh' },
  { command: 'getid', description: 'Lấy Telegram user ID' },
  { command: 'checkmodel', description: 'Xem danh sách model HOCAI' },
  { command: 'setmodel', description: 'Đổi model chat' },
  { command: 'img', description: 'Tạo ảnh từ mô tả' },
  { command: 'reset', description: 'Xoá lịch sử hội thoại' },
];

export function registerCommands(bot: Telegraf): void {
  bot.start(async (ctx) => {
    try {
      await ctx.reply(
        'Xin chào, mình là trợ lý AI trên Telegram.\nGửi /help để xem lệnh, hoặc nhắn tin để hỏi bot.',
      );
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'start handler failed');
      await ctx.reply('Xin lỗi, mình gặp lỗi khi xử lý. Thử lại nhé.');
    }
  });

  bot.help(async (ctx) => {
    try {
      await ctx.reply(HELP_TEXT);
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'help handler failed');
      await ctx.reply('Xin lỗi, mình gặp lỗi khi xử lý. Thử lại nhé.');
    }
  });

  bot.command('getid', async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (userId == null) {
        await ctx.reply('Không lấy được ID Telegram của bạn.');
        return;
      }

      const lines = [`ID Telegram của bạn: ${userId}`];
      if (ctx.chat && ctx.chat.id !== userId) {
        lines.push(`Chat ID: ${ctx.chat.id}`);
      }
      lines.push('', 'Gửi ID này cho admin để được thêm vào danh sách dùng bot.');
      await ctx.reply(lines.join('\n'));
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'getid handler failed');
      await ctx.reply('Xin lỗi, mình gặp lỗi khi xử lý. Thử lại nhé.');
    }
  });

  bot.command('checkmodel', async (ctx) => {
    try {
      await ctx.sendChatAction('typing');
      const current = getChatModel();
      const models = await listHocaiModels();
      const lines = [
        `Model đang dùng: ${current}`,
        '',
        `Danh sách HOCAI (${models.length}):`,
        'Giá: Input / Output (Credit/1M token)',
      ];

      if (models.length === 0) {
        lines.push('(trống)');
      } else {
        for (const model of models) {
          lines.push(formatModelLine(model, current));
        }
      }

      lines.push('', 'Đổi model: /setmodel <id>');
      await replyChunked(ctx, lines.join('\n'));
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'checkmodel handler failed');
      await ctx.reply(userErrorReply(err));
    }
  });

  bot.command('setmodel', async (ctx) => {
    try {
      const requested = ctx.message.text.replace(/^\/setmodel(?:@\w+)?\s*/i, '').trim();
      if (!requested) {
        await ctx.reply(
          `Model hiện tại: ${getChatModel()}\nCú pháp: /setmodel <id>\nVí dụ: /setmodel gpt-4o\nXem danh sách: /checkmodel`,
        );
        return;
      }

      await ctx.sendChatAction('typing');
      let chosen = requested;
      try {
        const models = await listHocaiModels();
        const matched = findModel(models, requested);
        if (!matched) {
          await ctx.reply(
            `Không thấy model "${requested}" trên HOCAI.\nGửi /checkmodel để xem danh sách, rồi /setmodel <id> đúng tên.`,
          );
          return;
        }
        chosen = matched.id;
      } catch (err) {
        logger.error({ err: errorMessage(err) }, 'setmodel list failed, vẫn set theo tên nhập');
      }

      const model = await setChatModel(chosen);
      await ctx.reply(`Đã đổi model chat thành: ${model}`);
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'setmodel handler failed');
      await ctx.reply(userErrorReply(err));
    }
  });

  bot.command('reset', async (ctx) => {
    try {
      resetHistory(ctx.chat.id);
      await ctx.reply('Đã xoá lịch sử hội thoại. Bắt đầu cuộc trò chuyện mới nhé.');
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'reset handler failed');
      await ctx.reply('Xin lỗi, mình gặp lỗi khi xử lý. Thử lại nhé.');
    }
  });

  bot.command('img', async (ctx) => {
    try {
      const prompt = ctx.message.text.replace(/^\/img(?:@\w+)?\s*/i, '').trim();
      if (!prompt) {
        await ctx.reply('Cú pháp: /img <mô tả ảnh cần tạo>\nVí dụ: /img một con mèo ngồi trên mái nhà lúc hoàng hôn');
        return;
      }

      await ctx.sendChatAction('typing');
      const buffer = await generateImage(prompt);
      await replyWithImages(ctx, [buffer], prompt);
    } catch (err) {
      logger.error({ err: errorMessage(err) }, 'img handler failed');
      await ctx.reply(userErrorReply(err));
    }
  });
}
