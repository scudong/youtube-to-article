export interface ParsedChapter {
  id: string;
  title: string;
  html: string;
}

export function parseArticleMarkdown(raw: string): { title: string; chapters: ParsedChapter[] } {
  const lines = raw.split('\n').map(l => l.trimEnd());
  const chapters: ParsedChapter[] = [];
  let articleTitle = '';
  let currentTitle = '';
  let chapterAcc: string[] = [];

  function flushChapter() {
    if (!currentTitle) return;
    const html = convertChapterBody(chapterAcc);
    chapters.push({
      id: `ch-${chapters.length + 1}`,
      title: currentTitle,
      html,
    });
    chapterAcc = [];
  }

  for (const line of lines) {
    if (!articleTitle && !line.trim()) continue;

    const h1Match = line.match(/^#\s+(.+)/);
    if (!articleTitle && h1Match && !line.startsWith('##')) {
      articleTitle = h1Match[1].trim();
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      flushChapter();
      currentTitle = h2Match[1].replace(/\*\*/g, '').trim();
      chapterAcc.push(`<h2>${currentTitle}</h2>`);
      continue;
    }

    if (line.match(/^###\s+/)) continue;
    if (line.match(/^---/)) continue;

    if (line.match(/^\d+\.\s+/)) {
      chapterAcc.push(`<li>${convertInline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    if (!line.trim() && chapterAcc.length > 0 && chapterAcc[chapterAcc.length - 1].startsWith('<li>')) {
      chapterAcc.push('</ol>');
      continue;
    }

    if (line.trim()) {
      chapterAcc.push(`<p>${convertInline(line.trim())}</p>`);
    }
  }

  flushChapter();

  return {
    title: articleTitle || chapters[0]?.title || '',
    chapters,
  };
}

function convertInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function convertChapterBody(lines: string[]): string {
  const body = lines.join('\n');
  let processed = body.replace(/(<li>.*?<\/li>\s*)+/g, match => {
    if (match.includes('</ol>')) return match;
    return `<ol>${match.trim()}</ol>`;
  });
  processed = processed.replace(/<p>\s*<\/p>/g, '');
  return processed;
}
