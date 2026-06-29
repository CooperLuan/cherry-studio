# File Processing E2E — full（live·跨域观测）规格（SoT · 🆕 设计 · 待 live 校准）

> 域 spec 的 **full 层**，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**。
> 与 [`light-medium.md`](light-medium.md)（设置页配置面，离线）正交：本文件测「**配置的解析引擎真的能把文件转换出来**」——live、调真实远程引擎、只能**跨 `knowledge` 域间接观测**。
> **本质边界**：文件处理的「转换」（文档→Markdown / 图片→文本）在**主进程**执行、renderer 不暴露转换过程 → 没有 assistant/agent 信封可测（不同于 KB/web search 的 full）。**唯一确定性观测口 = KB 摄入**：往知识库加一个**需要转换的文件**（PDF），看它经 `document_to_markdown` 转换 → 索引 → item 到 `completed` + 出 chunk。
> **状态**：FP-F1 设计完成、待 live 校准；**硬依赖一个活的转换 key**（见 §1）。

## 0. 表面与锚点（复用 KB light L2/L3，已校准）

- **入口 / 加文件源**：`nav: knowledge` → 打开目标 KB → 数据源面板 Add（`i18n knowledge.data_source.toolbar.add`）→ 选 `file` 源（`role=menuitem, i18n knowledge.data_source.add_dialog.sources.file`）→ **原生 OS 框用 osascript `pick-file` 喂 PDF 绝对路径**（同 L2 逃生口）。
- **状态机锚点**（`KnowledgeItemRow.tsx`，已确认有效）：行 `[data-testid=kb-item-row]`；状态属性 `data-status ∈ {idle,preparing,processing,reading,embedding,completed,failed,deleting}`；**成功终态 = `[data-testid=kb-item-row][data-status=completed]`**，失败 = `data-status=failed`。状态徽章 `[data-testid=kb-item-status]`。
- **chunk 锚点**（`KnowledgeItemChunkDetailPanel.tsx`）：点 completed 行 → `[data-testid=kb-chunk-panel]` + `[data-testid=kb-chunks-count]` + `[data-testid=kb-chunk-card]`（≥1）。
- **转换判定**（`utils/sources/sourcePlanning.ts` `needsFileProcessing`）：`item.type==='file'` ∧ **`base.fileProcessorId` 非空** ∧ 扩展名 ∈ `{.pdf,.doc,.docx,.pptx,.xlsx,.xls}` → 走 `document_to_markdown`；`.md/.txt` 跳过转换直接索引。**→ PDF 必经转换、`.md` 不经**（这正是本例区别于 KB L3 用 sample.md 的关键）。

## 1. 红线 + gate 语义 + 硬依赖

- `check:` 只断**转换→索引的终态信封**：item `data-status=completed` + chunk ≥1。**禁断** chunk 内容/Markdown 质量/排版正确性（红线）。
- **live**：`live: [file_processing, embedding]`（真实 mineru 转换 API + embedding 嵌入）。
- **⚠️ 硬依赖（无离线兜底）**：`document_to_markdown` 全部 processor（mineru/doc2x/mistral/paddleocr）**都是远程 API、需活 key**；唯一例外 `open-mineru` 需本地自建服务（`127.0.0.1:8000`）。**key 死 → item 落 `failed`、不会退化成直接索引** → 本例无意义。**故校准第一步＝先验证 golden 的转换 key 真能转一个 PDF**（见 §3）。
- **gate 三分**：转换失败有几种根因——key 死/额度耗尽（→ 轮换 key）；KB 没设 `fileProcessorId`（→ 配置缺口，设处理器）；引擎服务挂（→ 记录、非我方 bug）。

## 2. 用例

### FP-F1 配置的解析引擎真能把 PDF 转换并索引（经 KB 摄入）— 🆕 设计 · ⏳ 待 live 校准（`cases/full/FP-F1-pdf-ingest.yaml`）
- **tier**：full · **live**：`[file_processing, embedding]` · **prereq**：`golden-profile` + **带文档处理器（`fileProcessorId`=mineru 等）且 key 可用的 KB** + **PDF fixture**
- **意图**：往一个配了 `document_to_markdown` 的 KB 加一个 PDF → 引擎真把它转成 Markdown → 分块嵌入 → item `completed`。这是文件处理「真转换」**唯一**可确定性观测的路径。
- **流程**：`nav: knowledge` → 打开目标 KB → Add → `file` 源 → osascript `pick-file` 喂 `${fixtures.sample-pdf}` → **轮询等 `[data-testid=kb-item-row][data-status=completed]`** → 点该行 → 断 `[data-testid=kb-chunk-card]` ≥1。
- **gate**：`check: visible {testid: kb-item-row, has-attr: "data-status=completed"} timeout: 300s`（转换+嵌入耗时，给足）；`check: count {testid: kb-chunk-card} min: 1`。
- **红线**：只断终态 + chunk 计数，**不断** chunk 文本/转换质量。
- **校准要点（顺序）**：① **先验证转换 key 活**（拿小 PDF 试转，看到 `completed` 还是 `failed`）；② 确认目标 KB 的 `fileProcessorId` 已设（没设则设成 golden 有 key 的引擎）；③ 备一个**小 PDF fixture**（repo 外，置 `…/knowledge_test_docs/` 同 sample.md）；④ 实测 `completed` 出现时机以定 timeout；⑤ 失败时区分 key 死 / 配置缺口 / 引擎挂。

## 3. config 依赖 / fixtures

| 占位 | 真值（待校准确认）|
|---|---|
| 目标 KB | 复用 `E2E_Test_KB` 但**须确认/设置 `fileProcessorId`**（document_to_markdown），或新建带处理器的 KB |
| 转换引擎 | golden 默认 `default_document_to_markdown=mineru`（overrides mineru/doc2x/paddleocr 有 key）→ **校准须验 key 真活**（在「6 key 待轮换」清单内，可能已死）|
| PDF fixture | `${fixtures.sample-pdf}` — **待补**（repo 外绝对路径；secrets.example.json + 测试机 fixtures 都要加）|

## 4. 待办

1. ⏳ **FP-F1 待 live 校准**：测试机先验转换 key → 备 PDF fixture → 设 KB `fileProcessorId` → 跑摄入到 `completed` → 回报时机/可行性 → 编码 YAML + compile。
2. ⏳ backlog（按需）：**FP-M2b**（apikey 删除 CRUD，用无 golden key 的 mistral/open-mineru 空列表隔离 + close→reopen 观测 count，绕开弹窗快照不重渲染）；**FP-F2**（图片 OCR，image_to_text；observability 待定，macOS `system`/Vision 可离线但 KB 是否对图片走 OCR 未确认）。
3. ⚠️ **依赖**：PDF fixture 落地 + 转换 key 轮换（若 golden 现有 key 已死）。
