import { createBot } from './bot.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { configureHistory } from './services/history.js';
import { getChatModel, loadSelectedModel } from './services/models.js';
import { PUBLIC_BOT_COMMANDS } from './handlers/commands.js';

configureHistory(config.historyLimit);
await loadSelectedModel();

const bot = createBot();

bot
  .launch()
  .then(async () => {
    await bot.telegram.setMyCommands(PUBLIC_BOT_COMMANDS);
    logger.info(
      {
        chatUrl: config.chatCompletionsUrl,
        model: getChatModel(),
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
