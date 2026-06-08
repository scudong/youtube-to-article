# YouTube → 中文访谈对话稿

把一条有字幕的 YouTube 视频，**流式生成**为一篇排版精致的中文访谈对话稿；每个章节可一键展开 **5W1H 结构化总结**。后端跑在 **Cloudflare Worker**，前端是单文件 HTML，全程零构建。

> **在线 Demo**：https://youtube-to-article.changyangdong.workers.dev
> **GitHub**：https://github.com/scudong/youtube-to-article

---

## 演示效果

**输入面板**：
- YouTube URL（必填）
- 自然语言生成要求（可选，如「面向产品经理，突出商业洞察」）
- 模型选择（Gemini 2.5 Pro / Flash）

**输出区**：
- 标题与章节实时流式渲染（边生成边显示）
- 每个章节标题旁有 `[5W1H]` 按钮，点击后弹出结构化总结表格（Who/What/When/Where/Why/How）

> 部署后将补充演示截图。

---

## 题目对应说明

> 本节直接对照笔试题《提交物 · 3》的 5 个要求点回答。详细技术细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 1. 如何获取和处理 YouTube 字幕

**三段式策略**（优先级递减）：

| 优先级 | 方案 | 状态 |
|---|---|---|
| P0 | 示例视频 `xRh2sVcNXQ8` 的字幕硬编码内置 | ✅ 实现，保证 demo 零翻车 |
| P1 | 开源库直连拉取（`youtubei.js` 等） | ✅ 实现，覆盖普通视频 |
| P2 | TCP Socket + webshare 代理（captcha 兜底） | 📝 仅 README 设计说明，未实现 |

**关键判断**：Worker 的 `fetch` API 不支持 `agent`/`proxy` 参数，且 Cloudflare 边缘 IP 段被 YouTube 重点防爬，常规场景必然遇到 captcha。Worker 唯一的代理方案是 `cloudflare:sockets` 的 TCP 接口手搓 HTTP CONNECT 隧道——成本高、对本题非核心，因此**讲清楚但不实现**。详见 [docs/ARCHITECTURE.md#字幕策略](docs/ARCHITECTURE.md#字幕策略)。

### 2. 如何调用 Gemini 并实现流式输出

```
浏览器 ──SSE── Worker ──TransformStream── Gemini SDK (generateContentStream)
   ▲              │
   └──── 边收边渲染（章节标记同步出现）
```

- **SDK**：`@google/genai`（新版统一 SDK，纯 fetch 实现，Worker 兼容）
- **协议**：SSE（`text/event-stream`），事件类型 `chunk` / `chapter` / `done` / `error`
- **流水**：Gemini 的 async iterator → `TransformStream.writer` → `Response(readable)`，**全程无中间缓冲**
- **关键代码**（节选）：

```ts
const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
ctx.waitUntil((async () => {
  const stream = await ai.models.generateContentStream({ model, contents });
  for await (const chunk of stream) writer.write(encoder.encode(toSSE('chunk', chunk.text)));
  writer.close();
})());
return new Response(readable, { headers: { 'content-type': 'text/event-stream' } });
```

详见 [docs/ARCHITECTURE.md#流式架构](docs/ARCHITECTURE.md#流式架构)。

### 3. 如何根据用户生成要求影响输出结果

`userRequirements` **非空时**才将约束块注入 prompt（空时整块省略，避免引入空指令噪声）；约束语气照搬题面措辞「不一定都满足，但不得超出」：

```
【用户生成要求（可选约束，可不全部覆盖，但不得超出此范围）】
{{ userRequirements }}
```

约束维度（题面规定）：任务类型 / 输出风格 / 目标受众 / 约束条件。

这一约束语气的设计避免 LLM 自由发挥越界，是 prompt 工程的核心——详见 [docs/ARCHITECTURE.md#prompt-约束边界](docs/ARCHITECTURE.md#prompt-约束边界)。

### 4. 如何实现章节级 5W1H 总结

**架构关键**：服务端在生成主文章时，把 `{ subtitles, articleHtml, chapters[] }` 落到 **Workers KV**，键为 `articleId`。5W1H 请求只需带 `articleId + chapterId`——**前端绝不回传整篇文章**（题面硬性要求）。

```
generate ──写KV── { articleId, subtitles, chapters }
                            ↓
5W1H(articleId, chapterId) ──读KV── 拼 prompt ── Gemini(responseSchema) ── 结构化 JSON
```

- **章节边界**：让 Gemini 在生成时输出 `<section data-chapter-id="ch-1" data-title="...">`，服务端流式 split 边收边发 `chapter` 事件
- **结构化输出**：Gemini `responseSchema` + `responseMimeType: 'application/json'`，强保证 JSON 格式
- **上下文复用**：5W1H prompt 拼接 `字幕 + 整篇文章 + 目标章节`，结合视频全局上下文

详见 [docs/ARCHITECTURE.md#章节-5w1h](docs/ARCHITECTURE.md#章节-5w1h)。

### 5. 主要工程取舍和亮点

按"重要性 + 非显然性"挑 6 个最值得讲的：

| # | 取舍 | 选了什么 | 为什么 |
|---|---|---|---|
| 1 | 协议 | **SSE**（不是 WebSocket） | 单向流足够，标准 `EventSource` 零依赖，事件类型语义天然分 chunk/chapter/done |
| 2 | 章节切分时机 | **LLM 生成时打标**（不是后处理） | 流式过程中 `[5W1H]` 按钮"边生成边可点"，体验领先一档 |
| 3 | 上下文存储 | **KV**（不是 Durable Object） | 一次写一次读、跨边缘节点可见、不触发热点写、最简实现，符合"忌臃肿" |
| 4 | 5W1H 上下文复用 | **简单 prompt 拼接**（不是 context caching） | 可控、可调试；context caching 复杂度更高，demo 规模收益不明显 |
| 5 | 模型选择 | **pro/flash 用户可切**（不是后端写死） | 流式体验 vs 内容质量是两个旋钮，把选择权还给用户而非替用户决策 |
| 6 | 字幕代理 | **不实现 TCP Socket，README 讲透** | 性价比判断：字幕本身非考点，但 Worker 平台限制必须讲明白 |

**生产化考虑**（已设计未实现）单独成篇：[docs/PRODUCTION.md](docs/PRODUCTION.md) — 涵盖水平扩展、限流防滥用、可观测性、结果缓存、错误降级。

---

## 快速开始

### 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars        # 填入 GEMINI_API_KEY
pnpm dev                              # wrangler dev
```

### 部署

```bash
# 一次性：在 Cloudflare 上创建 KV
pnpm wrangler kv namespace create CONTEXT_KV
# 把返回的 id 填回 wrangler.jsonc

# 一次性：注入线上密钥
pnpm wrangler secret put GEMINI_API_KEY

pnpm deploy                           # wrangler deploy
```

### GitHub Actions 自动部署

push 到 `main` 自动触发 `.github/workflows/deploy.yml`：`pnpm install → type-check → wrangler deploy`。

需在仓库 Settings → Secrets 配置：

| Secret | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers 部署权限 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户标识 |
| `GEMINI_API_KEY` | 同步到 Cloudflare secret store |

---

## 模块结构

```
src/
  index.ts              # Worker 入口：路由 + 静态资源 fallback
  handlers/
    generate.ts         # SSE 流：字幕 → Gemini → TransformStream
    fiveWH.ts           # 5W1H：KV 读 → responseSchema → JSON
  lib/
    youtube.ts          # 字幕来源：hardcoded → 库直连
    gemini.ts           # Gemini SDK 薄包装（pro/flash 切换 + 流式）
    contextStore.ts     # KV 读写：articleId → context
    sse.ts              # SSE 编码 helper（toSSE/parseEvents）
  prompts.ts            # 所有 prompt 模板（约束块、章节标记约定、5W1H schema）
public/
  index.html            # 单文件前端（Tailwind CDN + 原生 EventSource）
wrangler.jsonc          # Worker 配置 + KV binding + assets
.github/workflows/
  deploy.yml            # CI/CD：push to main → wrangler deploy
```

设计取舍：**没有 service/repository/factory 这种空抽象层**——三个 handler、四个 lib、一份 prompts，每个文件做一件事，符合题面「忌臃肿」。

---

## 文档导航

- [README.md](README.md)（本文）— 总览、题目对照、快速开始
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 详细架构、核心技术决策、流式协议设计
- [docs/PRODUCTION.md](docs/PRODUCTION.md) — 生产化考虑（已设计未实现）：扩展 / 限流 / 监控 / 缓存

---

## 提交物对照

| 提交物 | 位置 |
|---|---|
| GitHub 仓库 | https://github.com/scudong/youtube-to-article |
| 部署后公开 URL | https://youtube-to-article.changyangdong.workers.dev |
| 说明文档 · 字幕处理 | 本文 §1 + [docs/ARCHITECTURE.md#字幕策略](docs/ARCHITECTURE.md#字幕策略) |
| 说明文档 · Gemini 流式 | 本文 §2 + [docs/ARCHITECTURE.md#流式架构](docs/ARCHITECTURE.md#流式架构) |
| 说明文档 · 用户要求影响 | 本文 §3 + [docs/ARCHITECTURE.md#prompt-约束边界](docs/ARCHITECTURE.md#prompt-约束边界) |
| 说明文档 · 5W1H 实现 | 本文 §4 + [docs/ARCHITECTURE.md#章节-5w1h](docs/ARCHITECTURE.md#章节-5w1h) |
| 说明文档 · 工程取舍亮点 | 本文 §5 + [docs/PRODUCTION.md](docs/PRODUCTION.md) |
