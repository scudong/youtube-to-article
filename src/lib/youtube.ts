import { HARDCODED_SUBTITLES } from '../data/subtitles.js';

const MAX_SUBTITLE_LENGTH = 120_000;

export async function getSubtitle(videoId: string): Promise<string> {
  if (videoId === 'xRh2sVcNXQ8') {
    return HARDCODED_SUBTITLES;
  }

  const text = await fetchYoutubeSubtitle(videoId);
  if (!text) {
    throw new Error(
      `字幕获取失败，YouTube 可能返回了验证码。请使用示例视频 xRh2sVcNXQ8 进行演示。`,
    );
  }
  return text.slice(0, MAX_SUBTITLE_LENGTH);
}

async function fetchYoutubeSubtitle(videoId: string): Promise<string | null> {
  try {
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const resp = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await resp.text();

    const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
    if (!captionMatch) return null;

    const tracks = JSON.parse(captionMatch[1]) as Array<{ baseUrl: string; languageCode: string }>;
    const track = tracks.find(t => t.languageCode === 'en') ?? tracks[0];
    if (!track?.baseUrl) return null;

    const subtitleResp = await fetch(track.baseUrl);
    const xml = await subtitleResp.text();

    const lines = xml
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    return lines.join(' ');
  } catch {
    return null;
  }
}

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
