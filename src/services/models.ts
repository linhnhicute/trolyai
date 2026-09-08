import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

export type HocaiModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
};

let currentModel = config.openaiModel;

function dataFile(): string {
  const dir = process.env.DATA_DIR?.trim() || path.resolve('data');
  return path.join(dir, 'selected-model.json');
}

export function getChatModel(): string {
  return currentModel;
}

export async function loadSelectedModel(): Promise<void> {
  try {
    const raw = await readFile(dataFile(), 'utf8');
    const parsed = JSON.parse(raw) as { model?: string };
    if (parsed.model?.trim()) {
      currentModel = parsed.model.trim();
      logger.info({ model: currentModel }, 'Đã tải model đã chọn');
    }
  } catch {
    currentModel = config.openaiModel;
  }
}

async function persistSelectedModel(model: string): Promise<void> {
  const file = dataFile();
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ model }, null, 2), 'utf8');
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Không lưu được model đã chọn (vẫn dùng trong phiên này)',
    );
  }
}

export async function setChatModel(model: string): Promise<string> {
  const id = model.trim();
  if (!id) {
    throw new Error('Thiếu tên model');
  }
  currentModel = id;
  await persistSelectedModel(id);
  return id;
}

export async function listHocaiModels(): Promise<HocaiModel[]> {
  const res = await fetch(config.modelsUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.hocaiApiKey}`,
      Accept: 'application/json',
    },
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
      detail = json.error?.message || json.message || text;
    } catch {
      // keep text
    }
    logger.error({ status: res.status, err: detail, url: config.modelsUrl }, 'HOCAI models error');
    throw new Error(`HOCAI ${res.status} ${detail}`.trim());
  }

  const json = JSON.parse(text) as { data?: HocaiModel[] } | HocaiModel[];
  const data = Array.isArray(json) ? json : json.data;
  if (!Array.isArray(data)) {
    throw new Error('HOCAI không trả về danh sách model');
  }

  return data.filter((item): item is HocaiModel => Boolean(item && typeof item.id === 'string'));
}

export function findModel(models: HocaiModel[], name: string): HocaiModel | undefined {
  const needle = name.trim();
  return (
    models.find((m) => m.id === needle) ??
    models.find((m) => m.id.toLowerCase() === needle.toLowerCase())
  );
}
