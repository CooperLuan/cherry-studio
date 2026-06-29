# Web Search E2E — full（agentic·live）规格（SoT · driving 锚点已校准）

> 域 spec 的 **full 层**，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**。
> 与 [`light-medium.md`](light-medium.md)（设置页配置面，离线）正交：本文件测「**assistant / agent 真的会调用网络搜索工具**」——live、LLM+网络、非确定性，只断**工具触发的信封**。
> **状态**：**WS-F1 / WS-F2 已 compile PASS**（`.compiled` 在库；golden 修正 `enableWebSearch=true` + 具体 prompt 后触发，见 §2）。**WS-F3（真搜→结果块）新增设计**——给 `MessageWebSearch` 结果块加 `message-websearch-result` testid，gate=结果块在场（=搜索跑完且有结果，比 tool-history 更进一步），待 live 校准（§2）。

## 0. 表面与锚点（✅ 已 live 校准）

### A. 经典 assistant 聊天（`enableWebSearch` AI-SDK 工具路径）
- **入口**：左侧栏 → assistant（`nav: assistants`）。
- **选 assistant（✅ 确认）**：底部 picker `button[data-slot=popover-trigger]` → 弹出后 `[role=option]` 按文本（如 `E2E_WebSearch_Test_Assistant`）。
- **触发条件**：`assistant.settings.enableWebSearch === true`（`src/main/ai/tools/adapters/aiSdk/builtin/WebSearchTool.ts:45` 的 `applies` 门）。⚠️**当前 golden 该值为 false → 工具不暴露**（§2 WS-F1）。
- **输入（✅ 确认）**：`[contenteditable="true"]`（`#inputbar` Tiptap，`ComposerSurface.tsx`）；实测可写入 `<p>...</p>`。
- **发送（✅ 确认）**：`i[role="button"][aria-label=发送]`（i18n `chat.input.send`；Enter 亦发送）。
- **信封（工具被调）**：assistant 路径**也走 process-history**（full-envelope-cal 实测 WS-F1 = 9 个工具调用折叠在 process-history，非 inline）→ **gate 同 §0.B 的 `[data-testid=message-tool-history]`**（统一）。
- **结果块信封（WS-F3，更进一步）**：`web_search` 完成（`status='done'` 且结果数>0）时，`MessageWebSearch.tsx` 渲染一个 ToolDisclosure，本仓已给其根 `<div>` 加 **`data-testid="message-websearch-result"` + `data-result-count`**（仅 `hasResults` 时挂载 → 存在即「搜索跑完且有结果」，locale 无关）。区别于 tool-history（=工具被调），结果块=**搜索真完成并回了结果**。
  - ⚠️ **live 校准（2026-06-29 ws-f3-rerun）纠正**：结果块**嵌在 process-history 折叠组内**（静态读码误判为「独立平行」——又一次被 live 推翻，同 WS-F2 信封）。折叠**收起时结果块不在 DOM** → gate **不能**直接等 `message-websearch-result`，须**先点开 `message-tool-history` 折叠**再 poll 结果块。实测：工具 36.9s 出现（count=2），展开后结果块 `data-result-count=5`。

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

### WS-F3 网络搜索真的跑完并返回结果（经典聊天 · 结果块）— ✅ compile PASS（`cases/full/WS-F3-search-result.yaml` · `.compiled` 在库）
- **tier**：full · **live**：`[llm, websearch]` · **prereq**：`golden-profile`
- **真值**：assistant = `E2E_WebSearch_Test_Assistant`（同 WS-F1，`enableWebSearch=true`）。
- **意图**：比 WS-F1 更进一步——不仅「工具被调」，而是 `web_search` **真完成且回了结果**（结果块 `MessageWebSearch` 渲染，`data-result-count` 实测 5）。
- **live 实测（ws-f3-rerun）**：✅ 工具 36.9s 出现（`message-tool-history` count=2）；结果块 `message-websearch-result`（count=5）**只在展开 `message-tool-history` 折叠后出现**——原 YAML 直接等结果块 → 241.5s 超时 FAIL。**已纠正流程**。
- **流程（已纠正）**：goto assistants → picker 选 assistant → 输入 forcing prompt → 发送 → **等 `message-tool-history` 出现**（≤180s）→ **点开它** → **poll `message-websearch-result`**（≤240s）。
- **gate**：`check: visible {testid: message-tool-history} timeout: 180s` → `do: click {testid: message-tool-history}` → `check: visible {testid: message-websearch-result} timeout: 240s`。`data-result-count` 作观测、**不硬断 ≥N**（full=观测不赌成败）。
- **红线**：只断「结果块在场」（=搜索完成有结果，结构信号），**禁断**结果内容/排序/质量。

## 3. config 依赖（真值已填，golden 已 bake）

| 占位 | 真值 |
|---|---|
| 网搜 assistant | `E2E_WebSearch_Test_Assistant` / `3a28e400-78ab-4ff7-ab5f-078171eb17cf` — ✅ `enableWebSearch=true` |
| 网搜 agent | `E2E_WebSearch_Test_Agent` / `941ad9c4-f022-444c-919e-e55d2e87ecf0` — 工具可用 |
| forcing prompt | 「用网络搜索查一下 2026 年 6 月 OpenAI 有哪些新发布，并给出来源链接。」 |

## 4. 待办

1. ✅ **WS-F1 / WS-F2 / WS-F3 完工**：均编码 + compile PASS，`.compiled` 在库。WS-F3 实测工具 34.8s、展开后结果块 `data-result-count=5`。
2. ⏳ 其余 full backlog（WS-M2b apikey 删除 CRUD / WS-M5c pin 不支持模型测 disabled 态）按需再做。
