import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }
  return value;
}

function parseAllowedUserIds(raw: string | undefined): Set<number> {
  if (!raw?.trim()) {
    return new Set();
  }

  const ids = new Set<number>();
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const id = Number(token);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`ALLOWED_USER_IDS không hợp lệ: "${token}"`);
    }
    ids.add(id);
  }
  return ids;
}

function parseNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} phải là số`);
  }
  return value;
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} phải là số nguyên dương`);
  }
  return value;
}

function resolveApiKey(): string {
  const key = process.env.HOCAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error('Thiếu biến môi trường bắt buộc: HOCAI_API_KEY');
  }
  return key;
}

const openaiBaseUrl = (process.env.OPENAI_BASE_URL?.trim() || 'https://danglamgiau.com/v1').replace(
  /\/+$/,
  '',
);

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  hocaiApiKey: resolveApiKey(),
  openaiBaseUrl,
  chatCompletionsUrl:
    process.env.HOCAI_CHAT_URL?.trim() || `${openaiBaseUrl}/chat/completions`,
  openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o',
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2',
  temperature: parseNumber('HOCAI_TEMPERATURE', 0.7),
  maxTokens: parsePositiveInt('HOCAI_MAX_TOKENS', 1000),
  stream: (process.env.HOCAI_STREAM?.trim() || 'true').toLowerCase() !== 'false',
  historyLimit: parsePositiveInt('HISTORY_LIMIT', 10),
  allowedUserIds: parseAllowedUserIds(process.env.ALLOWED_USER_IDS),
  maxImageBytes: 20 * 1024 * 1024,
};
