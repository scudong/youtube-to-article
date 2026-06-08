export function buildArticlePrompt(subtitles: string, userRequirements?: string): string {
  const requirementsBlock = userRequirements
    ? `\n【用户生成要求（可选约束，可不全部覆盖，但不得超出此范围）】\n${userRequirements}\n`
    : '';

  return `【系统角色】
你是一个专业的中文内容写作助手。你将收到一段 YouTube 播客对话转录文本，请将其重构为一篇排版精致的中文访谈对话稿，以 HTML 格式输出。

【输出要求】
- 直接输出 HTML，不要包含 markdown 代码块标记（\`\`\`）
- 以 <h1> 输出文章标题（精炼有力，吸引读者）
- 将内容划分为 5-8 个主题章节
- 每个章节必须以 <section data-chapter-id="ch-N" data-title="章节标题"> 开头，章节编号从 ch-1 开始递增
- 章节内以 <h2> 输出章节标题
- 如果段落有对话性质，保留发言人标记，使用 <strong>标签包裹发言人姓名（如 Mark、Jen、John）
- 正文使用 <p> 段落，重要观点可加 <strong> 高亮
- 行文风格：专业但口语化，保留播客对话的自然感，避免教科书的生硬
- 每个章节末尾应提炼该章节的核心观点（1-2句话），用 <blockquote> 包裹

【排版要求】
- 使用合适的 HTML 标题层级（h1 → h2 → 不需要 h3）
- 适当分段，每段不宜过长
- 重要的数据或观点单独成段突出
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

请对目标章节做 5W1H 分析。分析时必须结合整篇播客的上下文，而不仅仅依赖该章节的文字本身。

【完整转录文本】
${subtitles}

【完整文章 HTML】
${fullArticle}

【分析目标】
章节标题：${chapterTitle}
章节 HTML 内容：
${chapterHtml}

请输出如下格式的 JSON（仅 JSON，不要有其他文字），每个字段用一到两句中文概括，内容精准、边界清晰：{
  "who": "主要涉及的人或角色",
  "what": "事件、主题或内容的梗概",
  "when": "时间背景或阶段",
  "where": "场景、领域或范围",
  "why": "原因、动机或背景因素",
  "how": "方式、过程或实现路径"
}`;
}
