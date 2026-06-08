import { nanoid } from '../utils.js';

export interface ChapterMeta {
  id: string;
  title: string;
  index: number;
  html: string;
}

export interface ArticleContext {
  subtitles: string;
  articleHtml: string;
  chapters: ChapterMeta[];
}

export async function saveContext(
  kv: KVNamespace,
  context: ArticleContext,
  ttl: number,
): Promise<string> {
  const articleId = nanoid();
  const effectiveTtl = Math.max(ttl, 60);
  await kv.put(articleId, JSON.stringify(context), { expirationTtl: effectiveTtl });
  return articleId;
}

export async function getContext(
  kv: KVNamespace,
  articleId: string,
): Promise<ArticleContext | null> {
  return kv.get<ArticleContext>(articleId, { type: 'json' });
}
