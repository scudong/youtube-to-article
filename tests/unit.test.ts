import { describe, it, expect } from 'vitest';

// ─── sse ───
import { toSSE, toSSEJSON } from '../src/lib/sse.js';

describe('toSSE', () => {
  it('encodes a simple SSE event', () => {
    expect(toSSE('chunk', 'hello')).toBe('event: chunk\ndata: hello\n\n');
  });
  it('encodes an event with a newline in data', () => {
    expect(toSSE('log', 'line1\nline2')).toBe('event: log\ndata: line1\nline2\n\n');
  });
});

describe('toSSEJSON', () => {
  it('encodes a JSON payload', () => {
    const result = toSSEJSON('done', { articleId: 'abc123' });
    expect(result).toContain('event: done');
    expect(result).toContain('data: {"articleId":"abc123"}');
    expect(result).toMatch(/\n\n$/);
  });
});

// ─── utils ───
import { nanoid } from '../src/utils.js';

describe('nanoid', () => {
  it('generates a string of the default length', () => {
    expect(nanoid()).toHaveLength(12);
  });
  it('generates a string of custom length', () => {
    expect(nanoid(8)).toHaveLength(8);
    expect(nanoid(20)).toHaveLength(20);
  });
  it('only contains alphanumeric characters', () => {
    const id = nanoid(100);
    expect(id).toMatch(/^[0-9a-z]+$/);
  });
  it('generates different values on successive calls', () => {
    const a = nanoid();
    const b = nanoid();
    expect(a).not.toBe(b);
  });
});

// ─── youtube.extractVideoId ───
import { extractVideoId } from '../src/lib/youtube.js';

describe('extractVideoId', () => {
  it('extracts from standard youtube.com/watch?v= URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=xRh2sVcNXQ8')).toBe('xRh2sVcNXQ8');
  });
  it('extracts from youtu.be short URL', () => {
    expect(extractVideoId('https://youtu.be/xRh2sVcNXQ8')).toBe('xRh2sVcNXQ8');
  });
  it('extracts from embed URL', () => {
    expect(extractVideoId('https://www.youtube.com/embed/xRh2sVcNXQ8')).toBe('xRh2sVcNXQ8');
  });
  it('extracts from URL with extra query params', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=xRh2sVcNXQ8&t=120s&feature=shared')).toBe('xRh2sVcNXQ8');
  });
  it('returns null for non-YouTube URL', () => {
    expect(extractVideoId('https://vimeo.com/12345')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(extractVideoId('')).toBeNull();
  });
  it('returns null for invalid YouTube URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?list=abc')).toBeNull();
  });
  it('handles URL with timestamp anchor', () => {
    expect(extractVideoId('https://youtu.be/xRh2sVcNXQ8?si=abc123')).toBe('xRh2sVcNXQ8');
  });
  it('extracts from mobile URL', () => {
    expect(extractVideoId('https://m.youtube.com/watch?v=xRh2sVcNXQ8')).toBe('xRh2sVcNXQ8');
  });
});

// ─── gemini.validateModel ───
import { validateModel } from '../src/lib/gemini.js';

describe('validateModel', () => {
  it('returns gemini-2.5-flash as-is', () => {
    expect(validateModel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });
  it('returns gemini-2.5-pro as-is', () => {
    expect(validateModel('gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });
  it('defaults to flash for unknown models', () => {
    expect(validateModel('gemini-2.0-pro')).toBe('gemini-2.5-flash');
  });
  it('defaults to flash for empty string', () => {
    expect(validateModel('')).toBe('gemini-2.5-flash');
  });
  it('defaults to flash for garbage input', () => {
    expect(validateModel('claude-4')).toBe('gemini-2.5-flash');
  });
});

// ─── markdownToHtml ───
import { parseArticleMarkdown } from '../src/lib/markdownToHtml.js';

describe('parseArticleMarkdown', () => {
  const SAMPLE = `# 测试文章标题

## **第一章：基础功能**

**发言人**: 这是第一段内容。

这是第二段内容，包含**重点**高亮。

## **第二章：进阶功能**

1. 第一项
2. 第二项
3. 第三项

**提问者**: 这是一个问题。
**回答者**: 这是回答内容。`;

  it('extracts the article title from H1', () => {
    const result = parseArticleMarkdown(SAMPLE);
    expect(result.title).toBe('测试文章标题');
  });

  it('detects chapters by ## headings', () => {
    const result = parseArticleMarkdown(SAMPLE);
    expect(result.chapters).toHaveLength(2);
  });

  it('strips bold markers from chapter titles', () => {
    const result = parseArticleMarkdown(SAMPLE);
    expect(result.chapters[0].title).toBe('第一章：基础功能');
    expect(result.chapters[1].title).toBe('第二章：进阶功能');
  });

  it('assigns sequential chapter IDs', () => {
    const result = parseArticleMarkdown(SAMPLE);
    expect(result.chapters[0].id).toBe('ch-1');
    expect(result.chapters[1].id).toBe('ch-2');
  });

  it('converts **bold** to <strong>bold</strong> in inline text', () => {
    const result = parseArticleMarkdown(SAMPLE);
    expect(result.chapters[0].html).toContain('<strong>重点</strong>');
  });

  it('preserves speaker names as <strong> tag at start of paragraph', () => {
    const result = parseArticleMarkdown(SAMPLE);
    expect(result.chapters[0].html).toContain('<strong>发言人</strong>:');
    expect(result.chapters[1].html).toContain('<strong>提问者</strong>:');
    expect(result.chapters[1].html).toContain('<strong>回答者</strong>:');
  });

  it('wraps ordered lists in <ol>', () => {
    const result = parseArticleMarkdown(SAMPLE);
    expect(result.chapters[1].html).toContain('<ol>');
    expect(result.chapters[1].html).toContain('<li>');
    expect(result.chapters[1].html).toMatch(/<ol>.*<li>第一项.*<li>第二项.*<li>第三项.*<\/ol>/s);
  });

  it('returns empty chapters for empty input', () => {
    const result = parseArticleMarkdown('');
    expect(result.title).toBe('');
    expect(result.chapters).toHaveLength(0);
  });

  it('does not include H1 as a chapter', () => {
    const result = parseArticleMarkdown(SAMPLE);
    expect(result.chapters[0].title).not.toBe('测试文章标题');
    expect(result.chapters[0].id).toBe('ch-1');
  });
});

describe('parseArticleMarkdown edge cases', () => {
  it('handles chapter without any content', () => {
    const md = `# Title\n\n## Empty Chapter\n\n## Another Chapter\n\nSome content.`;
    const result = parseArticleMarkdown(md);
    expect(result.chapters).toHaveLength(2);
  });

  it('handles multiple consecutive newlines', () => {
    const md = `# Title\n\n\n\n## Ch1\n\n\n\nWord.\n\n\n\n## Ch2\n\nDone.`;
    const result = parseArticleMarkdown(md);
    expect(result.chapters).toHaveLength(2);
  });

  it('returns no chapters when there is no H2 heading', () => {
    const md = `# Title\n\nJust some text.`;
    const result = parseArticleMarkdown(md);
    expect(result.chapters).toHaveLength(0);
    expect(result.title).toBe('Title');
  });

  it('handles real-world speaker pattern', () => {
    const md = `# Podcast\n\n## **嘉宾讨论**\n\n**Mark**: 这是讨论内容。\n\n**Jen**: 这是提问。`;
    const result = parseArticleMarkdown(md);
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].html).toContain('<strong>Mark</strong>:');
    expect(result.chapters[0].html).toContain('<strong>Jen</strong>:');
  });
});

// ─── prompts ───
import { buildArticlePrompt, build5W1HPrompt } from '../src/prompts.js';

describe('buildArticlePrompt', () => {
  const subtitles = 'This is the transcript.';

  it('includes the subtitles', () => {
    const result = buildArticlePrompt(subtitles);
    expect(result).toContain(subtitles);
  });

  it('does not include requirement block when requirements omitted', () => {
    const result = buildArticlePrompt(subtitles);
    expect(result).not.toContain('用户生成要求');
  });

  it('includes requirement block when requirements given', () => {
    const result = buildArticlePrompt(subtitles, '面向产品经理');
    expect(result).toContain('用户生成要求');
    expect(result).toContain('面向产品经理');
    expect(result).toContain('不得超出此范围');
  });

  it('includes the system role', () => {
    const result = buildArticlePrompt(subtitles);
    expect(result).toContain('系统角色');
    expect(result).toContain('中文内容写作助手');
  });
});

describe('build5W1HPrompt', () => {
  it('includes all context components', () => {
    const result = build5W1HPrompt('subtitles', 'article', 'ch1', '<p>html</p>');
    expect(result).toContain('subtitles');
    expect(result).toContain('article');
    expect(result).toContain('ch1');
    expect(result).toContain('<p>html</p>');
  });

  it('includes JSON schema instructions', () => {
    const result = build5W1HPrompt('s', 'a', 't', 'h');
    expect(result).toContain('who');
    expect(result).toContain('what');
    expect(result).toContain('when');
    expect(result).toContain('where');
    expect(result).toContain('why');
    expect(result).toContain('how');
  });
});

// ─── contextStore ───
import { saveContext, getContext } from '../src/lib/contextStore.js';

describe('contextStore TTL clamping', () => {
  it('saveContext clamps TTL to minimum 60', async () => {
    const mockKV = {
      async put(_key: string, _value: string, opts?: { expirationTtl?: number }) {
        expect(opts?.expirationTtl).toBe(60);
        return Promise.resolve();
      },
      async get<T>(_key: string): Promise<T | null> {
        return null;
      },
    };
    const id = await saveContext(mockKV as any, { subtitles: 's', articleHtml: 'h', chapters: [] }, 10);
    expect(id).toBeDefined();
    expect(id).toHaveLength(12); // nanoid default length
  });

  it('saveContext uses given TTL when ≥ 60', async () => {
    let capturedTtl = 0;
    const mockKV = {
      put(_key: string, _value: string, opts?: { expirationTtl?: number }) {
        capturedTtl = opts?.expirationTtl ?? 0;
        return Promise.resolve();
      },
      get<T>(_key: string): Promise<T | null> {
        return Promise.resolve(null);
      },
    };
    await saveContext(mockKV as any, { subtitles: 's', articleHtml: 'h', chapters: [] }, 3600);
    expect(capturedTtl).toBe(3600);
  });

  it('getContext returns null for missing entry', async () => {
    const mockKV = {
      get<T>(_key: string): Promise<T | null> {
        return Promise.resolve(null);
      },
    };
    const result = await getContext(mockKV as any, 'nonexistent');
    expect(result).toBeNull();
  });
});
