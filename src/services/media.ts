import { config } from '../config.js';

export type CachedPhoto = {
  buf: Buffer;
  mime: string;
  prompt: string;
  savedAt: number;
};

const PHOTO_TTL_MS = 30 * 60 * 1000;
const lastPhoto = new Map<number, CachedPhoto>();

export function rememberPhoto(chatId: number, buf: Buffer, mime: string, prompt: string): void {
  lastPhoto.set(chatId, { buf, mime, prompt, savedAt: Date.now() });
}

export function getLastPhoto(chatId: number): CachedPhoto | undefined {
  const item = lastPhoto.get(chatId);
  if (!item) return undefined;
  if (Date.now() - item.savedAt > PHOTO_TTL_MS) {
    lastPhoto.delete(chatId);
    return undefined;
  }
  return item;
}

export function isImageEditIntent(text: string): boolean {
  const value = text.trim();
  if (!value || value === 'Mô tả chi tiết ảnh này.') return false;
  if (
    /(mô tả|miêu tả|ảnh này là gì|đây là gì|describe|what(?:'s| is) this)/i.test(value) &&
    !/(chỉnh|sửa|ghép|tạo|đổi|thay|edit|generate)/i.test(value)
  ) {
    return false;
  }
  return /(chỉnh|sửa|ghép|tạo ảnh|tạo lại|làm lại|vẽ|đổi|thay|biến thành|thành ở|đưa vào|đặt vào|thay nền|edit|generate|inpaint|composite|photoshop|render)/i.test(
    value,
  );
}

export function isConfirmGenerate(text: string): boolean {
  return /^(ok|okay|oke|được|đc|ừ|uk|yes|yep|thử|làm đi|tạo đi|tạo cho|thử tạo)\b/i.test(text.trim());
}

export function stripImagePayloads(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+/g, '')
    .replace(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractImageSources(payload: unknown, text = ''): string[] {
  const found: string[] = [];
  const push = (src: string) => {
    const value = src.trim();
    if (value && !found.includes(value)) found.push(value);
  };

  const walk = (value: unknown): void => {
    if (!value) return;
    if (typeof value === 'string') {
      const markdown = [...value.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
      for (const match of markdown) push(match[1] ?? '');
      const dataUrls = value.match(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g) ?? [];
      for (const url of dataUrls) push(url);
      const httpImgs = value.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/gi) ?? [];
      for (const url of httpImgs) push(url);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      if (typeof rec.b64_json === 'string') {
        push(`data:image/png;base64,${rec.b64_json}`);
      }
      if (typeof rec.url === 'string' && /^(https?:|data:image\/)/i.test(rec.url)) {
        push(rec.url);
      }
      if (rec.image_url && typeof rec.image_url === 'object') {
        const url = (rec.image_url as { url?: string }).url;
        if (url) push(url);
      }
      for (const item of Object.values(rec)) walk(item);
    }
  };

  walk(payload);
  walk(text);
  return found;
}

export async function sourceToBuffer(src: string): Promise<Buffer | null> {
  try {
    if (src.startsWith('data:image/')) {
      const base64 = src.split(',')[1];
      if (!base64) return null;
      return Buffer.from(base64, 'base64');
    }
    if (!/^https?:\/\//i.test(src)) return null;
    const res = await fetch(src);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > config.maxImageBytes) return null;
    return buf;
  } catch {
    return null;
  }
}

export async function sourcesToBuffers(sources: string[]): Promise<Buffer[]> {
  const images: Buffer[] = [];
  for (const src of sources) {
    const buf = await sourceToBuffer(src);
    if (buf) images.push(buf);
  }
  return images;
}

export type ChatReply = {
  text: string;
  images: Buffer[];
};
