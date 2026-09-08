import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

export type HocaiModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  provider?: string;
  displayName?: string;
  inputPer1M?: number;
  outputPer1M?: number;
  discountPercent?: number;
};

type PricingRow = {
  model_name?: string;
  display_name?: string;
  model_pattern?: string;
  input_price_per_1k?: number;
  output_price_per_1k?: number;
  discount_percent?: number;
  priority?: number;
  is_active?: boolean;
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

  const models = data.filter((item): item is HocaiModel => Boolean(item && typeof item.id === 'string'));
  const pricing = await fetchPricingRows();
  return models.map((model) => applyPricing(model, pricing));
}

async function fetchPricingRows(): Promise<PricingRow[]> {
  try {
    const res = await fetch(config.pricingUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: PricingRow[] } | PricingRow[];
    const rows = Array.isArray(json) ? json : json.data;
    return Array.isArray(rows) ? rows.filter((row) => row.is_active !== false) : [];
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Không lấy được bảng giá HOCAI',
    );
    return [];
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function applyPricing(model: HocaiModel, rows: PricingRow[]): HocaiModel {
  const id = model.id;
  let matched: PricingRow | undefined =
    rows.find((row) => row.model_name === id) ??
    rows.find((row) => row.display_name?.toLowerCase() === id.toLowerCase());

  if (!matched) {
    const patternHits = rows
      .filter((row) => row.model_pattern && globToRegExp(row.model_pattern).test(id))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    matched = patternHits[0];
  }

  if (!matched) return model;

  const inputPer1k = Number(matched.input_price_per_1k);
  const outputPer1k = Number(matched.output_price_per_1k);
  return {
    ...model,
    displayName: matched.display_name || model.displayName,
    inputPer1M: Number.isFinite(inputPer1k) ? inputPer1k * 1000 : undefined,
    outputPer1M: Number.isFinite(outputPer1k) ? outputPer1k * 1000 : undefined,
    discountPercent: Number(matched.discount_percent) || undefined,
  };
}

function formatCredit(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatModelLine(model: HocaiModel, current: string): string {
  const mark = model.id === current ? ' ← đang dùng' : '';
  const owner = model.owned_by && model.owned_by !== '...' ? ` (${model.owned_by})` : '';
  const title = model.displayName && model.displayName !== model.id ? `${model.id} — ${model.displayName}` : model.id;
  let price = '';
  if (model.inputPer1M != null || model.outputPer1M != null) {
    price = ` | in ${formatCredit(model.inputPer1M)} | out ${formatCredit(model.outputPer1M)} Credit/1M`;
    if (model.discountPercent) price += ` -${model.discountPercent}%`;
  }
  return `• ${title}${owner}${price}${mark}`;
}

export function findModel(models: HocaiModel[], name: string): HocaiModel | undefined {
  const needle = name.trim();
  return (
    models.find((m) => m.id === needle) ??
    models.find((m) => m.id.toLowerCase() === needle.toLowerCase())
  );
}
