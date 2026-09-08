export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const store = new Map<number, ChatMessage[]>();
let historyLimit = 10;

export function configureHistory(limit: number): void {
  historyLimit = limit;
}

export function getHistory(chatId: number): ChatMessage[] {
  return store.get(chatId) ?? [];
}

export function appendTurn(chatId: number, user: ChatMessage, assistant: ChatMessage): void {
  const next = [...getHistory(chatId), user, assistant];
  const maxMessages = historyLimit * 2;
  store.set(chatId, next.slice(-maxMessages));
}

export function resetHistory(chatId: number): void {
  store.delete(chatId);
}
