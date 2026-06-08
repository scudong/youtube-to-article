export function toSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export function toSSEJSON(event: string, payload: unknown): string {
  return toSSE(event, JSON.stringify(payload));
}
