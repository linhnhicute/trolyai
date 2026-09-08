import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { appendTurn, getHistory } from './history.js';

const client = new OpenAI({
  apiKey: config.hocaiApiKey,
  baseURL: config.openaiBaseUrl,
});

const SYSTEM_PROMPT =
  'Bạn là trợ lý AI trên Telegram. Trả lời bằng tiếng Việt, rõ ràng, ngắn gọn và hữu ích.';

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

async function readErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return json.error?.message || json.message || text;
  } catch {
    return text;
  }
}

async function readSseContent(
  res: Response,
  onDelta?: (text: string) => Promise<void> | void,
): Promise<string> {
  if (!res.body) {
    throw new Error('HOCAI không trả về stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

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
            delta?: { content?: string };
            message?: { content?: string };
          }>;
        };
        const piece = json.choices?.[0]?.delta?.content;
        if (typeof piece === 'string') {
          content += piece;
          await onDelta?.(content);
          continue;
        }
        const full = json.choices?.[0]?.message?.content;
        if (typeof full === 'string') {
          content += full;
          await onDelta?.(content);
        }
      } catch {
        // bỏ qua dòng SSE lỗi
      }
    }
  }

  return content;
}

type OnDelta = (text: string) => Promise<void> | void;

async function chatCompletions(
  messages: ChatCompletionMessage[],
  onDelta?: OnDelta,
): Promise<string> {
  const res = await fetch(config.chatCompletionsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hocaiApiKey}`,
      'Content-Type': 'application/json',
      Accept: config.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({
      model: config.openaiModel,
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
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content?.trim() || '(trống)';
    await onDelta?.(reply);
    return reply;
  }

  const reply = (await readSseContent(res, onDelta)).trim();
  return reply || '(trống)';
}

export async function askGpt(
  chatId: number,
  userText: string,
  onDelta?: OnDelta,
): Promise<string> {
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
    { role: 'assistant', content: reply },
  );
  return reply;
}

export async function askGptWithImage(
  chatId: number,
  prompt: string,
  dataUrl: string,
  onDelta?: OnDelta,
): Promise<string> {
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
    { role: 'assistant', content: reply },
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
