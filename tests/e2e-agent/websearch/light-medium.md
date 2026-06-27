# Web Search E2E — light/medium 规格（SoT · 已 live 校准）

> 域 spec，对齐 [`../README.md`](../README.md) 框架契约。**纯 v2**（无 v1/v2 共存，preference 走 SQLite）。
> **状态**：已 live 校准并跑通。**首跑 9 case：L1-L4 + M1-M4 全 PASS；M5 首版（disabled gate）FAIL→已转向 enable/disable toggle**（golden 活动模型从 `Qwen|CherryAI` 漂到 `DeepSeek V4 Flash|CherryInExpress`、支持 web search，disabled 前提作废，见 WS-M5）。锚点已对实测对齐，待测试机复跑 M5 toggle 确认。`.compiled/` 首跑已产出（M5 toggle 版待重跑回填）。

## 0. 架构与锚点

三块界面：
- **设置页** `src/renderer/pages/settings/WebSearchSettings/`（路由 `/settings/websearch`）
  - 左侧 `MenuList`：顶部「搜索服务商」(general，=`WebSearchGeneralSettings`) + 按 capability 分组的 provider `MenuItem`（默认 provider 挂 `ws-default-badge` span）
  - 右侧 general → `BasicSettings`（keywords/fetch provider select + max_results + compression method）+ `CutoffSettings`（method=cutoff 时）+ `BlacklistSettings`；右侧某 provider → `WebSearchProviderSetting`（apiKey/host/check/set-default/searxng basic-auth）
- **聊天开关** `composer/tools/components/WebSearchButton.tsx`（"+" 工具菜单内 menuitem；当前模型不支持时 `aria-disabled`）
- **消息结果** `chat/messages/tools/webSearch/MessageWebSearch.tsx`（`ToolDisclosure` + 结果列表 + 引用计数）

**已补/可用锚点**（本批补的 id + 现成）：
| 控件 | 锚点 |
|---|---|
| provider 菜单项（左列） | `has-attr: data-slot=menu-item` + 品牌名 `has-text`（Tavily/Searxng/Bocha，不随 locale）⚠️**仅 `jina` 双能力（出现两次）**，其余单能力唯一；⚠️**"Exa" 会撞 "ExaMCP"**，需精确品牌名 |
| 默认 Badge | `testid: ws-default-badge` + `data-provider-id`（**已补 span**）|
| 默认 keywords provider select | `id: web-search-default-keywords-provider`（**已补**）|
| 默认 fetch provider select | `id: web-search-default-fetch-provider`（**已补**）|
| compression method select | `id: web-search-compression-method`（**已补**）|
| cutoff limit input | `placeholder-i18n: settings.tool.websearch.compression.cutoff.limit.placeholder`（method=none 时不在 DOM）|
| max_results input | `aria-i18n: settings.tool.websearch.search_max_result.label` |
| max_results reset | `aria-i18n: common.reset`（=「重置」）|
| set-as-default 按钮 | 右侧面板 `i18n: settings.tool.websearch.set_as_default`/`is_default` + `disabled` |
| api key 列表打开 | `aria-i18n: settings.provider.api.key.list.open`（=「打开管理界面」）|
| api key input | `placeholder-i18n: settings.provider.api_key.label` |
| api key 对话框标题 | `provider.name` + `settings.provider.api.key.list.title`（如「Tavily API 密钥管理」）|
| searxng basic-auth | `#websearch-basic-auth-username` / `#websearch-basic-auth-password` |

**导航**（live 实测）：主窗口左下 **设置** → 设置页左列 **网络搜索**。CDP 连接后须选 main window tab `localhost:5173/windows/main/index.html`（默认会先落到 selection-assistant target，要切过去）。

## 1. 确定性红线

- `check:` 只断 DOM 显隐 / enabled-disabled / 属性等值 / count / 文本信封。
- **禁断**搜索结果内容、排序、质量、check 真实结果。
- **light/medium 全离线**；真实搜索（WS-M6）+ check 真实验证 → **full**。

## 2. 用例

### Light（设置页 · 离线 · 全 PASS）

#### WS-L1 打开设置页 + 渲染校验 — PASS
- **prereq**：`golden-profile`（web-search-configured：默认 keywords=exa-mcp / fetch=jina；tavily/exa/bocha 已配 key）
- **步骤**：goto 设置（左下）→ 网络搜索
- **gate**：
  - PageHeader 标题 `settings.tool.websearch.title` 可见
  - 左列存在 provider 菜单项（`within MenuList` 按品牌名 ExaMCP/Jina/Tavily）
  - 默认 keywords（exa-mcp）`[ws-default-badge][data-provider-id=exa-mcp]` visible；默认 fetch（jina）`[...=jina]` visible

#### WS-L2 compression 条件字段 — PASS
- **步骤**：general 面板；compression method 默认 `none`（cutoff input 不在 DOM）→ select(`#web-search-compression-method`) 选 `截断`(cutoff)（cutoff input visible）→ 选 `不压缩`(none)（cutoff input 消失）
- **gate**：cutoff input visible/hidden 随 method
- **锚点**：`#web-search-compression-method`；option 文本 `compression.method.none`/`cutoff`；cutoff input `placeholder-i18n: compression.cutoff.limit.placeholder`

#### WS-L3 max_results 边界 — PASS
- **步骤**：输入 `200`→blur→`100`；`0`→blur→`1`；改非默认→reset 按钮(`common.reset`)出现→点→回 `5`；输入 `25` 且 compression=none → tooltip(`search_max_result.tooltip`)出现
- **gate**：clamp 后值、reset→5、tooltip 显隐
- **校准**：clamp 在 **blur** 触发（输入未 blur 仍是原值）；reset aria-label = 「重置」

#### WS-L4 切换默认搜索 provider — PASS
- **步骤**：keywords select(`#web-search-default-keywords-provider`) 从 exa-mcp 选 `tavily` → 断言 → **复位回 exa-mcp**
- **gate**：`[ws-default-badge][data-provider-id=tavily]` visible、`[...=exa-mcp]` hidden；fetch 默认（jina）**不变**（keywords/fetch 独立）
- **复位必须**：run 内 light⊂medium 顺序跑，L4 不复位则 WS-M1 看到 tavily 已是默认 → set-default 按钮 disabled → M1 失败。结尾 `select → exa-mcp` 恢复 golden 默认（亦使本 case 可重跑）

### Medium（更多分支 + CRUD + 聊天 toggle · 离线）

#### WS-M1 provider 配置 + set-as-default 按钮态 — PASS
- **步骤**：点左列 tavily（单能力 keywords，唯一菜单项）→ 右侧面板 set-as-default 按钮（tavily 非默认时文案 `set_as_default`、enabled）→ 点击 → 文案 `is_default`、`disabled`
- **gate**：按钮 enabled→disabled + 文案 `set_as_default`↔`is_default`
- **确定性**：不点 check、不真验证
- **状态**：留 tavily 为 keywords 默认（M2-M5 不依赖 keywords 默认身份 → 无需复位；M5 仍 disabled，因 tavily 在 golden 有 key→backend 在场）

#### WS-M2 API key list 对话框 + 空值校验 — PASS
- **步骤**：点 tavily → 列表打开按钮(`aria-i18n: api.key.list.open`) → 对话框打开（title 含 `api.key.list.title`）→ `common.add` 加新行（编辑 input 出现）→ **空值保存**(`common.save`)→ 行不提交（input 仍在）→ `common.cancel` → pending 行移除（input 消失）
- **gate**：对话框开、编辑行显隐、空值拒绝（保存后 input 仍在）
- **净零**：cancel 移除 pending 行，不改 golden 既有 key
- **确定性理由**：golden 已配 tavily key（初始条目数未知）→ **不**断条目 count、**不**走 delete-confirm（破坏既有 key + 行身份不可定位）→ 删除 CRUD 推 **full**（隔离临时 provider 上做）
- **锚点**：aria-label（add=`common.add`、save/cancel=`common.*`）、`placeholder-i18n: settings.provider.api.key.new_key.placeholder`

#### WS-M3 searxng basic auth 条件显隐 — PASS（清空动作已校准）
- **步骤**：点左列 searxng → username(`#websearch-basic-auth-username`) 空时 password 框不在 → 填 username → password 框(`#websearch-basic-auth-password`) 出现 → **真实 Backspace 清空** username → password 框消失
- **gate**：password 框显隐随 username 非空
- **校准（runner DSL）**：清空动作**必须真实键盘清空**（连续 Backspace）。`type text:""` / fill `""` 不稳——blur 后会恢复旧值（受控 input）。`type text:""` 在 runner 里要实现成「focus + 全选 + Backspace」或逐字符 Backspace。

#### WS-M4 blacklist 增删 + 非法校验 — PASS
- **步骤**：general 面板 blacklist textarea(`placeholder-i18n: blacklist_tooltip`) → 输入合法 `*://*.example.com/*`→save(`common.save`)（成功）→ 输入非法→save→错误 `blacklist_invalid_entries`
- **gate**：保存成功 / 非法错误文案

#### WS-M5 聊天 web search 启用/关闭 toggle — PASS
- **prereq**：`golden-profile`（Default Assistant + 当前模型 `DeepSeek V4 Flash | CherryInExpress` **支持** web search；web search 初始 OFF）
- **步骤**：到聊天(`nav: assistants`) → 初始活动控件区无 web search 按钮 → 开 "+" 菜单(web search 项 enabled) → 点击启用(菜单关 + 按钮进活动控件区) → 点活动控件区按钮关闭(复位 OFF)
- **gate**：① OFF 时活动控件区无 `[data-active][aria-label=网络搜索]` ② "+" 内 web search 菜单项 `enabled` ③ 启用后活动控件区出现该按钮 ④ 再点 → 消失（净零）
- **锚点**：opener=`aria-i18n: common.add`；"+" 内项=`role=menuitem` + `aria-i18n: chat.input.web_search.label`；活动控件区按钮=`has-attr: data-active` + `aria-i18n: chat.input.web_search.label`（`ComposerActiveToolControls` 用 `launcher.label`，启用后 aria-label 仍「网络搜索」不变）
- **关键行为**（`ComposerToolRuntime.tsx:550`）：点菜单项 `closeToolMenu()`(菜单关) + `dispatchLauncher`(toggle)；启用的 launcher 移出 "+" 菜单、进 `ComposerActiveToolControls`(L390) 渲染 `<button data-active aria-label=网络搜索>`，不开 "+" 即可见
- **6.27 转向**：原设计测「模型不支持→`aria-disabled=true`」**前提被 golden 模型变更推翻**（live 时 golden 活动模型已从 `Qwen|CherryAI` 漂到 `DeepSeek V4 Flash|CherryInExpress`，后者支持 web search→项是可用态、`aria-disabled=null`）→ 改测真 toggle（既匹配现 golden、又测真功能）；disabled-state 是反向、模型固定的边缘态 → full（WS-M5c）

### Full（live / 暂缓）

#### WS-M5c 聊天 web search 项 disabled（full：需固定不支持的模型）
- 反向边缘态：当 assistant 模型**不支持** web search（如 `Qwen|CherryAI`）时，"+" 菜单内 web search 项 `aria-disabled=true`、不可启用。需先把 assistant 模型 pin 到不支持的型号（golden 默认模型支持 → medium 测不了此态），故推 full。
#### WS-M2b API key 删除 CRUD（full：隔离临时 provider）
- 在不含 golden 真实 key 的 provider（或临时种入的可弃 key）上：add→save→delete(`common.delete`)→确认(`common.delete_confirm`→`common.confirm`)→ 条目消失。golden 上不做（破坏既有 key + 行身份不可定位）。
#### WS-M6 实际搜索信封（live：网络+LLM）
- 开启 → 发消息 → loading(`message.searching`) → 结果块 `ToolDisclosure` → 引用 count≥0（只断信封）。
#### check 按钮真实验证 — full（观测）

## 3. 已补 testid/id（最小集）

1. ✅ `ws-default-badge`（`WebSearchSettings/index.tsx`，isDefault Badge 外裸 span + `data-provider-id`）
2. ✅ `#web-search-default-keywords-provider` / `#web-search-default-fetch-provider`（`BasicSettings.tsx` 两个 SelectTrigger，加 `id`——`data-testid` 会 TS 报错，`id` 透传安全）
3. ✅ `#web-search-compression-method`（`CompressionSettings/index.tsx` SelectTrigger `id`）

> provider 菜单项、set-default、api key、searxng、cutoff、max_results 全部复用现成 `data-slot`/品牌名/i18n/`#id`/placeholder，不另补。

## 4. live 校准结论（6 项已答）

- a. **导航**：左下 设置 → 左列 网络搜索；CDP 连后选 `localhost:5173/windows/main/index.html` main window（别落 selection-assistant）。
- b. **max_results clamp = blur 后触发**；reset aria-label=「重置」。
- c. **golden 有默认助手**，活动模型 = `DeepSeek V4 Flash | CherryInExpress`（**支持** web search；live 时已从早期 `Qwen|CherryAI` 漂移）→ "+" 菜单 web search 项可用 → **WS-M5 测真 enable/disable toggle**；disabled-state（不支持模型）= 反向边缘态推 full（M5c）。⚠️ golden 活动模型会随 golden 更新而变 → M5 假设「模型支持 + web search 初始 OFF」，golden 重做时须维持。
- d. **compression + blacklist 在 general 面板默认可见**；compression 默认「不压缩」，cutoff 输入默认不在 DOM；blacklist textarea 默认可见。
- e. **`ws-default-badge` 真渲染**（初始 exa-mcp + jina）；品牌名文本定位**须 scope 到左列 MenuList**。
- f. **keywords 与 fetchUrls 各自独立默认**（改 keywords→tavily 后 badge=tavily+jina，fetch 未动）。

## 5. tier / secrets

- **light**：WS-L1~L4；**medium**：WS-M1~M5（M5=enable/disable toggle）；**full**：M2b + M5c(disabled-state,需 pin 不支持模型) + M6 + check（暂缓）。
- **run 内状态共享**：每 run 复制一份 golden 跑全部 case（非每 case），故 case 须**对全局 web search 设置幂等/自复位**：L3 reset→5、L4 reset→exa-mcp、M2 cancel 移 pending、M3 清空 username；M1 留 tavily 默认（无后续依赖）、M4 留黑名单（无后续依赖）。provider 能力图谱（仅 `jina` 双能力）= `src/shared/data/presets/webSearchProviders.ts`，锚点歧义判定的单一来源。
- 每 case 自带 `goto 设置 → 网络搜索`（不用 `after:` 链），可独立重跑。
- **secrets**：web search provider key 随 golden（`provider_overrides`：tavily/exa/bocha），light/medium 离线不碰真实 key → **无需** `secrets.local.json` 新增；prereq 用 `golden-profile`（隐含 web-search-configured + 当前模型不支持 web search → M5 disabled 可测）。
