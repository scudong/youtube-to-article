import type { Env } from '../env.js';
import { getSubtitle, extractVideoId } from '../lib/youtube.js';
import { streamGenerate, validateModel } from '../lib/gemini.js';
import { saveContext, type ChapterMeta } from '../lib/contextStore.js';
import { toSSE, toSSEJSON } from '../lib/sse.js';
import { buildArticlePrompt } from '../prompts.js';
import { DEMO_MARKDOWN } from '../data/demoArticle.js';
import { parseArticleMarkdown } from '../lib/markdownToHtml.js';

const CSS_BLOCK_RE = /<style[^>]*>[\s\S]*?<\/style>/gi;
const DOCTYPE_RE = /<!DOCTYPE\s+html[^>]*>/gi;

function sanitizeHTML(html: string): string {
  return html
    .replace(CSS_BLOCK_RE, '')
    .replace(DOCTYPE_RE, '')
    .replace(/<p[^>]*>:\s*/gi, '<p>')
    .replace(/<p[^>]*>：(?:\s*)/gi, '<p>');
}

interface GenerateBody {
  url: string;
  userRequirements?: string;
  model?: string;
  useDemo?: boolean;
}

export async function handleGenerate(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const body = await request.json<GenerateBody>();

  if (body.useDemo) {
    return handleDemoGenerate(env, ctx);
  }

  const videoId = extractVideoId(body.url ?? '');
  if (!videoId) {
    return new Response(JSON.stringify({ error: '无效的 YouTube URL' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const model = validateModel(body.model ?? 'gemini-2.5-flash');

  let subtitles: string;
  try {
    subtitles = await getSubtitle(videoId);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : '字幕获取失败' }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  ctx.waitUntil(processStream(writer, encoder, { subtitles, model, userRequirements: body.userRequirements }, env));

  return new Response(readable, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}

interface StreamParams {
  subtitles: string;
  model: string;
  userRequirements?: string;
}

async function processStream(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  params: StreamParams,
  env: Env,
): Promise<void> {
  const prompt = buildArticlePrompt(params.subtitles, params.userRequirements);
  const chapters: ChapterMeta[] = [];
  let fullHtml = '';
  let buffer = '';

  try {
    try {
      for await (const text of streamGenerate(env.GEMINI_API_KEY, params.model, prompt)) {
        buffer += text;

        const sectionRegex = /<section\s+data-chapter-id="([^"]+)"\s+data-title="([^"]+)"[^>]*>/g;
        let match: RegExpExecArray | null;

        while ((match = sectionRegex.exec(buffer)) !== null) {
          const chapter: ChapterMeta = {
            id: match[1],
            title: match[2],
            index: chapters.length,
            html: '',
          };
          chapters.push(chapter);
          writer.write(encoder.encode(toSSEJSON('chapter', { id: chapter.id, title: chapter.title, index: chapter.index })));
        }

        const safePoint = buffer.lastIndexOf('<');
        const flushEnd = safePoint > 0 ? safePoint : buffer.length;
        const toFlush = buffer.slice(0, flushEnd);

        const cleaned = sanitizeHTML(toFlush);
        if (cleaned) {
          fullHtml += cleaned;
          writer.write(encoder.encode(toSSE('chunk', cleaned)));
        }
        buffer = buffer.slice(flushEnd);
      }
    } catch (streamErr) {
      // Gemini API 有时在流末尾发一段不完整的 JSON 导致 SDK 抛解析异常，
      // 但如果内容已收到，这不算致命错误。检查是否有内容再决定。
      if (!fullHtml && !buffer) throw streamErr;
      // 有内容则忽略流的尾段错误，flush 剩余 buffer 后正常完成
    }

    if (buffer) {
      const cleaned = sanitizeHTML(buffer);
      if (cleaned) {
        fullHtml += cleaned;
        writer.write(encoder.encode(toSSE('chunk', cleaned)));
      }
    }

    assignChapterHtml(chapters, fullHtml);

    const ttl = parseInt(env.CONTEXT_TTL_SECONDS, 10) || 3600;
    const articleId = await saveContext(env.CONTEXT_KV, {
      subtitles: params.subtitles,
      articleHtml: fullHtml,
      chapters,
    }, ttl);

    writer.write(encoder.encode(toSSEJSON('done', { articleId })));
  } catch (err) {
    writer.write(encoder.encode(toSSEJSON('error', {
      code: 'GENERATE_ERROR',
      message: err instanceof Error ? err.message : 'unknown error',
    })));
  } finally {
    await writer.close().catch(() => {});
  }
}

function assignChapterHtml(chapters: ChapterMeta[], html: string): void {
  for (let i = 0; i < chapters.length; i++) {
    const startTag = `data-chapter-id="${chapters[i].id}"`;
    const startIdx = html.indexOf(startTag);
    if (startIdx === -1) continue;

    const sectionStart = html.lastIndexOf('<section', startIdx);
    const endTag = '</section>';
    let endIdx: number;

    if (i < chapters.length - 1) {
      const nextTag = `data-chapter-id="${chapters[i + 1].id}"`;
      const nextIdx = html.indexOf(nextTag);
      endIdx = html.lastIndexOf(endTag, nextIdx);
    } else {
      endIdx = html.lastIndexOf(endTag);
    }

    if (sectionStart >= 0 && endIdx >= 0) {
      chapters[i].html = html.slice(sectionStart, endIdx + endTag.length);
    }
  }
}

// ─── Demo mode ───

async function handleDemoGenerate(
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  ctx.waitUntil(streamDemoArticle(writer, encoder, env));

  return new Response(readable, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
  });
}

async function streamDemoArticle(
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  env: Env,
): Promise<void> {
  try {
    const { chapters: parsed } = parseArticleMarkdown(DEMO_MARKDOWN);
    const chapters: ChapterMeta[] = parsed.map((pc, i) => ({ id: pc.id, title: pc.title, index: i, html: '' }));

    for (const ch of chapters) {
      writer.write(encoder.encode(toSSEJSON('chapter', { id: ch.id, title: ch.title, index: ch.index })));
    }

    for (let i = 0; i < parsed.length; i++) {
      const html = parsed[i].html;
      for (let pos = 0; pos < html.length; pos += 60) {
        writer.write(encoder.encode(toSSE('chunk', html.slice(pos, pos + 60))));
        await new Promise(r => setTimeout(r, 8));
      }
    }

    const fullHtml = parsed.map(c => c.html).join('\n');
    // 按章节切分 html，使 5W1H 能精确定位到各章节内容
    for (let i = 0; i < chapters.length; i++) {
      chapters[i].html = parsed[i].html;
    }

    const ttl = parseInt(env.CONTEXT_TTL_SECONDS, 10) || 3600;
    // subtitles 存原始 markdown，让 5W1H 能结合完整内容做分析
    const articleId = await saveContext(env.CONTEXT_KV, { subtitles: DEMO_MARKDOWN, articleHtml: fullHtml, chapters }, ttl);
    writer.write(encoder.encode(toSSEJSON('done', { articleId })));
  } catch (err) {
    writer.write(encoder.encode(toSSEJSON('error', { code: 'DEMO_ERROR', message: err instanceof Error ? err.message : '' })));
  } finally {
    await writer.close().catch(() => {});
  }
}
