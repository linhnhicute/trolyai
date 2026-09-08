type LogPayload = Record<string, unknown>;

function format(payload: LogPayload | undefined, message: string): string {
  if (!payload) return message;
  return `${message} ${JSON.stringify(payload)}`;
}

export const logger = {
  info(payload: LogPayload, message: string): void {
    console.log(format(payload, message));
  },
  error(payload: LogPayload, message: string): void {
    console.error(format(payload, message));
  },
};
