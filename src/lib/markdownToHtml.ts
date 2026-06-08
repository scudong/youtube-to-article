export interface ParsedChapter {
  id: string;
  title: string;
  html: string;
}

export function parseArticleMarkdown(raw: string): { title: string; chapters: ParsedChapter[] } {
  const lines = raw.split('\n').map(l => l.trimEnd());
  const chapters: ParsedChapter[] = [];
  let currentTitle = '';
  let chapterAcc: string[] = [];
  let chapterIdx = 0;

  function flushChapter() {
    if (!currentTitle) return;
    const html = convertChapterBody(chapterAcc);
    chapters.push({
      id: `ch-${chapterIdx + 1}`,
      title: currentTitle,
      html,
    });
    chapterIdx++;
    chapterAcc = [];
  }

  for (const line of lines) {
    // Skip empty lines at start
    if (!currentTitle && !line.trim()) continue;

    // H1 = article title (first line starting with # that's not ##)
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match && !line.startsWith('##')) {
      currentTitle = h1Match[1].trim();
      continue;
    }

    // H2 = chapter boundary
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      flushChapter();
      currentTitle = h2Match[1].replace(/\*\*/g, '').trim();
      chapterAcc.push(`<h2>${h2Match[1].replace(/\*\*/g, '').trim()}</h2>`);
      continue;
    }

    // ### = subheading
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      chapterAcc.push(`<h3>${h3Match[1].replace(/\*\*/g, '').trim()}</h3>`);
      continue;
    }

    // Horizontal rule
    if (line.match(/^---/)) continue;

    // Ordered list item
    if (line.match(/^\d+\.\s+/)) {
      chapterAcc.push(`<li>${convertInline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    // Empty line between list items – close if we had list items
    if (!line.trim() && chapterAcc.length > 0 && chapterAcc[chapterAcc.length - 1].startsWith('<li>')) {
      chapterAcc.push('</ol>');
      continue;
    }

    // Regular paragraph
    if (line.trim()) {
      chapterAcc.push(`<p>${convertInline(line.trim())}</p>`);
    }
  }

  flushChapter();

  return {
    title: chapters[0]?.title ?? '',
    chapters,
  };
}

function convertInline(text: string): string {
  // **bold** → <strong>bold</strong>
  let result = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Speaker: pattern like <strong>Jen</strong>:
  result = result.replace(/<strong>([^<]+)<\/strong>:(?!\S)/g, '<strong>$1</strong>:');
  return result;
}

function convertChapterBody(lines: string[]): string {
  const body = lines.join('\n');
  // Wrap consecutive <li> in <ol>
  let processed = body.replace(/(<li>.*?<\/li>\s*)+/g, match => {
    if (match.includes('</ol>')) return match;
    return `<ol>${match.trim()}</ol>`;
  });
  // Clean up empty <p></p>
  processed = processed.replace(/<p>\s*<\/p>/g, '');
  return processed;
}
