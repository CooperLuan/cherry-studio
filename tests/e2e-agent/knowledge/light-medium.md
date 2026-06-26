# 知识库 E2E — Light / Medium 锁定规格

> **状态**：light/medium 已敲定。full 层另行规划。
> **Base**：`upstream/main`（CherryHQ/cherry-studio）。§2A 的 testid 已在本分支落地。
> **驱动**：agent-browser 跑真实 dev Electron App（`pnpm debug`），YAML B 模式确定性重放。
> **域**：knowledge（项目级 e2e-agent 架构的 v1 试点域）。
> **本文是 SoT 的设计快照**：runner 与 YAML schema 尚未定型，因此这里用「触发 → 步骤 → 确定性断言（带真实锚点）」描述，待 runner 落地后机械转 YAML。
>
> ⚠️ **锚点核实基准**：详细锚点最初对照 `origin/main` 核实，该分支当时落后 `upstream/main` 133 个 commit。已切到 `upstream/main` 并重做 §2A testid + 复核数据源结构性锚点（**行已从 `<TableRow>` 重构为 `<div role="row">` 网格**，相应选择器已更新）。其余 medium 细节锚点由测试机在搭建时按当前 `upstream/main` 再确认。

## 0. 硬约束（来自架构共识）

- **层累积**：light ⊂ medium ⊂ full。跑 medium 必跑全部 light，跑 full 必跑全部 medium。
- **light/medium 的 pass/fail gate 必须确定性**：只断言 DOM / 文本 / 状态，**禁止任何 LLM 判断、召回排序质量、生成文本**。带这些性质的观测一律降级到 full 非 gating，或排除。
- **agent-browser 不能驱动 OS 原生选择器**：`directory` 源走 `window.api.file.selectFolder()` 原生目录框 → **排除出确定性层**。`file` 源走 react-dropzone 的隐藏 `<input type=file>`，用 `setInputFiles` 喂**真实磁盘 fixture 路径**（`window.api.file.getPathForFile` 才有值）→ 可驱动。
- **主流程 live key 不 mock**：碰 embedding provider 的步骤只断言**终态 / 信封**（如索引到 `completed`、召回摘要出现），不断言向量值 / 精确块数 / 排序。
- **v2 无 in-app 子项树**：root 扁平列表，不测层级渲染。
- **导航靠点侧边栏**（像真人），不靠 URL；HashRouter vs TanStack `/app/knowledge` 对 agent-browser 无关紧要。

## 1. 选择器约定（按稳定度优先）

1. `data-testid` / `data-*` 属性（最稳，locale 无关）— 见 §2 前置清单
2. `id` / `aria-label` / `role`
3. `class*=` 模糊匹配（适配 Tailwind 原子类）
4. 可见文本（**locale 依赖**，见开放问题 Q-locale）

> **核心结论**：KB v2 的 `id` / `aria-label` / i18n key 较齐全，但**状态值、列表行、分块卡这些"需要程序化定位 + 断言具体取值"的地方缺 `data-testid` / `data-*`**，目前只能靠脆弱的 class/text。按 CLAUDE.md「fix upstream, don't hack downstream」，§2 列出建议补的锚点。

## 2. 可测性前置（testid / data-* 补丁）

下列为让 light/medium 成为**稳定**确定性 gate 所需的源码锚点。分两类。

### 2A. KB 本地小改 — ✅ 已在本 PR 落地（外科级、low risk）

| # | 文件 | 位置（upstream/main） | 加了什么 | 解锁 |
|---|---|---|---|---|
| T1 | `panels/dataSource/KnowledgeItemRow.tsx` | `KnowledgeItemStatusBadge` 外层 span | `data-testid="kb-item-status"` | L3 状态 badge 定位 |
| T2 | `panels/dataSource/KnowledgeItemRow.tsx` | 行 `<div role="row">`（grid，已有 `data-state`） | `data-testid="kb-item-row"` + `data-item-id={item.id}` + `data-status={item.status}` | L2/L3 行定位 + **状态轮询断言 `data-status='completed'`（locale 无关）** |
| T3 | `panels/dataSource/KnowledgeItemChunkDetailPanel.tsx` | 容器 / `chunksCountMeta` / `KnowledgeItemChunkCard` | `data-testid="kb-chunk-panel"` / `"kb-chunks-count"` / `"kb-chunk-card"` | L3 分块断言 |
| T4 | `components/DetailHeader.tsx` | 状态 `Badge`（failed + 非-failed **两个分支都加**） | `data-testid="kb-base-status"` + `data-status={base.status}` | L1 库状态断言（规避 `role=status` 不存在的问题；failed/completed 均可定位） |

### 2B. 动 `packages/ui`（需你拍板 — 影响全 App，非仅 KB）

| # | 文件 | 加什么 | 解锁 | 不改的 workaround |
|---|---|---|---|---|
| U1 | `packages/ui` menu-item.tsx (~L84) | `role="menuitem"` | L3 view-chunks 菜单、M7 各菜单按语义角色定位 | 改用按钮**文本**定位菜单项（较脆、locale 依赖） |
| U2 | `packages/ui` QuickPanel view.tsx | `data-testid="quick-panel-body/footer"`；行 `data-id` 用实体 id + `data-selected` 属性（现为数字 `data-id={itemIndex}`、无 selected 属性） | M6 KB 选择器按库 id 定位 + 断言选中态 | DOM 遍历 / Check 图标存在性 |

### 2C. 纯规格修正（无需改码）

- M6 内容类型 i18n key 实际是 `chat.save.knowledge.content.maintext.title`，**不是** `...content.text.title`。

> **决策点**：2A 是否现在就补？2B 走改码还是 workaround，还是 **M6 暂缓**只留 2A？见末尾「待你拍板」。

---

## 3. Light 层（必须每次绿）

> 核心冒烟：建库 → 加文件源 → 索引到 completed → 召回面板渲染 + 提交门控。

### L1 — 创建知识库
- **触发**：点侧边栏进知识库 → navigator header `Add` 按钮（`aria-label='Add'`，`BaseNavigatorCreateMenu`）→ 菜单项 `knowledge.add.title`
- **步骤**：开建库对话框 → 空名提交 → 选 embedding 模型 → 提交成功
- **断言**：
  | 断言 | 锚点 | 确定性 |
  |---|---|---|
  | 空态显示 | text `knowledge.empty` | yes |
  | 名称输入存在 | `input#knowledge-create-name`（CreateKnowledgeBaseDialog L189） | yes |
  | 空名报错 | `FieldError` text `knowledge.name_required`（L196，**网络前短路**，submit handler L143-145 早返回） | **yes（离线）** |
  | 无模型报错 | `FieldError` text `knowledge.embedding_model_required`（L237） | **yes（离线）** |
  | 模型选择器 | `button[aria-label='Embedding Model']`（L229） | yes |
  | 提交按钮文案 | `button[type=submit]` text `knowledge.add.submit`（Create） | yes |
  | 建成后库行选中 | `KnowledgeBaseRow` `class*=bg-secondary`（KnowledgeBaseRow.tsx L72） | yes |
  | 库状态 Badge | **[T4✅]** `[data-testid=kb-base-status][data-status=completed]`（locale 无关） | partial（server 态） |
- **live 依赖**：成功建库走 embedding-key（`fetchDimensions` 在校验通过后 L150 才调）。**校验子断言全离线确定性**。
- **fixtures**：golden profile（含 1 个可用 embedding provider + key）；测试库内无已存在 KB。

### L2 — 加单个文件源
- **触发**：`DataSourcePanel` 空态 / `DataSourcePanelHeader` 的 Add 按钮 → File tab（默认）
- **步骤**：`setInputFiles` 注入 `fixtures/knowledge/sample.md` → 文件入列 → 点 Add
- **断言**：
  | 断言 | 锚点 | 确定性 |
  |---|---|---|
  | 文件入选中列表 1 项 | `[data-testid='knowledge-source-file-list'] [role=listitem]`（已存在 testid） | yes |
  | Add 按钮启用 | footer `common.add`（`canSubmit` = selectedFiles>0） | yes |
  | 列表出现 1 行 | **[T2✅]** `[data-testid=kb-item-row]`（grid `div[role=row]`，按 `[data-item-id]` 定位具体行） | yes |
- **live 依赖**：none（加入队列为本地操作；索引在 L3 单独断言）
- **fixtures**：`fixtures/knowledge/sample.md`（小、含已知段落、一段是固定召回 query 的字面子串）
- **注**：`file` 源是唯一无需原生框、可确定性驱动的源（dropzone 隐藏 input + 真实路径）。

### L3 — 索引到 completed + 看分块
- **触发**：L2 的行可见、带状态 Badge
- **步骤**：有界轮询状态到 ready → 行 `More` 菜单 → `view_chunks` → 抽屉渲染
- **断言**：
  | 断言 | 锚点 | 确定性 |
  |---|---|---|
  | 状态到 completed | **[T2✅]** 轮询 `[data-item-id='<id>'][data-status='completed']`（行属性，locale 无关）；有界 until-loop | partial（终态确定，向量值不断言） |
  | view_chunks 菜单项可点 | **[U1 暂缓]** MenuItem 渲染为 `<button>` 无 `role=menuitem` → 按**文本** `knowledge.data_source.actions.view_chunks` 定位（仅 status=completed 渲染） | yes |
  | 分块面板渲染 | **[T3✅]** `[data-testid=kb-chunk-panel]` | yes |
  | chunks 计数 | **[T3✅]** `[data-testid=kb-chunks-count]`（text `knowledge.data_source.chunks_count`） | partial |
  | ≥1 分块卡 | **[T3✅]** `[data-testid=kb-chunk-card]`（≥1）；空态 EmptyState 不出现 | partial（≥1 确定，精确数不断言） |
- **live 依赖**：embedding-key（嵌入阶段）。**只断言终态 + chunks≥1**。
- **fixtures**：同 L2 的 sample.md（内容足够产 ≥1 块）

### L4 — 召回面板渲染 + 提交门控
- **触发**：`DetailHeader` 的 `FlaskConical` 按钮（text `knowledge.tabs.recall_test`，仅 base.status≠failed 时渲染）→ 开 `PageSidePanel` 抽屉（**非 tab**）
- **步骤**：开抽屉 → 观察空态 → 输入框空/纯空格 → 输入非空
- **断言**（全 yes，纯本地状态）：
  | 断言 | 锚点 |
  |---|---|
  | 抽屉标题 | text `knowledge.tabs.recall_test` |
  | 搜索框 placeholder | `input[placeholder=knowledge.recall.placeholder]`（RecallSearchBar L51） |
  | 空态 | text `knowledge.recall.empty_title` + `empty_description`（RecallTestBody L62-63） |
  | 空/纯空格时 submit 禁用 | `button:disabled` text `knowledge.recall.submit`（`canSearch` L15） |
  | 输入非空后 submit 启用 | `button:not(:disabled)` |
- **live 依赖**：none（刻意停在 IPC 搜索之前）

---

## 4. Medium 层（累积含 Light，全确定性 gate）

### M1 — URL + Note 源
- **URL**：`input#knowledge-source-url-input`（placeholder `...url.placeholder`）→ footer `common.add` 空禁用/非空启用 → 提交 → 行出现带 `Link2` 图标（`text-cyan-500`）、类型列 `knowledge.data_source.filters.url`。**断言 add-time only**（索引会联网抓取，不等完成）。确定性：add 步 yes，行图标 partial。
- **Note**：Note tab → `[data-testid='knowledge-source-note-list']`（已存在）→ 勾选 → `common.add`。无笔记时空态 `...note.empty_title`。需 seeded 笔记目录。全 yes。
- **live 依赖**：URL=network（仅 add-time 断言规避）；Note=none（seeded）

### M2 — 同名 dedupe / auto-rename（无冲突弹窗）
- **同文件两次**：同一会话 `setInputFiles` 同路径两次 → `knowledge-source-file-list` 去重为 1（key=`getPathForFile`，AddKnowledgeItemDialog L59）→ **断言无任何冲突 modal**。
- **同名不同目录**：`fixtures/knowledge/dupe/a/report.md` + `dupe/b/report.md` → 选中列表 2 项 → 提交 → 列表 2 行同名共存（key 是磁盘路径非 name）。
- **确定性**：dedupe/共存/无 modal 全 yes（add-time 离线）；提交后行 partial。
- **注**：v2 **已无** renderer 冲突弹窗；真冲突走主进程 → 行内 `role=alert` 报错条，非 modal。

### M3 — RAG 配置：分块校验 + dirty/save 门控 + 持久化 ✅全确定性
- **触发**：active 库（status≠failed）的 RAG 抽屉（`DetailHeader` `SlidersHorizontal` 按钮 → `RagConfigPanel` 的 `ActiveRagConfigPanel` 分支）
- **断言**（全 yes，纯本地表单态 + 1 次本地 DB 写）：
  - chunkSize/chunkOverlap 输入 digits-only（`replace(/\D/g,'')`）
  - `chunkOverlap >= chunkSize` → error `knowledge.rag.chunk_overlap_must_be_smaller` + Save 禁用
  - chunkSize=0 → error `knowledge.rag.chunk_size_invalid`
  - 空 chunk 字段 → Save 禁用
  - Reset 在 `!isDirty` 时禁用、dirty 时启用
  - 改 documentCount + Save → toast `knowledge.rag.saved` → Save 回禁用
  - 改 embedding 模型 → 主按钮文案 `knowledge.rag.save_action` → `knowledge.restore.submit`（**只断言文案切换，不点**）
- **live 依赖**：none（documentCount PATCH 是本地 DB 写，无 embedding 调用；restore 不触发）
- **fixtures**：completed 库 + golden profile 含 ≥2 embedding 模型（触发文案切换）

### M4 — RAG 配置：检索条件字段显隐 ✅全确定性
- **断言**（全 yes，纯条件渲染、无网络）：
  - documentCount slider 恒显（`aria-label=knowledge.rag.document_count`，min1/max50/step1）
  - searchMode=vector → threshold slider 显（`knowledge.rag.threshold`，0.0-1.0）
  - searchMode=hybrid → hybrid_alpha slider 显（`knowledge.rag.hybrid_alpha`），threshold 隐（无 rerank 时）
  - searchMode=bm25 + 无 rerank → threshold 隐
  - 选 rerank 模型（`knowledge.rag.rerank_model`）→ threshold 重现（`usesRelevanceThreshold = searchMode==='vector' || rerankModelId!==null`）
- **fixtures**：completed 库；rerank 模型可选（无则 rerank 子断言 skip-if-absent，见 Q-rerank）

### M5 — 执行召回（仅确定性信封）+ 历史 CRUD + 结果卡 copy/expand
- **搜索信封**（partial — 断言壳，不断言结果）：提交 → searching 态 `knowledge.recall.searching` + `svg.animate-spin` + submit 禁用 → 摘要出现：count（`knowledge.recall.result_count`）/ duration（`knowledge.recall.duration`）/ scoreKind（`knowledge.recall.ranking_only` 或 top_score）
- **历史 CRUD**（全 yes）：搜后 query 入历史首位 → focus 输入开 `div[data-recall-history]`（标题 `knowledge.recall.history_title`）→ 点历史项回填输入且不自动搜 → 单项删除（`aria-label=knowledge.recall.history_remove`）→ 清空（`knowledge.recall.history_clear`）
- **结果卡确定性子行为**（全 yes，从草案 F8 上提）：
  - copy 按钮（`aria-label=knowledge.recall.copy`）点击 → `lucide-copy` → `lucide-check` + `text-success`（2s 后回切 = partial，不 gate）
  - 展开/收起：`p.line-clamp-2` ↔ 无 clamp，`aria-label` `knowledge.recall.expand` ↔ `collapse`，ChevronDown ↔ ChevronUp
- **非 gating（降级到 full F8）**：结果排序、分数值、命中内容、source name、chunk index `#N`
- **live 依赖**：embedding-key（vector/hybrid 走 `embedKnowledgeQuery`）。**只断言信封 + 历史/卡交互**。
- **fixtures**：completed sample.md 库；query 用 fixture 字面子串（提高"≥1 结果"概率，但 gate 不依赖具体结果）
- **去掉**：草案里的 error-path 空摘要子断言（无法确定性触发，移 full + 注入）

### M6 — 聊天集成两入口 ⚠️依赖 2B / workaround
- **(a) Inputbar 选库**：`KnowledgeBaseButton`（`FileSearch` 图标，tooltip `chat.input.knowledge_base`）→ 开 QuickPanel 列库名 → 选中 toggle active。
  - **锚点缺口**：QuickPanel 行用数字 `data-id={itemIndex}`、无 `data-selected`、缺 `quick-panel-body/footer` testid（见 U2）。无 2B 则靠 Check 图标存在性 + DOM 遍历。
- **(b) Save-to-KB**：`SaveToKnowledgePopup` → base Combobox（`role=combobox`，仅 completed 库）→ 内容类型 toggle（key `chat.save.knowledge.content.maintext.title` 等，**见 2C**）→ `common.save` 按钮门控（选库 + ≥1 内容类型才启用）→ 保存后对话框关闭。
- **确定性**：Inputbar 选择 + Save 门控 + 对话框关闭 = yes（本地态）；保存内容的索引不 gate（partial，只断言关闭）。
- **live 依赖**：内容分析 / 索引碰 key，但不 gate。
- **建议**：若不做 U2，M6 先只保留 (b) 的 Combobox 过滤 + Save 门控 + 关闭（这些 `role`/`common.save` 锚点稳），(a) 的选中态断言降级或缓做。

### M7 — navigator 分组/库管理（确定性子集） ✅
- **建组**：header `Add` → 菜单 `knowledge.groups.add` → `CreateKnowledgeGroupDialog`（`input#knowledge-entity-name`）→ 空名 error `knowledge.groups.name_required` → 有效名 → 新 accordion section
- **移库入组**：库行 hover → `aria-label=common.more` 菜单 → `knowledge.context.move_to` 段 → 选目标组 → 库行 re-render 到目标 section
- **重命名库**：库行菜单 → `knowledge.context.rename` → `KnowledgeBaseNameDialog`（`input#knowledge-entity-name`）→ `DetailHeader` h1（`class*=text-2xl`）更新
- **navigator 搜索**：搜索框（placeholder `knowledge.search`）→ 输入不匹配 → 空态 `knowledge.empty`（preset `no-knowledge`）→ clear 按钮（`aria-label=common.clear`，仅非空时显）→ 恢复
- **确定性**：全 yes（本地 DB/state）。3 处选择器用 `class*=` 模糊匹配（text-2xl / move_to 段 / Popover align）。
- **菜单定位**：依赖 U1 的 `role=menuitem` 或按文本 fallback。
- **排除到 full**：删库/删组级联 ConfirmDialog、移回 Ungrouped、drag-resize（需合成鼠标事件）。

---

## 5. 确定性分级速查

| 层 | 必须 | 禁止进 gate |
|---|---|---|
| light | DOM/文本/状态终态；离线校验 | LLM 判断、排序、生成文本 |
| medium | 同上 + 条件渲染 + 表单门控 + 召回**信封** | 召回排序/分数/命中内容（→ full F8）、原生 OS 框、需注入才能触发的错误路径 |

**碰 embedding key 的步骤**：只断言终态（completed）/ 信封（摘要出现）/ 对话框关闭，永不断言向量、精确块数、排序、duration 具体值。

## 6. Fixtures 清单

- `fixtures/knowledge/sample.md` — 小、含已知段落，一段是固定召回 query 的字面子串（L2/L3/L4/M5）
- `fixtures/knowledge/dupe/a/report.md` + `dupe/b/report.md` — 同 basename、异目录、异内容（M2）
- seeded 笔记目录（`notesPath` 指向 fixture 文件夹，≥1 .md）+ 空变体（M1 Note + 空态）
- 稳定测试 URL（**优先本地静态页**，避免 flake；M1，仅 add-time 断言）
- **secrets pool**（repo 外，`~/.cherry-e2e/secrets.local.json`）：`{ provider, apiKey, baseUrl?, embeddingModelId, secondEmbeddingModelId?(M3 文案切换), rerankModelId?(M4) }`
- **golden profile**（repo 外）：预配 embedding provider+key（+可选 2 embedding 模型 + 1 rerank），light/medium 默认起点
- seeded 助手 + 1 条已知内容消息（M6 内容类型计数稳定）

## 7. 开放问题（带入下一步）

- **Q-testid**：2A 是否现在补？（建议是）2B 改码 vs workaround vs M6 缓做？
- **Q-locale**：golden profile 跑哪个 locale？文本断言 locale 依赖 → 优先 testid/`data-*`/id/aria（=2A 的动机）。
- **Q-rerank**：secrets pool 是否含 rerank 模型？无则 M4 rerank 子断言 + 标 skip-if-absent。
- **Q-url-index**：M1 URL 定 add-only（已采纳）；是否需要本地静态页 fixture 以便未来测索引完成？
- **Q-runner**：YAML schema + `.agents/skills/e2e-run` runner 尚未定型 → 本规格转 YAML 需先定 runner 契约。
- **Q-secrets**：live key 注入机制（env / 加密 fixture）确认后才能跑任一 live-key 例。
