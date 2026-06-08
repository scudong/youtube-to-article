import type { Env } from '../env.js';
import { getContext } from '../lib/contextStore.js';
import { generateStructured, validateModel } from '../lib/gemini.js';
import { build5W1HPrompt } from '../prompts.js';

interface FiveWHBody {
  articleId: string;
  chapterId: string;
  model?: string;
}

export async function handleFiveWH(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await request.json<FiveWHBody>();

  if (!body.articleId || !body.chapterId) {
    return json({ error: '缺少 articleId 或 chapterId' }, 400);
  }

  const context = await getContext(env.CONTEXT_KV, body.articleId);
  if (!context) {
    return json({ error: '文章上下文已过期或不存在，请重新生成' }, 404);
  }

  const chapter = context.chapters.find(c => c.id === body.chapterId);
  if (!chapter) {
    return json({ error: `章节 ${body.chapterId} 不存在` }, 404);
  }

  const model = validateModel(body.model ?? 'gemini-2.5-flash');
  const prompt = build5W1HPrompt(
    context.subtitles,
    context.articleHtml,
    chapter.title,
    chapter.html,
  );

  try {
    const result = await generateStructured(env.GEMINI_API_KEY, model, prompt);
    return json(result, 200);
  } catch (err) {
    return json({
      error: '5W1H 生成失败',
      detail: err instanceof Error ? err.message : 'unknown',
    }, 502);
  }
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
