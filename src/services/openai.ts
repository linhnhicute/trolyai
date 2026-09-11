import { config } from '../config.js';
import { logger } from '../logger.js';
import { appendTurn, getHistory } from './history.js';
import { extractImageSources, looksLikeImage, parseImageApiPayload, sourcesToBuffers, stripImagePayloads, type ChatReply } from './media.js';
import { getChatModel } from './models.js';

const SYSTEM_PROMPT =
  'Bạn là trợ lý AI trên Telegram. Trả lời bằng tiếng Việt, rõ ràng, ngắn gọn và hữu ích. Khi người dùng nhờ tạo hoặc chỉnh ảnh, đừng nói là đã tạo xong nếu không đính kèm dữ liệu ảnh (URL hoặc base64). Bot sẽ tự gửi ảnh lên Telegram.';

type ChatContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
};

type OnDelta = (text: string) => Promise<void> | void;

async function readErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return json.error?.message || json.message || text;
  } catch {
    return text;
  }
}

function contentToText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => contentToText(part)).join('');
  }
  if (typeof content === 'object') {
    const rec = content as { text?: unknown; content?: unknown };
    if (typeof rec.text === 'string') return rec.text;
    if (rec.content != null && rec.content !== content) return contentToText(rec.content);
  }
  return '';
}

async function replyFromChatJson(json: unknown, onDelta?: OnDelta): Promise<ChatReply> {
  const rec = json as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (rec.error?.message) throw new Error(rec.error.message);

  const content = rec.choices?.[0]?.message?.content;
  const text = stripImagePayloads(contentToText(content)).trim();
  const images = await sourcesToBuffers(extractImageSources(json, text));

  if (!text && !images.length) {
    logger.error(
      { preview: JSON.stringify(json).slice(0, 1500) },
      'HOCAI không có choices[0].message.content',
    );
    throw new Error('HOCAI không trả về choices[0].message.content');
  }

  const reply: ChatReply = { text: text || 'Đã tạo ảnh.', images };
  await onDelta?.(reply.text);
  return reply;
}

async function chatCompletions(
  messages: ChatCompletionMessage[],
  onDelta?: OnDelta,
  options?: { model?: string; maxTokens?: number },
): Promise<ChatReply> {
  const res = await fetch(config.chatCompletionsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hocaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options?.model || getChatModel(),
      messages,
      stream: false,
      temperature: config.temperature,
      max_tokens: options?.maxTokens ?? config.maxTokens,
    }),
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    logger.error({ status: res.status, err: detail, url: config.chatCompletionsUrl }, 'HOCAI chat error');
    throw new Error(`HOCAI ${res.status} ${detail}`.trim());
  }

  return replyFromChatJson(await res.json(), onDelta);
}

export async function askGpt(
  chatId: number,
  userText: string,
  onDelta?: OnDelta,
): Promise<ChatReply> {
  const reply = await chatCompletions(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      ...getHistory(chatId),
      { role: 'user', content: userText },
    ],
    onDelta,
  );

  appendTurn(
    chatId,
    { role: 'user', content: userText },
    { role: 'assistant', content: reply.text },
  );
  return reply;
}

export async function askGptWithImage(
  chatId: number,
  prompt: string,
  dataUrl: string,
  onDelta?: OnDelta,
): Promise<ChatReply> {
  const reply = await chatCompletions(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      ...getHistory(chatId),
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    onDelta,
  );

  appendTurn(
    chatId,
    { role: 'user', content: `[Ảnh] ${prompt}` },
    { role: 'assistant', content: reply.text },
  );
  return reply;
}

async function bufferFromImageApi(json: unknown, emptyMessage: string): Promise<Buffer> {
  const images = await sourcesToBuffers(parseImageApiPayload(json));
  if (images[0] && looksLikeImage(images[0])) return images[0];
  throw new Error(emptyMessage);
}

async function readImageResponse(res: Response, emptyMessage: string): Promise<Buffer> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/')) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!looksLikeImage(buf)) {
      throw new Error(emptyMessage);
    }
    return buf;
  }

  const text = await res.text();
  try {
    return await bufferFromImageApi(JSON.parse(text), emptyMessage);
  } catch {
    const buf = Buffer.from(text, 'base64');
    if (looksLikeImage(buf)) return buf;
    throw new Error(emptyMessage);
  }
}

export async function generateImage(prompt: string): Promise<Buffer> {
  const res = await fetch(config.imagesGenerationsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hocaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openaiImageModel,
      prompt,
      n: 1,
      size: '1024x1024',
    }),
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    logger.error({ status: res.status, err: detail, url: config.imagesGenerationsUrl }, 'HOCAI image generate error');
    throw new Error(`HOCAI ${res.status} ${detail}`.trim());
  }

  return readImageResponse(res, 'HOCAI không trả về ảnh');
}

function imageBlob(image: Buffer, mime: string): { blob: Blob; filename: string } {
  const type = mime || 'image/jpeg';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  return {
    blob: new Blob([new Uint8Array(image)], { type }),
    filename: `image.${ext}`,
  };
}

async function editImageMultipart(
  image: Buffer,
  mime: string,
  prompt: string,
  fieldName: 'image' | 'image[]',
): Promise<Buffer> {
  const { blob, filename } = imageBlob(image, mime);
  const form = new FormData();
  form.append(fieldName, blob, filename);
  form.append('prompt', prompt);
  form.append('model', config.openaiImageModel);
  form.append('n', '1');
  form.append('size', '1024x1024');

  const res = await fetch(config.imagesEditsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hocaiApiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    logger.error(
      { status: res.status, err: detail, url: config.imagesEditsUrl, fieldName },
      'HOCAI image edit error',
    );
    throw new Error(`HOCAI ${res.status} ${detail}`.trim());
  }

  return readImageResponse(res, 'HOCAI không trả về ảnh đã chỉnh');
}

export async function editImage(image: Buffer, mime: string, prompt: string): Promise<Buffer> {
  try {
    return await editImageMultipart(image, mime, prompt, 'image');
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'images/edits field=image failed, retry image[]',
    );
    return editImageMultipart(image, mime, prompt, 'image[]');
  }
}

async function editImageViaJson(image: Buffer, mime: string, prompt: string): Promise<Buffer> {
  const dataUrl = `data:${mime || 'image/jpeg'};base64,${image.toString('base64')}`;
  const res = await fetch(config.imagesEditsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hocaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openaiImageModel,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
      image: dataUrl,
    }),
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`HOCAI ${res.status} ${detail}`.trim());
  }

  return readImageResponse(res, 'HOCAI không trả về ảnh đã chỉnh');
}

async function editImageViaChat(image: Buffer, mime: string, prompt: string): Promise<Buffer> {
  const dataUrl = `data:${mime || 'image/jpeg'};base64,${image.toString('base64')}`;
  const reply = await chatCompletions(
    [
      {
        role: 'system',
        content:
          'Chỉnh sửa đúng tấm ảnh người dùng gửi. Giữ người, khuôn mặt, dáng và chi tiết gốc. Chỉ thay đổi theo yêu cầu. Trả về ảnh kết quả (url hoặc base64), không tạo ảnh mới unrelated, không chỉ mô tả.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Chỉnh tấm ảnh này (đây là ảnh gốc, không được vẽ lại từ đầu): ${prompt}` },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    undefined,
    { model: config.openaiImageModel, maxTokens: 4096 },
  );

  if (reply.images[0] && looksLikeImage(reply.images[0])) {
    return reply.images[0];
  }
  throw new Error(reply.text || 'Model không trả về ảnh đã chỉnh từ ảnh gốc');
}

export async function editUploadedImage(image: Buffer, mime: string, prompt: string): Promise<Buffer> {
  const errors: string[] = [];

  try {
    return await editImage(image, mime, prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`edits-form: ${msg}`);
    logger.error({ err: msg }, 'images/edits multipart failed');
  }

  try {
    return await editImageViaJson(image, mime, prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`edits-json: ${msg}`);
    logger.error({ err: msg }, 'images/edits json failed');
  }

  try {
    return await editImageViaChat(image, mime, prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`chat-edit: ${msg}`);
    logger.error({ err: msg }, 'image chat edit failed');
  }

  throw new Error(
    `Không chỉnh được ảnh gốc (không tạo ảnh mới). ${errors.join(' | ')}`.slice(0, 500),
  );
}
