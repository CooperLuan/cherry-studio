# Knowledge Base E2E — full（agentic·live）规格（SoT · driving 锚点已校准）

> 域 spec 的 **full 层**，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**。
> 与 [`light-medium.md`](light-medium.md)（KB 管理/索引/召回设置面）正交：本文件测「**assistant / agent 真的会调用知识库检索/管理工具**」——live、LLM+embedding，只断**工具触发的信封**。
> **状态**：driving 锚点已 live 校准（同 websearch full）。golden 已 bake `E2E_Test_KB`（completed）。**KB-F1 + KB-F2 均 compile PASS**（`.compiled` 在库；KB-F1 在 #16345 并入后 kb_list 不再被 strict provider 拒，2.758s 出信封）；**KB-F3（上传文件→agent 加入 KB）⏸️ 暂缓（用户 2026-06-29 决定）**——blocked 于产品硬伤：附件的路径/引用**根本没进 agent 上下文**，agent 无从调 kb_manage（§2，产品修复后可重启）。
> **分支前提**：本分支已 rebase 到 **#16345（PR C agent 工具面）之上** → `kb_search`/`kb_list`/`kb_read`/`kb_grep`/`kb_tree`/**`kb_manage`** 全部可用（KB-F3 依赖 `kb_manage`）。#16345 合 main 后本分支 rebase 到 main 即甩掉这层。

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

### KB-F1 assistant 真的检索知识库（经典聊天）— ✅ 已编码 · ✅ compile PASS（`cases/full/KB-F1-assistant-kb.yaml`）
- **tier**：full · **live**：`[llm, embedding]` · **prereq**：`golden-profile` + `completed-base`
- **真值**：assistant = `E2E_Knowledge_Test_Assistant(no_vision)` / `5e6b5dab-596c-4e63-b637-aa33aae44d5d`（`glm-5.2`），已挂 `E2E_Test_KB`。
- **full-envelope-cal 实测**：❌ **0 工具**，180s timeout。provider 报 `Tool 0 function has invalid 'parameters' schema: None is not of type 'array'`。
- **根因（真 bug）**：`kb_list` 入参全 optional + `strict:true` → `required` 序列化成 `null` → 严格 provider 拒整请求。同模型 glm-5.2 在 KB-F2（agent/MCP 非 strict）能调 kb_list。**已修**：#16345 整支并入本分支（kb_list 拆成 strict + MCP 双 schema，`27a9ee8fd`）→ strict 路径 `required` 为合法数组。**✅ 已验证转绿**：2026-06-29 compile PASS，assistant 调 `kb_list`、2.758s 出信封、`data-tool-count=1`、baseline=0。
- **gate**：`check: visible {testid: message-tool-history} timeout: 180s`。

### KB-F2 agent 真的检索知识库（`/app/agents`）— ✅ 已编码（`cases/full/KB-F2-agent-kb.yaml`）
- **tier**：full · **live**：`[llm, embedding]` · **prereq**：`golden-profile` + `completed-base`
- **真值**：agent = `E2E_Knowledge_Test_Agent(no_vision)` / `c3fc3e48-7cf9-4428-9074-0b3808fdf6a1`（`glm-5.2`，kb_search 可用、scope=all bases）。
- **full-envelope-cal 实测**：✅ **kb_list 工具触发 + 命中 `E2E_Test_KB`**（process-history 3 工具调用，~23s）。agent/MCP 路径不受 KB-F1 的 strict bug 影响。
- **修正流**：picker 选 agent → 草稿框输入 → 发送（**不点全局新建会话**，避免归属漂移到错的 agent——首测漂到了 websearch agent）。
- **gate**：同 KB-F1。

### KB-F3 agent 真的把上传的文件加进知识库（`/app/agents` · kb_manage）— ⏸️ 暂缓（用户 2026-06-29）· blocked 于产品硬伤（附件不进 agent 上下文）
- **tier**：full · **live**：`[llm]` · **prereq**：`golden-profile` + kb_manage-enabled agent + 目标 KB · **fixtures**：上传文件
- **意图**：用户把文件附到 agent 输入框 → 说「把这个文件加到知识库」→ agent 调 `kb_manage(action=add, type=file, path=…)`。只断**信封：agent 调了 kb_manage**。
- **⛔ live 校准实测（2026-06-29）= 不可行**：agent 配置正常（`disabled_tools=[]`、JSONL 暴露 `mcp__cherry-tools__kb_manage`），prompt 正常，但 **agent 根本没调 kb_manage**。~108s 后 process-history 32 工具调用 = `kb_list`×1 + `kb_tree`×1 + **`Bash`×30** + `Read`×1、**`kb_manage`×0**。**根因 = 产品硬伤,非 capability/非测试**：**上传文件的路径/引用根本没进 agent 可见上下文** —— SQLite `file_ref` 为空，两条 user message 只有纯文本「把刚上传的这个文件加到我的知识库里。」（**无** `ChannelMessageHandler` 那条 `[Attached files saved to workspace]` 路径追加），JSONL 里模型**明确表示看不到上传文件信息**、转而自己用 shell 满目录搜（30 次 Bash flail）。审批 UI 自然也没出现（kb_manage 没被调）。
- **结论**：桌面 `AgentComposer` 接受附件(chip 显示 `span[role=button][aria-label="report.md"]`)但**发送时把文件引用丢了**（既不透路径、也不内联内容）→ agent 无从用 kb_manage。这是**缺失接线 / silent-drop**（推翻先前「ChannelMessageHandler 路径追加」的核实——那是 IM channel 流，桌面 agent 流不走它）。**用户 2026-06-29 决定暂缓（②）**。备选留档：① 产品修复（把上传附件的路径/`fileEntryId` 接进 agent 消息上下文）后本 case 即可测；③ 若只想覆盖 kb_manage 信封，可改测 **note/url 加入**（`kb_manage add type=note/url` 无需附件路径，现成可跑）。
- **上传锚点（校准已得，留作日后）**：「+」opener=`button[aria-label="添加"][data-slot=dropdown-menu-trigger]`；菜单项=`[role=menuitem][aria-label="上传附件"][data-slot=dropdown-menu-item]`（无 testid）；上传后 chip=`span[role=button][aria-label="<文件名>"]`（无 testid）。原生框仍用 L2 的 osascript `pick-file`。

## 3. config 依赖

| 占位 | 真值（golden 已 bake 2026-06-27）|
|---|---|
| KB assistant | `E2E_Knowledge_Test_Assistant(no_vision)` / `5e6b5dab-596c-4e63-b637-aa33aae44d5d` — ✅ 已挂 `E2E_Test_KB` |
| KB agent | `E2E_Knowledge_Test_Agent(no_vision)` / `c3fc3e48-7cf9-4428-9074-0b3808fdf6a1` — kb_search 可用，靠 all-bases scope |
| KB | `E2E_Test_KB` / `fa12ac17-084f-465a-8c74-6d12a7f30ae6` — ✅ completed、1 item（源 `${fixtures.sample-md}`）|
| 已知词 | `deterministic recall query`（库内确认子串；断言不依赖命中）|
| forcing prompt | 「在我的知识库里查一下 deterministic recall query 相关内容并引用。」 |
| KB-F3 agent | 需一个**启用 kb_manage** 的 agent（builtin-tool 开关）— 校准时定：复用 `E2E_Knowledge_Test_Agent` 开 kb_manage，或新建专用 agent |
| KB-F3 上传 fixture | `${fixtures.sample-md}`（同 L2 的 sample.md，repo 外绝对路径）|
| KB-F3 forcing prompt | 「把刚上传的这个文件加到我的知识库里。」 |

## 4. 待办

1. ✅ **KB-F1 + KB-F2 完工**：编码 + compile PASS，`.compiled` 在库（`kb-f1-assistant-kb.json` / `kb-f2-agent-kb.json`）。
2. ⏸️ **KB-F3 暂缓**（用户 2026-06-29 决定）——blocked 于产品硬伤（上传附件路径不进 agent 上下文，agent 不调 kb_manage）；产品修复后可重启，锚点/复现路径已记 §2。
3. ⏳ #16345 合 main 后：本分支 rebase 到 main，甩掉 PR C 那层，仅留 e2e 测试。
