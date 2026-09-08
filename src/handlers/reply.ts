import type { Context } from 'telegraf';

const TELEGRAM_MAX_MESSAGE = 4096;

export async function replyChunked(ctx: Context, text: string): Promise<void> {
  const body = text.trim() ? text : '(trống)';
  for (let offset = 0; offset < body.length; offset += TELEGRAM_MAX_MESSAGE) {
    await ctx.reply(body.slice(offset, offset + TELEGRAM_MAX_MESSAGE));
  }
}

export function commandName(text: string | undefined): string | null {
  if (!text?.startsWith('/')) return null;
  const token = text.split(/\s/, 1)[0] ?? '';
  const name = token.split('@', 1)[0];
  return name || null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function userErrorReply(err: unknown): string {
  const msg = errorMessage(err);

  if (/\b401\b|invalid api key|incorrect api key|unauthorized/i.test(msg)) {
    return 'API key HOCAI không hợp lệ. Kiểm tra OPENAI_API_KEY trong .env rồi restart bot.';
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
