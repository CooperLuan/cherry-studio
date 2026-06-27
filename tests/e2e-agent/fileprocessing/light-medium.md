# File Processing E2E — light/medium 规格（SoT · 草案 · 待 live 校准）

> 域 spec「文件处理 / 文档解析」，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**（preference 走 SQLite）。
> **状态**：基于 upstream/main（含 #16442 等）逐 case 对照源码核实锚点；**尚未 live 跑**。锚点已落 `data-*`/`id` 补丁（见 §3），交测试机首跑校准（§4 列出待确认点）。`.compiled/` 待首跑 compile 产出。
> **本质边界**：真正的「转换」（文档→Markdown / 图片→文本）在主进程执行，**renderer 不暴露转换过程**（结果被 LLM/KB 消费）。因此本域 light/medium = **设置/配置面**（离线确定性），与 `websearch` 完全同构；实际转换 = live、且只能跨 `knowledge` 域间接观测 → 全部归 **full（本批暂不做）**。

## 0. 架构与锚点

**唯一确定性界面：文件处理设置页** `src/renderer/pages/settings/FileProcessingSettings/`（路由 `/settings/file-processing`）

- 左列 `MenuList`（`data-slot=menu-list`）：两个 feature section，section 间有 `MenuDivider`
  - section 标题：`image_to_text`=「OCR」(`features.image_to_text.title`) / `document_to_markdown`=「文档处理」(`features.document_to_markdown.title`)
  - 每个 processor 一个 `MenuItem`（`data-slot=menu-item`、`data-active`、**本批补 `id`**）；默认 processor 挂默认 Badge（**本批补 span testid**）
  - **可用 processor 由 IPC `file_processing.list_available_processors` 按平台过滤**（`useAvailableFileProcessors`）→ macOS 上 `ovocr`（Windows+Intel 限定）被隐藏
- 右列 `ProcessorPanel`：选中 processor 的配置面板
  - header：processor 名 + 默认态（默认显 `common.default` Badge / 非默认显「设为默认」`actions.set_as_default` Button，`ProcessorPanel.tsx:177-186`）
  - **条件渲染**：
    - `supportsApiSettings`（api 类：paddleocr/mineru/doc2x/mistral/open-mineru）→ API 密钥输入（`fields.api_key`，password）+ API key 列表按钮
    - `entry.capability.apiHost !== undefined` → API 地址输入（`fields.api_base_url`，placeholder `settings.provider.api_host`）。⚠️ preset 里 5 个 api 引擎**都带 apiHost** → 理应都显示；**§4 待 live 确认**
    - `processor.id==='paddleocr'` → PaddleOCR 解析模型 Select（`PaddleOcrModelSettings`，选项随 feature 变）+ 部署信息
    - `processor.id==='system'` → 系统 OCR 状态块（`system.status.available`），**无** api 配置
    - `shouldShowLanguageOptions`（tesseract 全平台 / system 仅 Windows）→ 语言包 Combobox（`fields.languages`）

**金标处理器配置**（golden / `file-processing-configured`）：默认文档→md = `mineru`、默认图片→文本 = `paddleocr`；`overrides` 里 paddleocr/mineru/doc2x 已填 key。

**锚点表**（i18n 全部 zh-cn 实测存在）：
| 控件 | 锚点 |
|---|---|
| 菜单项（左列，定位/scope） | **`id: fp-item-<feature>-<processorId>`**（本批补，如 `fp-item-document_to_markdown-mineru` / `fp-item-image_to_text-paddleocr`）—— locale 无关、解决 paddleocr/mistral 双 section 同名歧义 |
| 菜单项（按品牌名退路） | `within: data-slot=menu-list` + `has-text` 品牌名（MinerU/PaddleOCR/Doc2x/Mistral/System OCR…，多为 locale 稳定） |
| 菜单默认 Badge | **`testid: fp-menu-default-badge` + `data-feature` + `data-processor-id`**（本批补 span）|
| 面板默认 Badge | **`testid: fp-panel-default-badge` + `data-feature` + `data-processor-id`**（本批补 span）|
| 设为默认按钮 | `i18n: settings.tool.file_processing.actions.set_as_default`（=「设为默认」，role=button，无 aria/testid）|
| API 密钥输入 | `placeholder-i18n: settings.tool.file_processing.fields.api_keys_placeholder`（=「多个密钥可用逗号分隔」，type=password）|
| API key 列表按钮 | `aria-i18n: settings.provider.api.key.list.open` |
| API 地址输入 | `placeholder-i18n: settings.provider.api_host` |
| PaddleOCR 解析模型 Select | `aria-i18n: settings.tool.file_processing.processors.paddleocr.fields.parse_model`（=「解析模型」）|
| 系统 OCR 状态块 | `i18n: settings.tool.file_processing.processors.system.status.available` |
| 语言包 Combobox | row 标题 `i18n: settings.tool.file_processing.fields.languages`（=「语言」）|
| 加载失败态 | `i18n: settings.tool.file_processing.errors.load_processors_failed` |

**API key 列表弹窗**（`FileProcessingApiKeyList` Dialog，与 websearch WS-M2 同构）：
| 控件 | 锚点 |
|---|---|
| 对话框标题 | `<processorName>` + `settings.provider.api.key.list.title`（如「MinerU API 密钥管理」）|
| 空列表 | `i18n: error.no_api_key` |
| 新增 | `i18n: common.add`（Plus；存在未保存新行时 `disabled`）|
| 新 key 输入 | `placeholder-i18n: settings.provider.api.key.new_key.placeholder`（password）|
| 保存 / 取消 | `aria-i18n: common.save`（Check） / `common.cancel`（X）|
| 复制 / 编辑 / 删除 | `aria-i18n: common.copy` / `common.edit` / `common.delete`（Minus）|
| 删除确认 | `window.modal.confirm`：title `common.delete_confirm`、ok `common.confirm`、cancel `common.cancel` |

**导航**（待 live 实测，参 websearch）：主窗口左下 **设置** → 设置页左列 **文档解析**（`SettingsPage.tsx:102`，`go('/settings/file-processing')`）。CDP 连接后须选 main window tab `localhost:5173/windows/main/index.html`。

## 1. 确定性红线

- `check:` 只断 DOM 显隐 / enabled-disabled / 属性等值 / count / 文本信封。
- **禁断**转换出的 Markdown 内容、OCR 文本质量、引擎返回值、引擎连通性真实校验。
- **light/medium 全离线**（只读/配置 UI，**不触发真实引擎**）；真实转换 → **full**（本批暂不做，见 §6）。
- API 密钥输入为 `type=password` → **不断明文值**；密钥相关只断「列表条目 count / 弹窗开闭」。

## 2. 用例

### Light（设置页渲染 + 条件渲染 · 离线 · 无 mutation · 每次必绿）

#### FP-L1 打开设置页 + 渲染/平台过滤校验
- **prereq**：`golden-profile`（`file-processing-configured`）
- **步骤**：goto 设置（左下）→ 文档解析
- **gate**：
  - PageHeader 标题 `settings.tool.file_processing.title`（=「文档解析」）可见
  - 左列两个 section 标题可见：`features.image_to_text.title`（OCR）、`features.document_to_markdown.title`（文档处理）
  - 文档段菜单项存在：`#fp-item-document_to_markdown-mineru`、`-doc2x`、`-paddleocr`、`-mistral`、`-open-mineru` visible
  - OCR 段菜单项存在：`#fp-item-image_to_text-system`、`-paddleocr`、`-tesseract`、`-mistral` visible
  - **平台过滤**：`#fp-item-image_to_text-ovocr` **hidden / 不存在**（macOS 上 ovocr 被过滤）

#### FP-L2 默认引擎 Badge 校验
- **步骤**：（承 FP-L1）读默认 Badge；分别点选 `#fp-item-document_to_markdown-mineru` / `#fp-item-image_to_text-paddleocr`
- **gate**：
  - 菜单默认 Badge：`[testid=fp-menu-default-badge][data-feature=document_to_markdown][data-processor-id=mineru]` visible；`[...][data-feature=image_to_text][data-processor-id=paddleocr]` visible
  - 点选 mineru → 面板 `[testid=fp-panel-default-badge][data-processor-id=mineru]` visible，且**无**「设为默认」按钮（`actions.set_as_default` hidden）
  - 点选 paddleocr(OCR) → 面板 `[testid=fp-panel-default-badge][data-processor-id=paddleocr]` visible

#### FP-L3 builtin vs api 面板条件渲染
- **步骤/gate**：
  - 点 `#fp-item-image_to_text-system` → 状态块 `processors.system.status.available` visible；API 密钥输入（`fields.api_keys_placeholder`）**hidden**；API key 列表按钮（`api.key.list.open`）**hidden**
  - 点 `#fp-item-image_to_text-tesseract` → 语言包 row（`fields.languages`）visible；API 密钥输入 **hidden**
  - 点 `#fp-item-document_to_markdown-mineru` → API 密钥输入 visible + API key 列表按钮 visible；PaddleOCR 解析模型 Select（`paddleocr.fields.parse_model`）**hidden**（非 paddleocr）
- **确定性**：builtin 永不含 api 配置；api 必含密钥输入。**locale 无关**（placeholder-i18n + testid + i18n role）

#### FP-L4 PaddleOCR 解析模型 Select 随 feature 切换
- **步骤/gate**：
  - 点 `#fp-item-image_to_text-paddleocr` → 解析模型 Select（aria `parse_model`）visible，选项 = `PP-OCRv6` / `PP-OCRv5`
  - 点 `#fp-item-document_to_markdown-paddleocr` → 选项 = `PaddleOCR-VL-1.5` / `PaddleOCR-VL-1.6` / `PaddleOCR-VL` / `PP-StructureV3`
- **确定性**：同一引擎不同 feature 不同选项；选项值为型号字符串，**locale 无关**。两个 paddleocr 入口靠 `id` 区分（无补丁不可达 → 见 §3）

### Medium（mutation + CRUD + 校验 · 仍离线）

#### FP-M1 设为默认切换
- **步骤**：点一个非默认 api 引擎 `#fp-item-document_to_markdown-doc2x` → 面板显「设为默认」Button（非 Badge）→ 点击
- **gate**：
  - 点前：面板 `actions.set_as_default` 按钮 visible + enabled；`[testid=fp-panel-default-badge]` hidden
  - 点后：面板 `[testid=fp-panel-default-badge][data-processor-id=doc2x]` visible；按钮消失；左列 `[testid=fp-menu-default-badge][data-feature=document_to_markdown][data-processor-id=doc2x]` visible，旧默认 `[...][data-processor-id=mineru]` **hidden**
- **注**：set-default **无 toast**（§4 待确认），只断 Badge 互换；mutation 在 per-run golden 副本，互不影响

#### FP-M2 API key 列表弹窗 CRUD
- **步骤**：点 `#fp-item-document_to_markdown-mineru` → 点 API key 列表按钮（`api.key.list.open`）→ 弹窗
- **gate**：
  - 弹窗标题含 `settings.provider.api.key.list.title`（「API 密钥管理」）；初始条目 count = N（golden 有 ≥1）
  - `common.add` → 出现编辑行（`new_key.placeholder` 输入 + `common.save`/`common.cancel`）；此时 `common.add` 按钮 `disabled`
  - 在编辑行输入 key → `common.save` → 条目 count = N+1（masked 显示）
  - 某行 `common.delete` → 确认框（`common.delete_confirm` → `common.confirm`）→ 条目 count = N
  - **空 key 子断言**：`common.add` → 不输入直接 `common.save` → 不新增（仍编辑态或被移除），count 不增
- **锚点**：全 aria-i18n（`common.*`）+ placeholder-i18n。**确定性**：不真实校验 key

#### FP-M3 API 地址非法校验
- **prereq**：选一个带 API 地址字段的引擎 —— **`mistral`**（探查与 source 一致都有 host；§4 待确认是否所有 api 引擎都有）
- **步骤**：点 `#fp-item-image_to_text-mistral`（或 `-document_to_markdown-mistral`）→ API 地址输入（`settings.provider.api_host`）→ 填非法值（如 `not a url`）→ blur
- **gate**：warning toast `settings.tool.file_processing.errors.invalid_api_host`（=「API 地址不合法」）出现；填合法 host（如 `https://api.example.com`）→ blur → 无错误 toast
- **校准（DSL）**：清空动作走真实 Backspace（受控 input，参 websearch WS-M3）

#### FP-M4 PaddleOCR 解析模型持久化
- **步骤**：点 `#fp-item-document_to_markdown-paddleocr` → 解析模型 Select 选 `PP-StructureV3` → 切走（点别的菜单项）→ 切回 paddleocr(文档)
- **gate**：切回后 Select 当前值 = `PP-StructureV3`（持久化生效，`onSetCapabilityField('paddleocr','document_to_markdown','modelId',...)`）
- **确定性**：纯本地态 + preference 持久化；不碰引擎

### Full（live 转换 · 跨域观测 · **本批不做**，见 §6）

## 3. 已补 testid/id（最小集 · 本批落地）

> 设置页原本**无 testid/id**，靠 aria-i18n + placeholder-i18n + i18n 文本 + `data-slot`/`data-active`。唯一硬缺口 = **paddleocr / mistral 在两个 section 同名重复** → 无法确定性点中/scope。补丁**仅动 `FileProcessingSettings/` 本地组件，零 `packages/ui` 改动，TS 安全**（`id` 为标准 prop；data-* 走 intrinsic `<span>`）。

1. ✅ `FileProcessingSettings/index.tsx` — `MenuItem` 加 `id={`fp-item-${section.feature}-${entry.processor.id}`}`（透传到底层 `<button>`，标准 `id` prop，安全）
2. ✅ `FileProcessingSettings/index.tsx` — 菜单默认 Badge 外裹 `<span data-testid="fp-menu-default-badge" data-feature data-processor-id>`（照搬 websearch `ws-default-badge` 手法）
3. ✅ `FileProcessingSettings/components/ProcessorPanel.tsx` — 面板默认 Badge 外裹 `<span data-testid="fp-panel-default-badge" data-feature data-processor-id>`

> 设为默认按钮、api 密钥/地址输入、PaddleOCR 解析模型 Select、api key 弹窗按钮全部复用现成 aria-i18n / placeholder-i18n / role+i18n / `id`，不另补。

## 4. 待 live 校准的开放点（交测试机首跑确认）

- a. **导航 + CDP tab**：左下 设置 → 左列「文档解析」；CDP 连后选 `localhost:5173/windows/main/index.html` main window。
- b. **available-processors 平台过滤**：macOS 上确认 `ovocr` 隐藏、其余（image: system/paddleocr/tesseract/mistral；doc: mineru/paddleocr/doc2x/mistral/open-mineru）都在。
- c. **⚠️ API 地址字段可见性**：preset 里 5 个 api 引擎**都带 `apiHost`** → 理应 mineru/doc2x/paddleocr/mistral/open-mineru 都显示 API 地址输入；但探查 agent 曾报「仅 mistral/open-mineru」。**必须 live 实测**——若 mineru 也有 host，FP-L3 可加断；FP-M3 用 mistral 最稳妥。
- d. **system 语言包**：macOS 上 system 应**只**显状态块（语言包仅 Windows）；tesseract 显语言包。确认。
- e. **默认 Badge 初始渲染**：golden 默认 mineru/paddleocr → 初次进页菜单默认 Badge 是否就绪。
- f. **set-default 反馈**：确认**无 toast**（源码只持久化 + Badge 互换）。
- g. **API key 弹窗流程**：add/save/delete + 空 key 不提交，按 §2 FP-M2 实测校准（含 add 按钮 disabled 时机）。
- h. **api key input = password**：值断言一律走弹窗 count，不读明文。

## 5. tier / secrets

- **light**：FP-L1~L4；**medium**：FP-M1~M4；**full**：见 §6（本批不做）。
- `after:` 链：FP-L1→L2→L3→L4 可继承设置页态（同一 run 内顺序选菜单项）。
- **secrets**：文件处理引擎 key（paddleocr/mineru/doc2x）随 golden（app 内已配，存 SQLite，per-run 复制 golden 即带）。**light/medium 离线、不碰真实 key、不触发引擎** → **无需** `secrets.local.json` 新增。prereq 用 `golden-profile`（隐含 `file-processing-configured`：默认 mineru/paddleocr + 三家 key）。
- **prereq 新增命名**：`file-processing-configured`（golden 已满足）。

## 6. Full（暂不做 · 留档）

真实转换在主进程、renderer 不可见，只能跨域观测，故全部 live、归 full，**本批不实现**，仅留方向：
- **FP-F1（live，跨 `knowledge` 域）**：经 KB 摄取一个 **PDF** → 默认 `mineru` document_to_markdown → item 到 `completed` + `kb-chunk-card` ≥1（复用 KB L2/L3 锚点）。唯一能确定性观测「配置的引擎真能转换」的路径。
- **FP-F2（live）**：paddleocr 图片 OCR，经某消费路径触发；observability 待定。
- **（非 gating 观测）**：引擎连接 check（若设置页提供），记录不参与 pass/fail。
