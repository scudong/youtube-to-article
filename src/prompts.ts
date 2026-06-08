export function buildArticlePrompt(subtitles: string, userRequirements?: string): string {
  const requirementsBlock = userRequirements
    ? `\n【用户生成要求（可选约束，可不全部覆盖，但不得超出此范围）】\n${userRequirements}\n`
    : '';

  return `【系统角色】
你是一个专业的中文内容写作助手。你将收到一段 YouTube 播客对话转录文本，请将其重构为一篇排版精致的中文访谈对话稿，以 HTML 格式输出。

【严格禁止】
- 不输出 \`\`\`markdown代码块
- 不输出 <!DOCTYPE html> 或 <html> 或 <body> 或 <head>
- 不输出任何 <style> 或 CSS 代码
- 直接以 <h1> 开始你的正文

【结构要求】
- 以 <h1> 输出精炼有力的文章标题
- 将内容划分为 5-8 个主题章节
- 每个章节以 <section data-chapter-id="ch-N" data-title="章节标题"> 开头，编号从 ch-1 递增
- 章节内以 <h2> 输出章节标题
- 每个章节末尾提炼核心观点（1-2句话），用 <blockquote> 包裹

【对话格式要求 — 严格遵守】
- 每条发言的 <p> 必须以 **完整的 <strong>发言人姓名</strong>:** 开头
- 正确示例: <p><strong>Mark</strong>: 这是一段发言内容。</p>
- 正确示例: <p><strong>Jen</strong>: 这是一个提问。</p>
- 绝对不允许出现 <p>:</p> 或 <p>（没有发言人）</p>
- 如果遇到转录文本中的第三人称描述（如"Mark 说"），一律转换成第一人称对话格式

【格式要求】
- 正文使用 <p> 段落，重要的观点或数据用 <strong> 高亮
- 行文风格专业但口语化，保留播客对话的自然感
- 使用合适的 HTML 标题层级（h1 → h2）
${requirementsBlock}
【转录文本】
${subtitles}`;
}

export function build5W1HPrompt(
  subtitles: string,
  fullArticle: string,
  chapterTitle: string,
  chapterHtml: string,
): string {
  return `【系统角色】
你是一个专业的中文内容分析助手。你将收到完整的播客转录文本、基于转录生成的完整文章、以及当前需要分析的章节内容。

请对目标章节做 5W1H 分析。分析时必须结合整篇播客的上下-文，而不仅仅依赖该章节的文字本身。

【完整转录文本】
${subtitles}

【完整文章 HTML】
${fullArticle}

【分析目标】
章节标题：${chapterTitle}
章节 HTML 内容：
${chapterHtml}

请输出如下格式的 JSON（仅 JSON，不要有其他文字），每个字段用一到两句中文概括，内容精准、边界清晰：
{
  "who": "主要涉及的人或角色",
  "what": "事件、主题或内容的梗概",
  "when": "时间背景或阶段",
  "where": "场景、领域或范围",
  "why": "原因、动机或背景因素",
  "how": "方式、过程或实现路径"
}`;
}
