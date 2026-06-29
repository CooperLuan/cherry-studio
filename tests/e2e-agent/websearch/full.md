# Web Search E2E — full（agentic·live）规格（SoT · driving 锚点已校准 · blocked on golden fixture）

> 域 spec 的 **full 层**，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**。
> 与 [`light-medium.md`](light-medium.md)（设置页配置面，离线）正交：本文件测「**assistant / agent 真的会调用网络搜索工具**」——live、LLM+网络、非确定性，只断**工具触发的信封**。
> **状态（2026-06-27 live 校准 `full-cal-165734`）**：**driving 锚点全部实测确认**（选择/输入/发送，见 §0）；但 **WS-F1/WS-F2 均未触发工具信封 → 根因是 golden fixture / prompt 缺口，不是框架或产品 bug**（见 §2）。**待 golden 补齐后编码 YAML。**

## 0. 表面与锚点（✅ 已 live 校准）

### A. 经典 assistant 聊天（`enableWebSearch` AI-SDK 工具路径）
- **入口**：左侧栏 → assistant（`nav: assistants`）。
- **选 assistant（✅ 确认）**：底部 picker `button[data-slot=popover-trigger]` → 弹出后 `[role=option]` 按文本（如 `E2E_WebSearch_Test_Assistant`）。
- **触发条件**：`assistant.settings.enableWebSearch === true`（`src/main/ai/tools/adapters/aiSdk/builtin/WebSearchTool.ts:45` 的 `applies` 门）。⚠️**当前 golden 该值为 false → 工具不暴露**（§2 WS-F1）。
- **输入（✅ 确认）**：`[contenteditable="true"]`（`#inputbar` Tiptap，`ComposerSurface.tsx`）；实测可写入 `<p>...</p>`。
- **发送（✅ 确认）**：`i[role="button"][aria-label=发送]`（i18n `chat.input.send`；Enter 亦发送）。
- **信封**：assistant 路径**也走 process-history**（full-envelope-cal 实测 WS-F1 = 9 个工具调用折叠在 process-history，非 inline）→ **gate 同 §0.B 的 `[data-testid=message-tool-history]`**（统一）。

### B. v2 agent（`/app/agents`，MCP 工具路径）
- **入口**：`nav: agents` → 页容器 `#agent-page`。
- **选 agent（✅ 确认）**：`button[data-slot=popover-trigger]` → 菜单 `role=listbox` → `[role=option]` 按文本（如 `E2E_WebSearch_Test_Agent`）。新会话流实测可达。
- **触发条件**：agent 启用 `web_search`（MCP `mcp__cherry-tools__web_search`）；golden 各 agent 实测 **web_search 可用**（`disabled_tools=[]`）。
- **输入 / 发送**：同 §0.A（Tiptap + `aria-label=发送`）。
- **信封 = `[data-testid=message-tool-history]`（✅ 定稿 · full-envelope-cal 实测）**：工具调用**默认折叠在 process-history 组**（`blocks/MessagePartsRenderer.tsx`），该组**仅 ≥1 工具被调时才渲染** → **存在即 gate**（本仓已给其 button 加 `data-testid=message-tool-history` + `data-tool-count`，locale-robust）。`check: visible {testid: message-tool-history} timeout: 180s` 一步搞定，**无需展开**。
  - ⚠️ **`collapse-content-{key}` 不可作锚**：实测 suffix = **动态调用 ID**（`call_function_xxx`、`call_8640f...`），跨 run 不稳；未映射工具（web_fetch）落 `collapse-content-unknown-tool`。工具**类型**只在标题文本（「N 个搜索结果」/「web_fetch 工具」），不作 gate。
  - count 来自 live `ExecutionOverlay`、run 进行中即出现；**首个工具调用 ~70s（assistant）/~81s（agent）后才现** → timeout `180s`。message 在 run 期间持续 `pending`/`parts=[]`（overlay 渲染）→ **不等消息完成**（整轮可 4 分钟+），`data-status=done` 弃用。

## 1. 红线 + gate 语义

- `check:` 只断**工具触发的信封**：工具块在场 / disclosure 在场 / 计数 `\d+`。**禁断**结果内容/命中/排序/质量/生成文本（红线）。
- **live**：`live: [llm, websearch]`。
- **gate 三分（本次校准印证）**：信封未出现有三种根因，必须区分——
  1. **配置缺口**：工具未暴露（如 `enableWebSearch=false`）→ 模型常吐文本形式 `[TOOL_CALL]`（铁证）→ **修 golden fixture**。
  2. **prompt 缺陷**：工具已暴露但请求欠具体 → 模型反问 → **改 forcing prompt（给具体主题）**。
  3. **capability**：工具已暴露 + prompt 明确，模型仍不调 → **只记录不修**（[[agent-tool-bug-vs-model-capability]]）。
  4.（**工具 bug**：任何配置/任何模型都不触发 → 才改产品代码。）

## 2. 用例

### WS-F1 assistant 真的用网络搜索（经典聊天）— ✅ 已编码（`cases/full/WS-F1-assistant-websearch.yaml`）
- **tier**：full · **live**：`[llm, websearch]` · **prereq**：`golden-profile`
- **真值**：assistant = `E2E_WebSearch_Test_Assistant` / `3a28e400-78ab-4ff7-ab5f-078171eb17cf`（`minimax-m2.7`），golden 已设 `enableWebSearch=true`。
- **full-envelope-cal 实测**：✅ 触发，process-history **9 个工具调用**（7 search + 2 web_fetch），~70s。assistant 路径**也走 process-history**（非 inline）。
- **gate**：`check: visible {testid: message-tool-history} timeout: 180s`。

### WS-F2 agent 真的用网络搜索（`/app/agents`）— ✅ 已编码（`cases/full/WS-F2-agent-websearch.yaml`）
- **tier**：full · **live**：`[llm, websearch]` · **prereq**：`golden-profile`
- **真值**：agent = `E2E_WebSearch_Test_Agent` / `941ad9c4-f022-444c-919e-e55d2e87ecf0`（`minimax-m2.7`）。
- **full-envelope-cal 实测**：✅ 工具真触发（Claude JSONL `mcp__cherry-tools__web_search`），process-history **27 个工具调用**，~81s。
- **修正流**：picker 选 agent → 草稿框输入 → 发送（**不点全局「新建会话」**，它从全局最近 session 取种子会漂移到错的 agent）。
- **gate**：同 WS-F1。

## 3. config 依赖（真值已填，golden 已 bake）

| 占位 | 真值 |
|---|---|
| 网搜 assistant | `E2E_WebSearch_Test_Assistant` / `3a28e400-78ab-4ff7-ab5f-078171eb17cf` — ✅ `enableWebSearch=true` |
| 网搜 agent | `E2E_WebSearch_Test_Agent` / `941ad9c4-f022-444c-919e-e55d2e87ecf0` — 工具可用 |
| forcing prompt | 「用网络搜索查一下 2026 年 6 月 OpenAI 有哪些新发布，并给出来源链接。」 |

## 4. 待办

1. ✅ 锚点全校准；forcing prompt 定稿；信封定稿 = `[data-testid=message-tool-history]`（本仓已加 testid）。
2. ✅ WS-F1/WS-F2 已编码（`cases/full/`）。
3. ⏳ **commit testid + spec + YAML，push 后测试机 pull**（YAML 用新 testid，测试机 build 须含）。
4. ⏳ 测试机首跑 **compile** WS-F1/WS-F2 → 产 `.compiled`（剥 ephemera 后入仓）。
