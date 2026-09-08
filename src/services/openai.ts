import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { appendTurn, getHistory } from './history.js';
import { extractImageSources, sourcesToBuffers, stripImagePayloads, type ChatReply } from './media.js';
import { getChatModel } from './models.js';

const client = new OpenAI({
  apiKey: config.hocaiApiKey,
  baseURL: config.openaiBaseUrl,
});

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

type StreamAcc = {
  text: string;
  sources: string[];
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

function pushSources(acc: StreamAcc, payload: unknown, extraText = ''): void {
  for (const src of extractImageSources(payload, extraText)) {
    if (!acc.sources.includes(src)) acc.sources.push(src);
  }
}

function appendDeltaContent(acc: StreamAcc, content: unknown): void {
  if (typeof content === 'string') {
    acc.text += content;
    pushSources(acc, content, content);
    return;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        acc.text += part;
        continue;
      }
      if (part && typeof part === 'object') {
        const rec = part as { type?: string; text?: string };
        if (rec.type === 'text' && typeof rec.text === 'string') acc.text += rec.text;
      }
    }
    pushSources(acc, content);
  }
}

async function toChatReply(acc: StreamAcc): Promise<ChatReply> {
  const images = await sourcesToBuffers(acc.sources);
  const text = stripImagePayloads(acc.text).trim() || (images.length ? 'Đã tạo ảnh.' : '(trống)');
  return { text, images };
}

async function readSseContent(
  res: Response,
  onDelta?: OnDelta,
): Promise<ChatReply> {
  if (!res.body) {
    throw new Error('HOCAI không trả về stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const acc: StreamAcc = { text: '', sources: [] };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: unknown };
            message?: { content?: unknown };
          }>;
        };
        pushSources(acc, json);
        const delta = json.choices?.[0]?.delta;
        const message = json.choices?.[0]?.message;
        if (delta?.content != null) appendDeltaContent(acc, delta.content);
        else if (message?.content != null) appendDeltaContent(acc, message.content);

        const visible = stripImagePayloads(acc.text) || (acc.sources.length ? 'Đang tạo ảnh…' : '');
        if (visible) await onDelta?.(visible);
      } catch {
        // bỏ qua dòng SSE lỗi
      }
    }
  }

  return toChatReply(acc);
}

async function chatCompletions(
  messages: ChatCompletionMessage[],
  onDelta?: OnDelta,
): Promise<ChatReply> {
  const res = await fetch(config.chatCompletionsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hocaiApiKey}`,
      'Content-Type': 'application/json',
      Accept: config.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({
      model: getChatModel(),
      messages,
      stream: config.stream,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    }),
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    logger.error({ status: res.status, err: detail, url: config.chatCompletionsUrl }, 'HOCAI chat error');
    throw new Error(`HOCAI ${res.status} ${detail}`.trim());
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!config.stream || (contentType.includes('application/json') && !contentType.includes('text/event-stream'))) {
    const json: unknown = await res.json();
    const rec = json as { choices?: Array<{ message?: { content?: unknown } }> };
    const acc: StreamAcc = { text: '', sources: [] };
    pushSources(acc, json);
    appendDeltaContent(acc, rec.choices?.[0]?.message?.content);
    const reply = await toChatReply(acc);
    await onDelta?.(reply.text);
    return reply;
  }

  return readSseContent(res, onDelta);
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

export async function generateImage(prompt: string): Promise<Buffer> {
  let img;
  try {
    img = await client.images.generate({
      model: config.openaiImageModel,
      prompt,
      n: 1,
      size: '1024x1024',
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      logger.error(
        {
          action: 'image',
          status: err.status,
          code: err.code,
          type: err.type,
          err: err.message,
        },
        'HOCAI API error',
      );
      throw new Error(`HOCAI ${err.status ?? ''} ${err.message}`.trim());
    }
    throw err;
  }

  const item = img.data?.[0];
  if (item?.b64_json) {
    return Buffer.from(item.b64_json, 'base64');
  }
  if (item?.url) {
    const res = await fetch(item.url);
    if (!res.ok) {
      throw new Error(`Không tải được ảnh từ HOCAI (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  throw new Error('HOCAI không trả về ảnh');
}

export async function editImage(image: Buffer, mime: string, prompt: string): Promise<Buffer> {
  const type = mime || 'image/jpeg';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(image)], { type }), `image.${ext}`);
  form.append('prompt', prompt);
  form.append('model', config.openaiImageModel);
  form.append('n', '1');
  form.append('size', '1024x1024');

  const res = await fetch(`${config.openaiBaseUrl}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hocaiApiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    logger.error({ status: res.status, err: detail }, 'HOCAI image edit error');
    throw new Error(`HOCAI ${res.status} ${detail}`.trim());
  }

  const json: unknown = await res.json();
  const images = await sourcesToBuffers(extractImageSources(json));
  if (images[0]) return images[0];
  throw new Error('HOCAI không trả về ảnh đã chỉnh');
}
