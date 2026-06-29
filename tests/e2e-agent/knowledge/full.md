# Knowledge Base E2E — full（agentic·live）规格（SoT · driving 锚点已校准 · blocked on golden fixture）

> 域 spec 的 **full 层**，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**。
> 与 [`light-medium.md`](light-medium.md)（KB 管理/索引/召回设置面）正交：本文件测「**assistant / agent 真的会调用知识库检索工具**」——live、LLM+embedding，只断**工具触发的信封**。
> **状态（2026-06-27 live 校准 `full-cal-165734`）**：driving 锚点同 websearch full（已确认）；**KB-F1/KB-F2 均 blocked —— golden `knowledge_base=0`、KB assistant `knowledgeBaseIds=[]`，根本没有可搜的库**。**待 golden bake 一个已索引 KB 后编码。**
> **分支前提**：`kb_search` / `kb_list` 已在本分支接线（`builtin/index.ts` + MCP `mcp__cherry-tools__kb_search`）；PR C 6 工具富集面（未推）与本层无关。

## 0. 表面与锚点（✅ 已 live 校准，复用 websearch full §0）

### A. 经典 assistant 聊天（`knowledgeBaseIds` RAG 工具路径）
- **选 assistant（✅）**：底部 picker `button[data-slot=popover-trigger]` → `[role=option]` 按文本（如 `E2E_Knowledge_Test_Assistant(no_vision)`）。
- **触发条件**：`assistant.knowledgeBaseIds.length > 0`（`KnowledgeSearchTool.ts` `applies` 门）。⚠️**当前 golden 该值为 `[]` → kb_search 不暴露**（§2 KB-F1）。
- **输入 / 发送 / 生成态**：`[contenteditable]` Tiptap → `i[role=button][aria-label=发送]` → pause 在场/消失。
- **信封**：`kb_search` → `chooseTool.tsx`（→ `MessageKnowledgeSearchToolTitle`）→ `MessageKnowledgeSearch.tsx`（`.message-tools-container` + `ToolDisclosure` `collapse-content-{id}` + `FileSearch` 图标）。引用按钮 `message.citation`（`citation.type==='knowledge'`）。
- **不对称（关键）**：**`MessageKnowledgeSearch` 工具块只要 `kb_search` 被调即渲染**（命中与否无关）；**citation 需真命中**。→ 断**工具块**，不赌 citation。

### B. v2 agent（`/app/agents`，MCP 工具路径）
- **选 agent（✅）**：`button[data-slot=popover-trigger]` → `role=listbox` → `[role=option]` 按文本。新会话 `aria-label=chat.conversation.new`。
- **触发条件**：agent 启用 `kb_search`（实测各 agent **可用**）+ **存在 KB**（scope=all bases）。⚠️ golden 无 KB → 无库可搜。
- **信封 = `[data-testid=message-tool-history]`（✅ 定稿，同 websearch full §0.B）**：工具调用折叠在 process-history 组（`MessagePartsRenderer.tsx`），≥1 工具才渲染 → 存在即 gate（本仓已加 testid）。`check: visible {testid: message-tool-history} timeout: 180s`，无需展开。`collapse-content-{key}` 的 suffix 是动态调用 ID，不可作锚（实测 kb_list 落 `collapse-content-unknown-tool`、search 结果落 `collapse-content-call_xxx`）。message run 期间 pending/parts=[]，不等完成。

## 1. 红线 + gate 语义

- `check:` 只断**工具触发的信封**：`MessageKnowledgeSearch` 工具块 / agent tool-trace 在场。**禁断**召回内容/命中/排序/分数/引用正确性/生成文本（红线）。
- **live**：`live: [llm, embedding]`（KB 查询需 embedding provider 嵌入 query）。
- **gate 三分**（同 websearch full §1）：配置缺口（无 KB / 未挂）→ 修 fixture；prompt 缺陷 → 改 prompt；capability → 记录；工具 bug → 才改码。

## 2. 用例

### KB-F1 assistant 真的检索知识库（经典聊天）— ✅ 已编码 · ⛔ blocked on kb_list fix（`cases/full/KB-F1-assistant-kb.yaml`）
- **tier**：full · **live**：`[llm, embedding]` · **prereq**：`golden-profile` + `completed-base`
- **真值**：assistant = `E2E_Knowledge_Test_Assistant(no_vision)` / `5e6b5dab-596c-4e63-b637-aa33aae44d5d`（`glm-5.2`），已挂 `E2E_Test_KB`。
- **full-envelope-cal 实测**：❌ **0 工具**，180s timeout。provider 报 `Tool 0 function has invalid 'parameters' schema: None is not of type 'array'`。
- **根因（真 bug，独立 PR 修）**：`kb_list` 入参全 optional + `strict:true` → `required` 序列化成 `null` → 严格 provider 拒整请求。同模型 glm-5.2 在 KB-F2（agent/MCP 非 strict）能调 kb_list。**修复合并后转绿，首跑 compile 暂跳过本 case。**
- **gate**：`check: visible {testid: message-tool-history} timeout: 180s`。

### KB-F2 agent 真的检索知识库（`/app/agents`）— ✅ 已编码（`cases/full/KB-F2-agent-kb.yaml`）
- **tier**：full · **live**：`[llm, embedding]` · **prereq**：`golden-profile` + `completed-base`
- **真值**：agent = `E2E_Knowledge_Test_Agent(no_vision)` / `c3fc3e48-7cf9-4428-9074-0b3808fdf6a1`（`glm-5.2`，kb_search 可用、scope=all bases）。
- **full-envelope-cal 实测**：✅ **kb_list 工具触发 + 命中 `E2E_Test_KB`**（process-history 3 工具调用，~23s）。agent/MCP 路径不受 KB-F1 的 strict bug 影响。
- **修正流**：picker 选 agent → 草稿框输入 → 发送（**不点全局新建会话**，避免归属漂移到错的 agent——首测漂到了 websearch agent）。
- **gate**：同 KB-F1。

## 3. config 依赖

| 占位 | 真值（golden 已 bake 2026-06-27）|
|---|---|
| KB assistant | `E2E_Knowledge_Test_Assistant(no_vision)` / `5e6b5dab-596c-4e63-b637-aa33aae44d5d` — ✅ 已挂 `E2E_Test_KB` |
| KB agent | `E2E_Knowledge_Test_Agent(no_vision)` / `c3fc3e48-7cf9-4428-9074-0b3808fdf6a1` — kb_search 可用，靠 all-bases scope |
| KB | `E2E_Test_KB` / `fa12ac17-084f-465a-8c74-6d12a7f30ae6` — ✅ completed、1 item（源 `${fixtures.sample-md}`）|
| 已知词 | `deterministic recall query`（库内确认子串；断言不依赖命中）|
| forcing prompt | 「在我的知识库里查一下 deterministic recall query 相关内容并引用。」 |

## 4. 待办

1. ✅ golden bake + 校准 + 编码（KB-F1/KB-F2 已落 `cases/full/`）。
2. ⛔ **KB-F1 blocked on kb_list strict schema 修复（独立 PR）** → 合并后复跑转绿；首跑 compile 只跑 **KB-F2**。
3. ⏳ commit testid + spec + YAML，push 后测试机 pull → compile **KB-F2** 产 `.compiled`。
4. ⏳ kb_list 修复合并后：测试机 pull → compile **KB-F1**。
