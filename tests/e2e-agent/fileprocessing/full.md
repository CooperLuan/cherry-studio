# File Processing E2E — full（live·跨域观测）规格（SoT · FP-F1 compile PASS）

> 域 spec 的 **full 层**，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**。
> 与 [`light-medium.md`](light-medium.md)（设置页配置面，离线）正交：本文件测「**配置的解析引擎真的能把文件转换出来**」——live、调真实远程引擎、只能**跨 `knowledge` 域间接观测**。
> **本质边界**：文件处理的「转换」（文档→Markdown / 图片→文本）在**主进程**执行、renderer 不暴露转换过程 → 没有 assistant/agent 信封可测（不同于 KB/web search 的 full）。**唯一确定性观测口 = KB 摄入**：往知识库加一个**需要转换的文件**（PDF），看它经 `document_to_markdown` 转换 → 索引 → item 到 `completed` + 出 chunk。
> **状态**：FP-F1 **compile PASS**（2026-06-29，`.compiled` 在库）。golden 已 bake `E2E_Test_KB.file_processor_id=mineru`（测试机备份 `golden-profileDev.bak-20260629-fpf1-mineru` 后只改这一项）；PDF fixture `fp-f1-sample.pdf` 已落测试机 fixtures 目录 + secrets.local.json。实测 processing→completed 16s、chunk=1、`has-text:"fp-f1-sample"` 锚定正确（未误匹配 sample.md）。

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

### FP-F1 配置的解析引擎真能把 PDF 转换并索引（经 KB 摄入）— ✅ compile PASS（`cases/full/FP-F1-pdf-ingest.yaml` · `.compiled` 在库）
- **tier**：full · **live**：`[file-processing, embedding]` · **prereq**：`golden-profile` + `pdf-processor-base`（`E2E_Test_KB` 已 bake `fileProcessorId=mineru`，活 key）+ `${fixtures.sample-pdf}`
- **意图**：往配了 `document_to_markdown(mineru)` 的 KB 加 PDF → 引擎真转成 Markdown → 分块嵌入 → item `completed` + chunk≥1。文件处理「真转换」**唯一**可确定性观测的路径。
- **live 实测（wsf3-fpf1）**：✅ MinerU key/服务可用；加 1 页 PDF → **21.6s 到 `completed`**（remote-poll 17.1s + index 1.5s）；`kb-item-row[data-status=completed]` + `kb-chunks-count=1` + `kb-chunk-card`×1，chunk 文本含「deterministic text for MinerU conversion」。
- **流程（已编码）**：Add → `file` 源 → osascript `pick-file` 喂 `${fixtures.sample-pdf}` → **按文件名 `fp-f1-sample` 锚定 PDF 行**轮询到 `completed`（≤180s）→ 点该行 → `kb-chunk-panel`/`kb-chunks-count` 在场 + `kb-chunk-card` ≥1。
- **⚠️ gate 关键**：**必须按文件名锚定 PDF 行**（`by:{testid:kb-item-row, has-text:"fp-f1-sample"}`）——`E2E_Test_KB` 已有 sample.md（本就 `completed`），「任意 completed 行」会在 PDF 还没转完时误过。
- **红线**：只断 PDF 行终态 + chunk 计数，**不断** chunk 文本/转换质量/Markdown 排版。

## 3. config 依赖 / fixtures

| 占位 | 真值 |
|---|---|
| 目标 KB | 复用 `E2E_Test_KB` —— **golden 须 bake `fileProcessorId=mineru`**（校准时在 per-run UI 设过，DB 验 `file_processor_id=mineru`；现需写进 golden 本体）|
| 转换引擎 | `mineru`（`https://mineru.net`，golden overrides 有 key）—— **2026-06-29 校准验活**（21.6s 转完 1 页 PDF）|
| PDF fixture | `${fixtures.sample-pdf}` = `…/knowledge_test_docs/e2e/fp-f1-sample.pdf`（secrets.example.json 已加占位；**测试机须落一个稳定小 PDF**，文件名含 `fp-f1-sample`、内嵌确定文本）|

## 4. 待办

1. ✅ **FP-F1 完工**：编码 + golden bake + PDF fixture + compile PASS，`.compiled` 在库。
2. **FP-M2b（apikey 删除 CRUD）— 快照 bug 已修，可升级为真 live CRUD**：上游 [#16494](https://github.com/CherryHQ/cherry-studio/pull/16494) `fix(file-processing): refresh API key list after edits` 已 **cherry-pick 进本分支**（`useFileProcessingApiKeyList` 改 `useState`+`setKeys`、`ProcessorPanel.openApiKeyList` 包装 `onSetApiKeys` 回写 `apiKeysInput`）→ 弹窗 add/delete **立即 live 反映、无需 close→reopen**。**待 live 复测**确认后：light/medium 的 **FP-M2 可从「add+空值拒绝+cancel 净零」升级为真 add→行+1 / delete→行消失（live）**；原 FP-M2b 的「close→reopen 观测 count」绕道作废。**红线仍只断行 count/在场，不断 key 明文。**
3. **FP-F2（图片 OCR，`image_to_text`）— 观测口在「翻译」非知识库**（用户 2026-06-29 纠正：**OCR 不在 KB 消费**）。链路（已核实）：`/app/translate`（`TranslatePage.tsx`/`TranslateInputPane.tsx`）→ 上传/拖拽/粘贴图片（`imageExts=.jpg/.jpeg/.png/.gif/.bmp/.webp`）→ `processFile`→`isImageFileMetadata`→`startOcr`→ `ipcApi.request('file_processing.start_job',{feature:'image_to_text',file})` → **OCR 文本回填翻译输入 `<textarea>`**（`appendTranslateInput`，placeholder `translate.input.placeholder`）。**与 FP-F1 不同：OCR 结果 renderer 可观测**（textarea 非空）→ gate = 上传图片后 textarea value 非空（**信封，不断文本质量**）+ 处理中 `div[role=status][aria-live=polite]`（`t('ocr.processing')`）+ 成功 toast `translate.files.ocr_completed`。**引擎**：默认 `default_image_to_text` 决定；**macOS `system`（Vision，离线无 key）/ Linux `tesseract`（离线）→ FP-F2 可离线跑**（golden 现 bake `paddleocr`=远程需 key，FP-F2 宜改用 `system` 或临时设默认）。fixture 待补：内嵌确定文本的小图片。
