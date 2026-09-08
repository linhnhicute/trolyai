import { createBot } from './bot.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { configureHistory } from './services/history.js';

configureHistory(config.historyLimit);

const bot = createBot();

bot
  .launch()
  .then(async () => {
    await bot.telegram.setMyCommands([
      { command: 'getid', description: 'Lấy Telegram user ID' },
      { command: 'reset', description: 'Xoá lịch sử hội thoại' },
      { command: 'img', description: 'Tạo ảnh từ mô tả' },
      { command: 'help', description: 'Xem hướng dẫn' },
    ]);
    logger.info(
      {
        baseUrl: config.openaiBaseUrl,
        model: config.openaiModel,
        allowedUsers: config.allowedUserIds.size,
      },
      'Bot Telegram đang chạy (long polling)',
    );
  })
  .catch((err: unknown) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Không khởi động được bot');
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
