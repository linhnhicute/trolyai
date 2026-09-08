import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { appendTurn, getHistory } from './history.js';

const client = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl,
});

function rethrowApiError(err: unknown, action: string): never {
  if (err instanceof OpenAI.APIError) {
    logger.error(
      {
        action,
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

const SYSTEM_PROMPT =
  'Bạn là trợ lý AI trên Telegram. Trả lời bằng tiếng Việt, rõ ràng, ngắn gọn và hữu ích.';

export async function askGpt(chatId: number, userText: string): Promise<string> {
  try {
    const res = await client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...getHistory(chatId),
        { role: 'user', content: userText },
      ],
    });

    const reply = res.choices[0]?.message?.content?.trim() || '(trống)';
    appendTurn(
      chatId,
      { role: 'user', content: userText },
      { role: 'assistant', content: reply },
    );
    return reply;
  } catch (err) {
    rethrowApiError(err, 'chat');
  }
}

export async function askGptWithImage(
  chatId: number,
  prompt: string,
  dataUrl: string,
): Promise<string> {
  try {
    const res = await client.chat.completions.create({
      model: config.openaiModel,
      messages: [
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
    });

    const reply = res.choices[0]?.message?.content?.trim() || '(trống)';
    appendTurn(
      chatId,
      { role: 'user', content: `[Ảnh] ${prompt}` },
      { role: 'assistant', content: reply },
    );
    return reply;
  } catch (err) {
    rethrowApiError(err, 'vision');
  }
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
    rethrowApiError(err, 'image');
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
