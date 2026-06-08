import type { Env } from './env.js';
import { handleGenerate } from './handlers/generate.js';
import { handleFiveWH } from './handlers/fiveWH.js';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/generate') {
      return handleGenerate(request, env, ctx);
    }

    if (request.method === 'POST' && url.pathname === '/api/5w1h') {
      return handleFiveWH(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
