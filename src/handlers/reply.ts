import type { Context } from 'telegraf';
import { imageFilename, looksLikeImage, type ChatReply } from '../services/media.js';
import { logger } from '../logger.js';

const TELEGRAM_MAX_MESSAGE = 4096;

export async function replyChunked(ctx: Context, text: string): Promise<void> {
  const body = text.trim();
  if (!body) return;
  for (let offset = 0; offset < body.length; offset += TELEGRAM_MAX_MESSAGE) {
    await ctx.reply(body.slice(offset, offset + TELEGRAM_MAX_MESSAGE));
  }
}

export async function replyWithImages(
  ctx: Context,
  images: Buffer[],
  caption?: string,
): Promise<void> {
  if (!images.length) return;

  const valid = images.filter((buf) => looksLikeImage(buf));
  if (!valid.length) {
    throw new Error('HOCAI không trả về file ảnh hợp lệ để gửi Telegram');
  }

  for (let i = 0; i < valid.length; i += 1) {
    const buf = valid[i]!;
    const filename = imageFilename(buf);
    await ctx.sendChatAction('upload_photo');
    const options = i === 0 && caption ? { caption: caption.slice(0, 1024) } : undefined;
    try {
      await ctx.replyWithPhoto({ source: buf, filename }, options);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), bytes: buf.byteLength, filename },
        'replyWithPhoto failed, fallback document',
      );
      await ctx.replyWithDocument({ source: buf, filename }, options);
    }
  }
}

export async function replyStreaming(
  ctx: Context,
  produce: (onDelta: (text: string) => Promise<void>) => Promise<string | ChatReply>,
): Promise<ChatReply> {
  if (!ctx.chat) {
    throw new Error('Không có chat để trả lời');
  }

  await ctx.sendChatAction('typing');
  const placeholder = await ctx.reply('…');
  const chatId = ctx.chat.id;
  const messageId = placeholder.message_id;
  let lastSent = '';
  let lastAt = 0;

  const flush = async (text: string, force = false): Promise<void> => {
    const body = (text.trim() || '…').slice(0, TELEGRAM_MAX_MESSAGE);
    if (body === lastSent) return;
    const now = Date.now();
    if (!force && now - lastAt < 450) return;
    lastAt = now;
    lastSent = body;
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, body);
    } catch {
      // Telegram từ chối nếu nội dung chưa đổi
    }
  };

  const typing = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => undefined);
  }, 4000);

  try {
    const produced = await produce((text) => flush(text));
    const reply: ChatReply =
      typeof produced === 'string' ? { text: produced, images: [] } : produced;
    await flush(reply.text, true);
    if (reply.text.length > TELEGRAM_MAX_MESSAGE) {
      await replyChunked(ctx, reply.text.slice(TELEGRAM_MAX_MESSAGE));
    }
    await replyWithImages(ctx, reply.images);
    return reply;
  } catch (err) {
    const msg = userErrorReply(err).slice(0, TELEGRAM_MAX_MESSAGE);
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, msg);
    } catch {
      await ctx.reply(msg);
    }
    throw err;
  } finally {
    clearInterval(typing);
  }
}

export function commandName(text: string | undefined): string | null {
  if (!text?.startsWith('/')) return null;
  const token = text.split(/\s/, 1)[0] ?? '';
  const name = token.split('@', 1)[0];
  return (name || '').toLowerCase() || null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function userErrorReply(err: unknown): string {
  const msg = errorMessage(err);

  if (/\b401\b|invalid api key|incorrect api key|unauthorized/i.test(msg)) {
    return 'API key HOCAI không hợp lệ. Kiểm tra HOCAI_API_KEY trong .env rồi restart bot.';
  }
  if (/\b403\b|forbidden|not allowed/i.test(msg)) {
    return 'API key HOCAI không có quyền dùng model này. Kiểm tra gói/model trên danglamgiau.com.';
  }
  if (/\b402\b|insufficient|credit|balance|quota/i.test(msg)) {
    return 'Tài khoản HOCAI hết credit hoặc không đủ hạn mức. Nạp thêm rồi thử lại.';
  }
  if (/\b429\b|rate limit|too many requests/i.test(msg)) {
    return 'HOCAI đang giới hạn tốc độ. Đợi một lúc rồi thử lại.';
  }
  if (/\b404\b|model .*not found|does not exist/i.test(msg)) {
    return `Không tìm thấy model HOCAI. Kiểm tra OPENAI_MODEL trong .env (hiện đang dùng model trên dashboard). Chi tiết: ${msg}`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(msg)) {
    return 'Không kết nối được tới HOCAI (danglamgiau.com). Kiểm tra mạng trên server.';
  }

  const short = msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
  return `Xin lỗi, mình gặp lỗi khi xử lý.\n${short}`;
}
