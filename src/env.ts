export interface Env {
  GEMINI_API_KEY: string;
  CONTEXT_KV: KVNamespace;
  CONTEXT_TTL_SECONDS: string;
  ASSETS: Fetcher;
}
