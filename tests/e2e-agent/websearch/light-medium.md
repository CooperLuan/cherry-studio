# Web Search E2E — light/medium 规格（SoT · 草案，待 live 校准）

> 域 spec，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**（无 v1/v2 共存，preference 走 SQLite）。
> **状态**：分析完成（4 个 Explore 核实锚点）+ 规划草案。**未 live 校准、未编码 YAML**。锚点须在测试机最新 checkout 复核（origin 落后 upstream/main，参 KB 教训）。

## 0. 架构与锚点策略

三块界面：
- **设置页** `src/renderer/pages/settings/WebSearchSettings/`（路由 `/settings/websearch`）
  - 左侧 `MenuList`：顶部「搜索服务商」(general，=`WebSearchGeneralSettings`) + 按 capability 分组的 provider 菜单项（`MenuItem`，默认 provider 挂绿色 `common.default` Badge）
  - 右侧：选 general → `BasicSettings`（默认 keywords provider select / fetch provider select / max_results / compression method / cutoff）+ `BlacklistSettings`（exclude_domains textarea）；选某 provider → `WebSearchProviderSetting`（apiKey / apiHost / check / set-as-default / searxng basic-auth）
- **聊天开关** `src/renderer/components/composer/tools/components/WebSearchButton.tsx`（"+" 工具菜单内，`aria-label`+`aria-pressed`+`disabled`，状态存 `assistant.settings.enableWebSearch`）
- **消息结果** `src/renderer/components/chat/messages/tools/webSearch/MessageWebSearch.tsx`（`ToolDisclosure` + 结果列表 + 引用计数 `message.websearch.fetch_complete {count}`）

**Provider（9）**：zhipu / tavily / exa / exa-mcp / bocha / jina / querit / searxng / fetch。默认 keywords=`exa-mcp`、fetch=`jina`、max_results=`5`、compression.method=`none`、cutoff_limit=`2000`。启用 = `provider_overrides` 里有记录（无显式开关）。**golden 已配 tavily/exa/bocha key**（provider_overrides），light/medium 离线不碰真实 key。

**锚点策略**（同 KB）：关键状态/列表走 `data-*`（locale 无关），文本锚点写 i18n key 按 `locale` 解析。web search **几乎没有 testid**，必补一小批（见 §3）。

## 1. 确定性红线

- `check:` 只断 DOM 显隐 / enabled-disabled / 属性等值（`data-default`/`data-method`）/ count / 文本信封。
- **禁断**：搜索结果内容、排序、质量、check 真实结果。
- **light/medium 全离线**；真实搜索（WS-M6）+ check 真实验证 → **full**（信封/观测，非 gating）。

## 2. 用例

### Light（设置页 · 离线 · 强确定性）

#### WS-L1 打开设置页 + 渲染校验
- **prereq**：`golden-profile`（web-search-configured：tavily/exa/bocha 启用，默认 keywords=exa-mcp / fetch=jina）
- **步骤**：goto 设置 → 进 web search 设置页（导航锚点 live 校准定）
- **gate**：
  - PageHeader 标题 `settings.tool.websearch.title` 可见
  - 「搜索服务商」(general) 菜单项可见
  - 关键 provider 菜单项存在（按品牌名 `Tavily`/`Jina`/`ExaMCP` 文本定位，品牌名不随 locale）
  - 默认 keywords provider（exa-mcp）的默认 Badge 可见（`testid: ws-default-badge` + `data-provider-id=exa-mcp`）；默认 fetch provider（jina）同理
- **锚点**：PageHeader i18n；provider 菜单项 = `within: MenuList` + `has-attr: data-slot=menu-item` + 品牌名 `has-text`；默认 Badge = `testid: ws-default-badge` + `data-provider-id`（**已补**）

#### WS-L2 compression 条件字段（仿 KB M4）
- **prereq**：`golden-profile`；停在 general 面板
- **步骤**：compression method 默认 `none`（cutoff input 不在）→ select 选 `cutoff`（cutoff limit input 出现/enabled）→ select 选回 `none`（cutoff input 消失）
- **gate**：cutoff limit input visible/hidden 随 method 切换
- **锚点**：`field-i18n: settings.tool.websearch.compression.method.label`（select）；cutoff input `field-i18n: ...compression.cutoff.limit.label`（或补 testid）
- **确定性**：纯前端条件显隐 ✅

#### WS-L3 max_results 边界
- **步骤**：输入 `200`→blur→clamp `100`；输入 `0`→clamp `1`；改非默认值→reset 按钮出现→点 reset→回 `5`；输入 `25`(>20) 且 compression=none→tooltip 出现
- **gate**：input clamp 后的值、reset→默认 5、tooltip 显隐
- **锚点**：`aria-i18n: settings.tool.websearch.search_max_result.label`（input）；`aria: common.reset`
- **待校准**：clamp 触发时机（blur vs 实时）

#### WS-L4 切换默认搜索 provider
- **步骤**：default keywords provider select（general 面板）从 exa-mcp 选 `tavily` → tavily 的默认 Badge 出现、exa-mcp 的消失
- **gate**：默认 Badge 从旧 provider 迁移到新（`[testid=ws-default-badge][data-provider-id=tavily]` visible、`[...=exa-mcp]` hidden）
- **锚点**：default provider select `field-i18n: settings.tool.websearch.default_provider`；默认 Badge `testid: ws-default-badge` + `data-provider-id`（**已补**）

### Medium（更多分支 + CRUD + 聊天开关 · 离线）

#### WS-M1 provider 配置 + set-as-default 按钮态
- **步骤**：点 tavily 菜单项 → 右侧 set-as-default 按钮（tavily 非默认时 enabled、文案 `set_as_default`）→ 点击 → 按钮 disabled、文案 `is_default`
- **gate**：按钮 enabled→disabled + 文案 `set_as_default`↔`is_default`
- **锚点**：set-default 按钮 `i18n: settings.tool.websearch.set_as_default` / `is_default` + `disabled`；（可选）api key input `placeholder-i18n: settings.provider.api_key.label`
- **确定性**：按钮态确定 ✅（不点 check、不真验证）

#### WS-M2 API key list 对话框 CRUD
- **步骤**：点 tavily → api key list 打开按钮（`aria-i18n: settings.provider.api.key.list.open`）→ 对话框打开 → add key（新条目出现）→ 空 key 保存→报错 `settings.provider.api.key.error.empty` → delete key（确认→条目消失）
- **gate**：对话框开/关、条目 count、错误文案
- **锚点**：aria-label（list open / add=common.add / save=common.save / delete=common.delete / cancel=common.cancel）；key 条目（视情补 testid）

#### WS-M3 searxng basic auth 条件显隐
- **步骤**：点 searxng 菜单项 → username（`#websearch-basic-auth-username`）空时 password 框 hidden → 填 username → password 框（`#websearch-basic-auth-password`）visible → 清空 username → password 框 hidden
- **gate**：password 框显隐随 username 非空
- **锚点**：现成 `id` ✅，**无需补 testid**
- **确定性**：纯前端条件显隐 ✅

#### WS-M4 blacklist 增删 + 非法校验
- **步骤**：general 面板 → blacklist textarea（`placeholder-i18n: settings.tool.websearch.blacklist_tooltip`）→ 输入合法 `*://*.example.com/*`→save（成功）→ 输入非法条目→save→错误 `settings.tool.websearch.blacklist_invalid_entries`
- **gate**：保存成功 / 非法错误文案
- **锚点**：textarea placeholder-i18n；save 按钮 `common.save`
- **确定性**：校验为前端正则 ✅

#### WS-M5 聊天 web search 开关
- **prereq**：`golden-profile` + 可用对话/助手 + 支持的模型（**live 校准确认 golden 有默认助手**；无则补 seed 或暂缓，仿 KB M6）
- **步骤**：到聊天 → "+" 工具菜单 → web search 按钮 → 点击 toggle（`aria-pressed=true`）→ 再点（`aria-pressed=false`）；（可选）切到不支持 web search 的模型 → 按钮 `disabled`
- **gate**：`aria-pressed` true/false；disabled 态
- **锚点**：`aria-i18n: chat.input.web_search.label` + `aria-pressed`/`disabled`（现成 ✅）

### Full（live / 非 gating，暂缓）

#### WS-M6 实际搜索信封（live：网络+LLM）
- **步骤**：开启 web search → 发消息 → loading（`message.searching`）→ 结果块 `ToolDisclosure` 出现 → 引用 `count ≥ 0`（`message.websearch.fetch_complete`）
- **gate**：**只断信封**（loading 出现、结果块出现、count≥0），**禁断**内容/排序/URL
- **锚点**：`message.searching` 文本；结果块（现 `collapse-content-{动态id}`，稳定锚点需补 `web-search-tool-disclosure` + `data-result-count`）
- check 按钮真实验证同归 full（观测）

## 3. 需补 testid（最小集 · 仿 KB 2A）

绝大多数可测点复用现有 `aria-label`/`placeholder`/`id`/`field-i18n`；真正必补：

1. ✅ **默认 Badge wrapper**（`WebSearchSettings/index.tsx`）：给 `isDefault` 的 `<Badge>` 外包裸 `<span data-testid="ws-default-badge" data-provider-id={entry.provider.id}>` —— WS-L1/L4 默认态 + 迁移 gate 核心。**已实现**（裸 span 透传 data-*，无需改 `@cherrystudio/ui` `MenuItem` 类型）。provider 菜单项本身靠品牌名文本（`data-slot=menu-item` + `Tavily`/`Jina` 等）定位，不另补 testid。
2. 🟡（视 live 校准）compression method select + cutoff input testid（WS-L2，否则 `field-i18n`）。
3. 🟡（仅 WS-M6/full）结果块 `web-search-tool-disclosure` + `data-result-count`（现 `collapse-content-{动态}` 后缀不稳）。

> **不**补 Explore 建议的全部 ~16 个 testid（投机）。先补 #1，#2/#3 按 live 校准缺口再定。

## 4. live 校准待确认

- a. 设置页导航到 web search 的锚点（侧边栏路径）
- b. max_results clamp 触发时机（blur vs 实时）
- c. golden 有无默认助手/可用模型（WS-M5 前置）
- d. compression / blacklist 是否在 general 面板默认渲染可见
- e. 默认 Badge wrapper（`ws-default-badge`）live 渲染 + 品牌名文本定位 menu-item 是否稳定
- f. set-as-default 在每个 capability 分组的语义（keywords vs fetchUrls 各自默认）

## 5. tier 编码 / secrets

- **light**：WS-L1~L4；**medium**：WS-M1~M5；**full**：WS-M6 + check 真实验证（暂缓）。
- `after:` 链可让 WS-L1→L4 继承设置页态（各 case 也基本独立，按需）。
- **secrets**：web search provider key 随 golden（`provider_overrides`：tavily/exa/bocha），light/medium 离线不碰真实 key → **无需** `secrets.local.json` 新增；prereq 用 `golden-profile`（隐含 web-search-configured）。
