import type { Env } from '../env.js';
import { getSubtitle, extractVideoId } from '../lib/youtube.js';
import { streamGenerate, validateModel } from '../lib/gemini.js';
import { saveContext, type ChapterMeta } from '../lib/contextStore.js';
import { toSSE, toSSEJSON } from '../lib/sse.js';
import { buildArticlePrompt } from '../prompts.js';

interface GenerateBody {
  url: string;
  userRequirements?: string;
  model?: string;
}

export async function handleGenerate(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const body = await request.json<GenerateBody>();

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

        if (toFlush) {
          fullHtml += toFlush;
          writer.write(encoder.encode(toSSE('chunk', toFlush)));
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
      fullHtml += buffer;
      writer.write(encoder.encode(toSSE('chunk', buffer)));
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
