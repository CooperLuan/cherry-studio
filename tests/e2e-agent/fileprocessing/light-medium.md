# File Processing E2E — light/medium 规格（SoT · 已 live 校准）

> 域 spec「文件处理 / 文档解析」，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**（preference 走 SQLite）。
> **状态**：已在 `41dc908e0` live 校准（测试机 agent-browser，golden=zh-CN）。**FP-L1~L4 + M1/M3/M4 PASS**；**FP-M2 已升级为真 live CRUD**（弹窗快照 bug 经上游 [#16494](https://github.com/CherryHQ/cherry-studio/pull/16494) 修复并 cherry-pick + live 验证：add→行 +1 / delete→归零，均即时、无需 close→reopen；用 mistral 空列表隔离）→ **待测试机重 compile 产 `.compiled`**。§4 校准点全部有答。
> **本质边界**：真正的「转换」（文档→Markdown / 图片→文本）在主进程执行，**renderer 不暴露转换过程**（结果被 LLM/KB 消费）。因此本域 light/medium = **设置/配置面**（离线确定性），与 `websearch` 完全同构；实际转换 = live、只能跨 `knowledge` 域间接观测 → 归 **full**（见 §6，本批不做）。

## 0. 架构与锚点

**唯一确定性界面：文件处理设置页** `src/renderer/pages/settings/FileProcessingSettings/`（路由 `/settings/file-processing`）

- 左列 `MenuList`（`data-slot=menu-list`）：两个 feature section，section 间有 `MenuDivider`
  - section 标题：`image_to_text`=「OCR」(`features.image_to_text.title`) / `document_to_markdown`=「文档处理」(`features.document_to_markdown.title`)
  - 每个 processor 一个 `MenuItem`（`data-slot=menu-item`、`data-active`、**本批补 `id`**）；默认 processor 挂默认 Badge（**本批补 span testid**）
  - **可用 processor 由 IPC `file_processing.list_available_processors` 按平台过滤**（`useAvailableFileProcessors`）→ **macOS 实测**：`ovocr`（Win+Intel 限定）隐藏，其余菜单项共 **9 个**（OCR 段 system/paddleocr/tesseract/mistral=4；文档段 mineru/paddleocr/doc2x/mistral/open-mineru=5；paddleocr、mistral 各出现两次）
- 右列 `ProcessorPanel`：选中 processor 的配置面板
  - header：processor 名 + 默认态（默认显 `common.default` Badge / 非默认显「设为默认」`actions.set_as_default` Button，`ProcessorPanel.tsx:177-191`）
  - **条件渲染（已 live 实测）**：
    - api 类（paddleocr/mineru/doc2x/mistral/open-mineru）→ API 密钥输入（`fields.api_key`，password）+ API key 列表按钮 + **API 地址输入**（`settings.provider.api_host`）。✅ **实测 5 个 api 引擎在两个 feature 下都显示 API 地址**（preset 全带 `apiHost`；纠正早期探查「仅 mistral/open-mineru」之误）
    - builtin（system/tesseract）→ **无** 任何 api 配置
    - `processor.id==='paddleocr'` → PaddleOCR 解析模型 Select（`PaddleOcrModelSettings`，选项随 feature 变）+ 部署信息
    - `processor.id==='system'` → 系统 OCR 状态块（`system.status.available`）；**macOS 上无语言包**
    - tesseract（全平台）/ system（仅 Windows）→ 语言包 Combobox（`fields.languages`）

**金标处理器配置**（golden / `file-processing-configured`，sqlite 实测）：默认文档→md = `mineru`、默认图片→文本 = `paddleocr`；`overrides` 仅 **paddleocr/mineru/doc2x 有 key**（**mistral / open-mineru 无 golden key** → 空 key 列表，适合 full 隔离 CRUD）。

**锚点表**（i18n 全部 zh-cn 实测存在）：
| 控件 | 锚点 |
|---|---|
| 菜单项（左列，定位/scope） | **`id: fp-item-<feature>-<processorId>`**（本批补，如 `fp-item-document_to_markdown-mineru` / `fp-item-image_to_text-paddleocr`）—— locale 无关、解决 paddleocr/mistral 双 section 同名歧义 |
| 菜单默认 Badge | **`testid: fp-menu-default-badge` + `data-feature` + `data-processor-id`**（本批补 span）|
| 面板默认 Badge | **`testid: fp-panel-default-badge` + `data-feature` + `data-processor-id`**（本批补 span）|
| 设为默认按钮 | `i18n: settings.tool.file_processing.actions.set_as_default`（=「设为默认」，role=button）|
| API 密钥输入 | `placeholder-i18n: settings.tool.file_processing.fields.api_keys_placeholder`（=「多个密钥可用逗号分隔」，type=password）|
| API key 列表按钮 | `aria-i18n: settings.provider.api.key.list.open` |
| API 地址输入 | `placeholder-i18n: settings.provider.api_host` |
| PaddleOCR 解析模型 Select trigger | `aria-i18n: settings.tool.file_processing.processors.paddleocr.fields.parse_model`（=「解析模型」）|
| PaddleOCR 选项（Radix SelectItem） | `role: option` + `has-text: "<型号>"`（型号字符串 locale 无关）|
| 系统 OCR 状态块 | `i18n: settings.tool.file_processing.processors.system.status.available` |
| 语言包 row | `i18n: settings.tool.file_processing.fields.languages`（=「语言」）|

**API key 列表弹窗**（`FileProcessingApiKeyList` Dialog，与 websearch WS-M2 同构）：
| 控件 | 锚点 |
|---|---|
| 对话框标题 | `i18n: settings.provider.api.key.list.title`（实际为 `<名> API 密钥管理`）|
| 空列表 | `i18n: error.no_api_key` |
| 新增 | `i18n: common.add`（Plus；存在未保存新行时 `disabled`）|
| 新 key 输入 | `placeholder-i18n: settings.provider.api.key.new_key.placeholder`（实测文案 =「**输入 API 密钥**」；password）|
| 保存 / 取消 | `aria-i18n: common.save`（Check） / `common.cancel`（X）|
| 复制 / 编辑 / 删除 | `aria-i18n: common.copy` / `common.edit` / `common.delete`（Minus）|
| 删除确认 | `window.modal.confirm`：title `common.delete_confirm`、ok `common.confirm`、cancel `common.cancel` |
| key 行 | `[data-testid=fp-apikey-row]`（每行；`data-new=true` 为编辑中 pending 行、`false` 为已保存行）|
| ✅ **快照限制已修** | 原 bug：弹窗 `apiKeys` 是打开时快照（`keys=useMemo(…,[apiKeys])`）→ add/delete 持久化但列表不 live 重渲染。**上游 [#16494](https://github.com/CherryHQ/cherry-studio/pull/16494) 已修**（`keys` 改 `useState`+`setKeys`、`openApiKeyList` 回写 `apiKeysInput`），已 cherry-pick 进本分支并 **live 验证**（add→行 +1、delete→归零，均无需 close→reopen）。**故 FP-M2 现断真 count CRUD**（见 §2/§4） |

**导航**（live 实测）：主窗口左下 **设置** → 设置页左列 **文档解析**（`SettingsPage.tsx:102`）。CDP 连接后须选 main window tab `localhost:5173/windows/main/index.html`。

## 1. 确定性红线

- `check:` 只断 DOM 显隐 / enabled-disabled / 属性等值 / count / 文本信封。
- **禁断**转换出的 Markdown 内容、OCR 文本质量、引擎返回值、引擎连通性真实校验。
- **light/medium 全离线**（只读/配置 UI，**不触发真实引擎**）；真实转换 → **full**（§6，本批不做）。
- API 密钥输入为 `type=password` → **不断明文值**；密钥相关只断「弹窗开闭 / 编辑行显隐」（**不断 count**，∵弹窗快照不重渲染）。

## 2. 用例

> 每个 case 自包含（`goto settings` → 点「文档解析」），不靠 `after:` 链；对全局设置 mutation 须幂等自复位（FP-M1 末尾复位默认）。

### Light（设置页渲染 + 条件渲染 · 离线 · 每次必绿）

#### FP-L1 打开设置页 + 渲染/平台过滤校验 — PASS
- **prereq**：`golden-profile`（`file-processing-configured`）
- **gate**：
  - PageHeader 标题 `settings.tool.file_processing.title`（=「文档解析」）可见
  - 两 section 标题：`features.image_to_text.title`（OCR）、`features.document_to_markdown.title`（文档处理）可见
  - 文档段菜单项 visible：`#fp-item-document_to_markdown-mineru` / `-doc2x` / `-paddleocr` / `-mistral` / `-open-mineru`
  - OCR 段菜单项 visible：`#fp-item-image_to_text-system` / `-paddleocr` / `-tesseract` / `-mistral`
  - **平台过滤**：`#fp-item-image_to_text-ovocr` **hidden**（macOS 过滤）

#### FP-L2 默认引擎 Badge 校验 — PASS
- **gate**：
  - 菜单默认 Badge：`[testid=fp-menu-default-badge][data-feature=document_to_markdown][data-processor-id=mineru]` visible；`[…][data-feature=image_to_text][data-processor-id=paddleocr]` visible
  - 点选 `#fp-item-document_to_markdown-mineru` → `[testid=fp-panel-default-badge][data-processor-id=mineru]` visible，且「设为默认」按钮 hidden

#### FP-L3 builtin vs api 面板条件渲染 — PASS
- **gate**：
  - 点 `#fp-item-image_to_text-system` → 状态块 `processors.system.status.available` visible；API 密钥输入 **hidden**；API key 列表按钮 **hidden**
  - 点 `#fp-item-image_to_text-tesseract` → 语言包 row（`fields.languages`）visible；API 密钥输入 **hidden**
  - 点 `#fp-item-document_to_markdown-mineru` → API 密钥输入 visible + API key 列表按钮 visible + **API 地址输入**（`settings.provider.api_host`）visible；PaddleOCR 解析模型 Select **hidden**（非 paddleocr）

#### FP-L4 PaddleOCR 解析模型 Select 选项随 feature — PASS
- **gate**：
  - 点 `#fp-item-image_to_text-paddleocr` → 点解析模型 Select trigger（`parse_model`）→ option `PP-OCRv6`、`PP-OCRv5` visible
  - 点 `#fp-item-document_to_markdown-paddleocr` → 点 trigger → option `PaddleOCR-VL-1.5`、`PP-StructureV3` visible
- **确定性**：同一引擎不同 feature 不同选项集；型号字符串 locale 无关；两 paddleocr 入口靠 `id` 区分

### Medium（mutation + CRUD + 校验 · 离线）

#### FP-M1 设为默认切换 — PASS
- **步骤**：点 `#fp-item-document_to_markdown-doc2x`（非默认）→ 面板显「设为默认」Button → 点击 → 末尾**复位**：点 `#fp-item-document_to_markdown-mineru` → 再点「设为默认」（恢复 golden 默认）
- **gate**：
  - 点前：`actions.set_as_default` 按钮 visible + enabled；`[testid=fp-panel-default-badge]` hidden
  - 点后：`[testid=fp-panel-default-badge][data-processor-id=doc2x]` visible；左列 `[testid=fp-menu-default-badge][data-feature=document_to_markdown][data-processor-id=doc2x]` visible
- **注**：set-default **无 toast**（实测，只 Badge 互换）；mutation 在 per-run golden 副本，且末尾复位 → 幂等

#### FP-M2 API key 列表弹窗 · 真 live CRUD（add→行+1 / delete→归零）— 升级（#16494 修复后）
- **隔离**：用 `#fp-item-document_to_markdown-mistral`（golden **无** mistral key → 空列表起点，**绝不碰** golden 已配的 paddleocr/mineru/doc2x）。apiKeys 按 processorId 存、跨 feature 共享，故选哪个 mistral section 都一样。
- **步骤 / gate**：
  - 进 mistral 面板 → 点 API key 列表按钮 → 弹窗标题 `settings.provider.api.key.list.title` visible
  - 初始空态 `error.no_api_key` visible
  - `common.add` → 输入假 key `e2e-fake-key-001` → `common.save` → **`count [data-testid=fp-apikey-row] == 1`**（live +1，#16494 前会归 0）+ 编辑 `new_key.placeholder` hidden（已转 saved 行）
  - 行内 `common.delete` → `window.modal.confirm` 的 `common.confirm` → **`error.no_api_key` 再现**（live 归零，#16494 前行会残留）→ 净零
- **红线**：只断行 count / 空态在场，**不断 key 明文**（masked）。
- **注**：原「快照不重渲染」绕道（add+空值拒绝+cancel）+ full 的 FP-M2b（close→reopen）**因 #16494 作废**，真 CRUD 已并入本 medium 例。`data-testid=fp-apikey-row` 见 §0 表。

#### FP-M3 API 地址非法校验 — PASS
- **步骤**：点 `#fp-item-image_to_text-mistral` → API 地址输入（`settings.provider.api_host`）→ 真实键盘清空后填非法值 `not a url` → blur
- **gate**：warning toast `settings.tool.file_processing.errors.invalid_api_host`（=「API 地址不合法」）visible
- **校准**：清空走真实 Backspace（受控 input，参 websearch WS-M3）；反馈是**瞬时 toast** → check 须及时（带 timeout）；合法 host 无成功信号（仅持久化）故不断「valid 无错」硬 gate

#### FP-M4 PaddleOCR 解析模型持久化 — PASS
- **步骤**：点 `#fp-item-document_to_markdown-paddleocr` → 解析模型 Select 选 `PP-StructureV3` → 切走（点 `#fp-item-document_to_markdown-mineru`）→ 切回 `#fp-item-document_to_markdown-paddleocr`
- **gate**：切回后 Select 当前值文本含 `PP-StructureV3`（持久化生效）
- **确定性**：纯本地态 + preference 持久化；不碰引擎

### Full（live 转换 · 跨域观测 · **本批不做**，见 §6）

## 3. 已补 testid/id（最小集 · commit `41dc908e0`）

> 设置页原本**无 testid/id**。唯一硬缺口 = **paddleocr / mistral 在两 section 同名重复** → 无法确定性点中/scope。补丁**仅动 `FileProcessingSettings/` 本地组件，零 `packages/ui` 改动，TS 安全**（`id` 为标准 prop；data-* 走 intrinsic `<span>`）。

1. ✅ `index.tsx` — `MenuItem` 加 `id={`fp-item-${section.feature}-${entry.processor.id}`}`（标准 `id` prop，透传 `<button>`）
2. ✅ `index.tsx` — 菜单默认 Badge 外裹 `<span data-testid="fp-menu-default-badge" data-feature data-processor-id>`
3. ✅ `components/ProcessorPanel.tsx` — 面板默认 Badge 外裹 `<span data-testid="fp-panel-default-badge" data-feature data-processor-id>`

> 设为默认按钮、api 密钥/地址输入、PaddleOCR 解析模型 Select、api key 弹窗按钮全部复用现成 aria-i18n / placeholder-i18n / role+i18n / `id`，不另补。

## 4. live 校准结论（8 项已答）

- a. **导航 + CDP tab**：左下 设置 → 左列「文档解析」；CDP 连后选 `localhost:5173/windows/main/index.html`。
- b. **平台过滤**：macOS 上 `ovocr` 隐藏，其余 9 个菜单项都在（含 paddleocr/mistral 各两次）。
- c. ✅ **API 地址字段**：mineru/doc2x/paddleocr/mistral/open-mineru **全部** 显示 API 地址输入（image 段 paddleocr/mistral 也显）。preset 是对的，纠正早期「仅 mistral/open-mineru」。
- d. **system 语言包**：macOS 上 system **只**显状态块（无语言包）；tesseract 显语言包。
- e. **默认 Badge 初始渲染**：golden 默认 mineru/paddleocr，初次进页即渲染。
- f. **set-default 反馈**：**无 toast**（仅 Badge 互换）。
- g. **API key 弹窗**：⚠️ 弹窗 `apiKeys` 是快照 → add/delete 真持久化但列表不 live 重渲染（count 不变）→ medium 只测 add+空值拒绝+cancel 净零（PASS）；真实 CRUD 推 full。空 key 不提交 + 留编辑态实测 PASS。
- h. **api key input = password**：值断言一律走弹窗（且不断 count），不读明文。

## 5. tier / secrets

- **light**：FP-L1~L4；**medium**：FP-M1~M4；**full**：见 §6（本批不做）。
- **secrets**：文件处理引擎 key（paddleocr/mineru/doc2x）随 golden（per-run 复制即带）。**light/medium 离线、不碰真实 key、不触发引擎** → **无需** `secrets.local.json` 新增。prereq 用 `golden-profile`（隐含 `file-processing-configured`）。
- **prereq 命名**：`file-processing-configured`（golden 已满足）。
- **run 内幂等**：每 run 复制一份 golden 跑全部 case → mutation 须自复位。**FP-M1 末尾复位默认 mineru**（否则破坏 FP-L2 的语义，虽 light 先跑）；**FP-M2 末尾 delete 已加的 mistral key → 净零**（mistral 本无 golden key，删后回空态）；FP-M3 留合法/非法 host（无后续依赖）；FP-M4 留 PP-StructureV3（末例、无依赖）。

## 6. Full（暂不做 · 留档）

真实转换在主进程、renderer 不可见，只能跨域观测，故全 live、归 full，**本批不实现**：
- **FP-F1（live，跨 `knowledge` 域）**：经 KB 摄取一个 **PDF** → 默认 `mineru` document_to_markdown → item 到 `completed` + `kb-chunk-card` ≥1（复用 KB L2/L3 锚点）。唯一能确定性观测「配置的引擎真能转换」的路径。
- ~~**FP-M2b（CRUD 隔离）**~~ — **作废**：#16494 修了弹窗快照不重渲染，真 CRUD 已并入 medium FP-M2（mistral 空列表隔离、add→count 1、delete→空态、净零），不再需要 close→reopen 绕道。
- **FP-F2（live · 在「翻译」非 KB）**：OCR `image_to_text` 由**翻译**消费（`/app/translate`），不在知识库。上传/拖拽/粘贴图片 → `startOcr` → `file_processing.start_job(image_to_text)` → **OCR 文本回填翻译输入 `<textarea>`**（`placeholder-i18n: translate.input.placeholder`，renderer 可观测）；处理中 `div[role=status][aria-live=polite]`（`ocr.processing`）+ 成功 toast `translate.files.ocr_completed`。引擎默认 macOS `system`（Vision，离线无 key）/ Linux `tesseract` → 可离线。gate=上传后 textarea 非空（信封，不断质量）。见 `full.md` §4。
- **（非 gating 观测）**：引擎连接 check（若设置页提供）。
