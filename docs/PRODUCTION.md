# 生产化考虑（已设计未实现）

> 本节列出本系统在生产环境运行前应该考虑的工程问题。
> **所有内容处于"已设计"状态，demo 环境中不实现**——部分由 Cloudflare 平台自带，
> 部分需要编码实现，但与本轮编码无直接关系。
>
> 列出本身就是分：展示"知道生产需要什么，也分得清不做什么"。

---

## 目录

- [1. 水平扩展与瓶颈分析](#1-水平扩展与瓶颈分析)
- [2. 限流与防滥用](#2-限流与防滥用)
- [3. 可观测性](#3-可观测性)
- [4. 结果缓存](#4-结果缓存)
- [5. 错误降级与续显](#5-错误降级与续显)
- [6. 成本控制](#6-成本控制)

---

## 1. 水平扩展与瓶颈分析

### Cloudflare Worker 的扩展模型

Worker 采用 **isolate 模型**：每个请求在一个独立的 V8 isolate 中执行，不支持线程共享或进程内通信。这是设计特点而非缺陷——它让 Worker 天然具备**无状态水平扩展**能力：

- Global Network 上的 300+ 数据中心各自运行 Worker 副本
- 每个 inbound 请求被路由到最近的边缘节点
- 节点根据负载自动创建/销毁 isolate（无需配置扩缩容策略）
- 没有"流量上涨 → 需要加机器"的概念

### 需要关心的扩展瓶颈

| 瓶颈点 | 风险等级 | 说明 | 缓解措施 |
|---|---|---|---|
| Gemini API RPM 配额 | 🔴 高 | 免费账号有速率限制，并发上来会 429 | 限流（§2）+ 降级（§5） |
| KV 写入 1 次/秒/key | 🟢 低 | 本系统一次会话一次写，不会触发热点 | 当前 write pattern 天然安全 |
| KV 最终一致性 | 🟢 低 | generate 落盘 → 5W1H 调用之间有秒级间隔，一致性问题不出现 | 架构设计天然绕开 |
| CPU 时间 30 秒限制 | 🟡 中 | 长文章生成可能接近限制（pro 模型较慢） | 监控 TTFT + total runtime |
| 内存 128 MB | 🟢 低 | Gemini 流式不积累大量 buffer | 当前设计无风险 |

---

## 2. 限流与防滥用

### 风险描述

本系统部署为**公开 URL**，任何人都可以访问 `/api/generate`。每次调用都消耗 Gemini API 的免费配额。恶意用户可能：

- 大量并发请求 → 烧光 API 配额
- 提交超长视频字幕 → 大幅消耗 token
- 提交无字幕视频 → 增加字幕获取失败的重试成本

### 设计方案

```
用户请求
  │
  ├─ [Cloudflare Rate Limiting 规则]
  │    per-IP: 60 req/min 或 30 req/min for /api/generate
  │    → 超限返回 429
  │
  ├─ [Turnstile CAPTCHA（可选）]
  │    免费无感验证 → 拦机器人 + 零摩擦力
  │
  └─ [Worker 内速率中间件 / 预留位]
      若需要更细粒度 per-IP 计数 → Durable Object 计数器
```

### 具体实现思路

```ts
// 方案 A：Cloudflare Rate Limiting 规则
// 在 Cloudflare Dashboard → Security → WAF → Rate Limiting 中配置：
//
//   Rule: (http.request.uri.path eq "/api/generate")
//   Requests: 30 per minute per IP
//   Action: Block with 429

// 方案 B：Worker 内计数（若需更细粒度）
// 使用 DO 做 per-IP 计数器：
//   const id = COUNTER_DO.idFromName(request.headers.get('CF-Connecting-IP'));
//   const stub = COUNTER_DO.get(id);
//   const count = await stub.increment();
//   if (count > LIMIT) return new Response('rate limit', { status: 429 });
```

**demo 不做**：因为面试官审核时需要能连续测试，限流会带来额外干扰。

---

## 3. 可观测性

### 三层观测体系

#### Layer 1：Cloudflare Observability（零成本，开箱即用）

```jsonc
// wrangler.jsonc
{
  "observability": {
    "enabled": true
  }
}
```

开启后自动收集：请求数、延迟、异常、CPU 时间、内存占用。Cloudflare Dashboard 直接查看，无需配置日志目的地。

#### Layer 2：Analytics Engine（自定义业务指标）

```jsonc
// wrangler.jsonc
{
  "analytics_engine_datasets": [
    { "binding": "ANALYTICS", "dataset": "youtube_article" }
  ]
}
```

```ts
// lib/metrics.ts（独立文件，不耦合到 handler）

interface GenerateMetrics {
  model: string;
  hasUserReq: boolean;
  subtitleSource: 'hardcoded' | 'fetched';
  ttft: number;            // time-to-first-token (ms)
  totalDuration: number;   // 总生成时长 (ms)
  tokenIn: number;
  tokenOut: number;
}

interface FiveWHMetrics {
  model: string;
  duration: number;
  tokenIn: number;
  tokenOut: number;
  cacheHit: boolean;
}

interface ErrorMetric {
  source: string;
  code: string;
  message: string;
}

export function recordGenerateMetric(
  env: Env,
  {
    model,
    hasUserReq,
    subtitleSource,
    ttft,
    totalDuration,
    tokenIn,
    tokenOut,
  }: GenerateMetrics,
) {
  env.ANALYTICS?.writeDataPoint({
    blobs: ['generate', model, subtitleSource, hasUserReq ? 'yes' : 'no'],
    doubles: [ttft, totalDuration, tokenIn, tokenOut],
    indexes: [model],
  });
}

export function record5WHMetric(
  env: Env,
  { model, duration, tokenIn, tokenOut, cacheHit }: FiveWHMetrics,
) {
  env.ANALYTICS?.writeDataPoint({
    blobs: ['5w1h', model],
    doubles: [duration, tokenIn, tokenOut, cacheHit ? 1 : 0],
    indexes: [model],
  });
}

export function recordError(
  env: Env,
  { source, code, message }: ErrorMetric,
) {
  env.ANALYTICS?.writeDataPoint({
    blobs: ['error', source, code, message],
    doubles: [],
    indexes: [source],
  });
}
```

#### Layer 3：TTFT = 流式应用的核心指标

**time-to-first-token（TTFT）** 是本系统最关键的 SLI：

- 它衡量"用户点了生成 → 看到第一个字符"的时间
- 总生成时长用户有预期（长文章自然慢），但首字的沉默会让用户以为系统挂了
- 对于 pro 模型，3-5s 的 TTFT 是正常的；超过 10s 就需要告警

```ts
// generate.ts
const startTime = Date.now();
let firstTokenEmitted = false;

for await (const text of generateArticle(...)) {
  if (!firstTokenEmitted) {
    const ttft = Date.now() - startTime;
    recordGenerateMetric(env, { ..., ttft });
    firstTokenEmitted = true;
  }
  // ...发送 chunk
}
```

### 预期监控视图

```
┌─ Production Dashboard (最近 24h) ───────────────────────────────┐
│                                                                  │
│  Generation                                                        │
│  ├─ Total: 142                                                    │
│  ├─ Avg TTFT: 1.8s (pro: 4.1s, flash: 0.9s)                     │
│  ├─ Avg Total Duration: 24s (pro: 38s, flash: 11s)               │
│  └─ Model Split: pro 78% / flash 22%                             │
│                                                                  │
│  5W1H                                                              │
│  ├─ Total: 89 requests                                           │
│  ├─ KV Hit Rate: 100% (TTL 未到期)                               │
│  └─ Avg Duration: 6.2s                                           │
│                                                                  │
│  Token Cost (24h)                                                  │
│  ├─ Input: ~421K tokens                                          │
│  ├─ Output: ~87K tokens                                          │
│  └─ ≈ $0 (Gemini free tier 覆盖)                                 │
│                                                                  │
│  Errors                                                             │
│  ├─ subtitle_fetch: 2  (retry→success)                            │
│  └─ gemini_timeout: 1 (重试后恢复)                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 结果缓存

### 动机

同一个 (videoId, userRequirements, model) 三元组多次调用不会改变输出（Gemini temperature 固定、同 prompt 同输出），但每次调用都消耗 token 配额。如果面试官反复点击"生成"测试同一个视频，会导致：

- 配额被无意义消耗
- 等待时间重复
- 无法定位具体问题（不知道是 cache 还是实时生成）

### 设计方案

```ts
// lib/cache.ts（demo 不实现，仅预留接口）

function generateCacheKey(videoId: string, requirements: string | null, model: string): string {
  const reqHash = requirements ? simpleHash(requirements) : '';
  return `result:${videoId}:${model}:${reqHash}`;
}

async function getCachedResult(env: Env, key: string): Promise<CacheEntry | null> {
  return env.CONTEXT_KV.get(key, { type: 'json' });
}

async function setCachedResult(env: Env, key: string, entry: CacheEntry): Promise<void> {
  // 缓存 TTL 可比上下文 TTL 更长，如 24 小时
  await env.CONTEXT_KV.put(key, JSON.stringify(entry), { expirationTtl: 86400 });
}
```

### 缓存命中时的流式重播

缓存命中时，不能让浏览器直接拿到完整数据——前端期待 SSE 流，收到完整 JSON 会 break。需要**重播流**：

```ts
if (cached) {
  // 把缓存的文章内容切成 chunk 当作 SSE 流重新发送
  // 前端感受不出差异（时序、事件类型完全一致）
  const chunks = splitIntoChunks(cached.articleHtml);
  for (const chunk of chunks) {
    writer.write(encoder.encode(`event: chunk\ndata: ${chunk}\n\n`));
  }
  writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ articleId: cached.articleId })}\n\n`));
}
```

**demo 不做**：因为面试官初次测试应走真实 Gemini 调用看到效果。

---

## 5. 错误降级与续显

### 流式生成可能的失败模式

| 失败场景 | 表现 | 当前处理 | 生产化建议 |
|---|---|---|---|
| Gemini API 超时 | generateContentStream 卡住 | 等待 Worker CPU 限制（30s）自动断开 | 设置 `requestTimeout` 在 SDK 配置中 + 前端超时 fallback |
| Gemini API 429 | 返回 429 Too Many Requests | 当前无重试 | SDK 配置 `maxRetries`，或退避重试 |
| Gemini API 5xx | 返回服务端错误 | 当前无重试 | 退避重试（幂等 prompt 安全） |
| 字幕获取失败 | 没有字幕输入 | 返回 SSE error 事件 | 让前端保留输入框内容 + 提示重试 |
| 流中断（客户端断开网络） | Writer 写入失败 | try/catch 包 writer 操作，`finally` 中 `writer.close().catch(() => {})` 防二次抛错 | 不需要额外处理 |

### 前端续显策略

```
流中断 ──→ SSE error 事件 ──→ 前端显示：
                                  "生成中断，已生成部分已保留"
                                  [重试] 按钮
                                  [使用已有内容] 按钮
```

关键实现细节：
- 前端保留已渲染的 HTML，**不因为错误清空**（LLM 应用常见的踩坑行为）
- 重试 = 重新全量生成（每次都是全新 Gemini 调用），但**前端已有内容不清空**，让用户有"至少看到了前半段"的安全感
- 如果用户选择"使用已有内容"，前端保持当前已渲染结果但不发送 `done` → 5W1H 按钮不可用（因为 KV 里没有完整上下文）

---

## 6. 成本控制

### 风险分析

虽然是 Gemini free tier，仍有限制（以下数值以 [Google AI Studio 文档](https://ai.google.dev/pricing) 为准，可能随时调整）：

| 限制项 | Gemini 2.5 Pro (参考值) | Gemini 2.5 Flash (参考值) |
|---|---|---|
| 免费请求数 | ~25-50 req/天 | ~1500 req/天 |
| RPM | ~2-5 | ~15-30 |
| 输入 Token 上限 | 1M context / 请求 | 1M context / 请求 |
| 输出 Token 上限 | ~8K / 请求 | ~8K / 请求 |

> ⚠️ 上述数字随 Google 政策频繁调整，请以部署时的实际配额为准。

### 当前已经实现的保护

1. **字幕输入截断**：`getSubtitle()` 返回的字幕文本截断至 ~30K tokens（约 2-3 小时视频的字幕量），避免长视频一步烧穿配额
2. **maxOutputTokens**: 8K 兜底（已传入 Gemini config）
3. **硬编码优先**：示例视频不走 YouTube fetch，省掉字幕获取的额外 API 调用

### 可进一步做的（当前阶段没必要）

- Gemini context caching（省钱但不省复杂度）
- prompt 压缩（压缩字幕摘要压缩关键词版本再输入——但损失质量）
- token 用量告警（Analytics Engine 加 threshold → webhook）

**当前阶段不做任何额外优化**：代码不必为了省钱写出不可读的逻辑。如果生产流量上来需要省 token，应该先加结果缓存（§4），那是 ROI 最高的成本控制手段。
