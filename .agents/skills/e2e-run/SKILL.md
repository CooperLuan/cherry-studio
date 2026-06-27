---
name: e2e-run
description: Run the project's deterministic agent-browser E2E cases (tests/e2e-agent) in B-mode — compile on first run, then LLM-free replay with self-heal-on-drift. Use when triggered by Feishu IM `run <tier> [domain] [on <ref>]` (via lark-channel-bridge → Codex) to gate a branch/PR, or when asked to run/replay an e2e-agent tier locally on the test machine.
---

# e2e-run — deterministic agent-browser E2E runner（草案 / scaffold）

> **状态**：YAML 契约（[`tests/e2e-agent/README.md`](../../../tests/e2e-agent/README.md)）+ light/medium 用例已 live 验证并编码。
> 本 skill 是**执行契约草案**——把 §2 的 DSL verb 落到 **agent-browser 实际命令面**这一步，已于 fileprocessing 首跑 compile 确认并回填 `## DSL → agent-browser 绑定`。**有 `.compiled/` 的用例可确定性重放**；尚无 `.compiled` 的用例仍以**带人确认的半自动**方式跑（每个 `do`/`check` 由 agent 解释执行 + 截图）。

## 触发与参数

- **来源**：飞书 IM `run <tier> [domain] [on <branch|PR>]` → lark-channel-bridge（哑管道）→ spawn Codex + 本 skill。
- `$ARGUMENTS`：
  - `tier`（必填）：`light` | `medium` | `full`
  - `domain`（可选）：如 `knowledge`；缺省 = 该 tier 全域
  - `on <ref>`（可选）：分支名 / PR 号 / `HEAD`；缺省 = 当前 checkout

**选例规则**：跑某 tier = 跑所有 `tier:` ⊆ 请求 tier 的 case（**层累积**：medium 必含 light）。带 domain 再 `∧ domain == 请求 domain`。case 的 tier 由 YAML `tier:` 字段决定，**不靠目录**。

## 前置（测试机 harness 提供）

- `agent-browser` 已装；`pnpm install` 完成；mise/Node ≥22。
- **golden profile**（repo 外，真身 `~/.cherry-e2e/golden-profileDev`）：老用户 + 可用 provider/key（CherryInExpress 等）+ 网络搜索 + 文件处理引擎（mineru/paddleocr）+ zh-CN locale；业务数据空（库/笔记/agent 由 case 自建）。⚠️ **dev 模式强制给 `--user-data-dir` 追加 `Dev` 后缀**（`src/main/core/preboot/userDataLocation.ts` 的 `DEFAULT_DEV_USER_DATA_SUFFIX='Dev'`）——故 golden 真身目录名带 `Dev`：**维护** golden 传 `--user-data-dir=.../golden-profile`（app 实际读写 `golden-profileDev` 本体）；**per-run 隔离**把 golden **复制到 `<base>Dev`**、启动传 `--user-data-dir=<base>`（见 Phase 1）。
- **secrets / fixtures**：`~/.cherry-e2e/secrets.local.json`（repo 外，脱敏模板见 repo 内 `tests/e2e-agent/secrets.example.json`）。**取值规则**：`${secrets.<key>}` → `providers[activeProvider].<key>`（如 `${secrets.embeddingModelId}` 取当前 `activeProvider` 档案的 embedding id）；`${fixtures.<key>}` → `fixtures.<key>`（绝对路径或字符串）。**值 `null`/缺失** → 引用它的步骤按 `skip-if-absent` 跳过（如 `rerankModelId`）。**切 provider 只改 `activeProvider`**。
- **prereqs**：`golden-profile` / `completed-base` / `notes-seeded` / `no-existing-group` … 由 harness 在每 case 前置满足（详见 README §4 + 域 spec）。

## 工作流

### Phase 0 — 解析请求 + 选例

1. 解析 `tier`/`domain`/`on`。
2. `on <ref>` 给定 → checkout（`gh pr checkout <N>` 或 `git checkout <branch>`）；否则用当前 checkout。
3. glob `tests/e2e-agent/<domain>/cases/**/*.yaml`，按 `tier:`/`domain:` 字段过滤选例，按 `after:` 链拓扑排序（无 `after` 的先跑；`after` 形成同 run 内的状态继承链，如 L1→L2→L3）。
4. 校验每 case 的 `prereqs`/`fixtures`/`secrets` 在 harness 配置里可解析；缺 live secret 且 case 带 `live:` → 标 **blocked**（不算 fail），写入报告。

### Phase 1 — 启动 App + 连 agent-browser

复用 [`cherry-pr-test`](../cherry-pr-test/SKILL.md) 的 Launch/Connect 流程，但 **userData 用 golden 的 per-run 副本**（多实例隔离，互不污染；端口/路径都按本 run 取）：

1. **scoped** kill 本 run 自己的残留（按本 run 端口 / userData 路径）——**绝不**全局 `pkill Electron` 或杀固定 9222，会误杀并行的其他 e2e 实例。
2. **复制 golden**：`RUN="$HOME/.cherry-e2e/run-<runId>"`；`cp -R "$HOME/.cherry-e2e/golden-profileDev" "${RUN}Dev"`（复制到 `<base>Dev`，因 dev 会追加 Dev；整目录 `cp` 自带 `-wal/-shm`）。
3. **启动 dev**（不能裸 `pnpm debug`——它端口写死 9222 且不传 userData）：
   `cd <repo> && PATH="$PWD/node_modules/.bin:$PATH" dotenv -- electron-vite -- --inspect --sourcemap --remote-debugging-port=<port> --user-data-dir="$RUN"`（app 追加 Dev → 实际用 `${RUN}Dev`）。轮询 `<port>` LISTEN（≤30s）。
4. `agent-browser connect <port>` → `agent-browser tab` 选 `localhost:<vitePort>` 主页（避开 webview target）。
5. 处理首启场景（splash），落到主 UI。

### Phase 2 — 逐 case：满足前置 → compile / replay → 自愈

每个 case：

1. **置前置**：按 `prereqs` 让 harness 把 App 带到起点（建库、seed 笔记、清分组…）；继承 `after` 链上一 case 的态。
2. **compile（首跑或无 `.compiled`）**：按 `steps` 顺序驱动 agent-browser；逐步把 `by:` 解析成实际定位，写 `tests/e2e-agent/<domain>/.compiled/<id>.json`；截图只留 repo 外 run 目录作诊断附件；`check:` 记基线。
3. **replay（有 `.compiled`）**：直接执行已解析定位，**无 LLM**、确定性。`check` 失败 / 定位丢失 → 自愈。
4. **self-heal**：从该步语义（`do`/`intent` + `by`）让 LLM **重解析定位**，**临时**用 + **报告漂移**，**不自动改 `.compiled`**（漂移交人确认）。
5. `skip-if-absent: <ref>` 引用不满足 → 跳过该步（如无 rerank 模型）；记为 skipped 非 fail。

**红线（来自架构）**：`check:` 只能是确定性事实——DOM 在/不在、enabled/disabled、属性等值、count、文本信封。**禁止**断言召回排序/分数/命中内容/生成文本（→ full 非 gating 观测）。碰 `live:` 的步骤只断终态/信封（`data-status=completed`、摘要出现、对话框关闭）。

### Phase 3 — 清理

**scoped** kill 本 run 的 Cherry 进程（按本 run 端口/userData，不碰其他实例）；删本 run 的 userData 副本 `${RUN}Dev`；`on <ref>` 切过分支则切回默认分支（见 cherry-pr-test Phase 6）。**绝不**留 debug 进程、**绝不**动 golden 本体（`golden-profileDev`）。

### Phase 4 — 汇报（对齐架构）

- **全绿** → 飞书 IM 卡片 + Base 台账（tier/domain/ref/通过数/耗时）。
- **有失败** → 另写飞书 Doc：复现步骤 + 逐步截图 + 诊断 + 漂移项；`full` 失败附根因。
- **blocked/skipped** 单列，不计入 pass/fail，但在卡片注明。

## DSL → agent-browser 绑定（**已绑定：fileprocessing 首跑 compile，2026-06-27**）

`do`/`check` verb（README §2.2/2.3）→ agent-browser 原语的映射。以下绑定已在 `fileprocessing` light+medium 首跑 compile 中验证；`.compiled/<id>.json` 只记录 repo-portable 的 resolved selector 与基线事实，截图留 repo 外 run 目录作诊断附件。若页面存在隐藏副本（设置页有 warmup/重复 DOM），重放必须按**可见实例**执行，而不是只按全局 selector 首个节点。

| DSL | agent-browser 命令面（已绑定） |
|---|---|
| `by: { id: "x" }` | CSS `#x`，动作/断言取可见实例；如 `#fp-item-document_to_markdown-mineru`。 |
| `by: { testid, attr }` | CSS `[data-testid="..."][data-feature="..."][data-processor-id="..."]`，用于默认 Badge 等稳定锚点。 |
| `by: { i18n }` | 按 case `locale` 解析文本；点击优先 `agent-browser find role button click --name <文本>`，可见性用 DOM 可见文本轮询。 |
| `by: { aria-i18n }` / `{ aria }` | 解析为 `[aria-label="<文本>"]` 后 `agent-browser click` / `is visible`；fileprocessing 实测 `settings.provider.api.key.list.open` = `打开管理界面`。 |
| `by: { placeholder-i18n }` | 解析为 `input[placeholder="<文本>"]`；用于 API key/password 与 API 地址输入。 |
| `by: { role, has-text }` | `agent-browser find role <role> ... <text>` 或 CSS `[role="<role>"]:has-text("<text>")`；用于 Radix `role=option`。 |
| `do: goto nav: settings` | `agent-browser click 'button[aria-label="设置"]'`；随后按设置左列目标项继续点击（如「文档解析」）。 |
| `do: click` | `agent-browser click <resolved selector>`；文本按钮用 role/name，id/testid/aria 用 CSS。 |
| `do: type` | `agent-browser click <input>` → `agent-browser press Meta+A` → `agent-browser press Backspace` → `agent-browser keyboard type <text>`；语义是替换而非追加。 |
| `do: select` | `agent-browser click <combobox selector>` → `agent-browser click '[role="option"]:has-text("<option>")'`；用于 PaddleOCR 解析模型。 |
| `do: press` | `agent-browser press <keys>`；用于 `Escape` 关闭 Select/Dialog、`Tab` blur 触发校验。 |
| `check: visible` / `hidden` | `agent-browser is visible <selector>`；隐藏断言按可见元素数为 0，避免隐藏重复 DOM 误判。 |
| `check: enabled` / `disabled` | `agent-browser is enabled <selector>`；`disabled` = enabled 为 false 或原生 disabled。 |
| `check: attr` | `agent-browser get attr <name> <selector>` 或 `agent-browser eval` 有界轮询。 |
| `check: count` | `agent-browser get count <selector>`；仅用于确定性 DOM 数量，不断搜索结果/生成内容。 |
| `check: text` | `agent-browser get text <selector>` 后正则匹配信封类文本。 |
| `do: hover` | `agent-browser hover <selector>`（本次 fileprocessing 未用到，命令面已确认存在）。 |
| `do: wait` | `agent-browser wait <selector>` 或 `agent-browser wait <ms>`；优先 selector 可见等待。 |
| `do: pick-model` | 打开 KnowledgeModelSelect 后按 `${secrets.*ModelId}` 对应可见项点击（fileprocessing 未用到，保留待 knowledge compile 复核）。 |
| `do: shell osascript: pick-file` | **OS 逃生口**：macOS `osascript` 驱动原生「打开」框，`Cmd+Shift+G` 输 fixture 绝对路径（agent-browser 驱不动原生 picker）。 |

## 约束（同 cherry-pr-test）

- 启动前先 kill 残留；测试后不留 debug 进程；切过分支要切回默认分支。
- golden profile = zh-CN；关键状态/列表/分块断言走 `data-*`（locale 无关），文本锚点写 case `locale` 的 i18n key。
- `.compiled/` 进 repo；自愈产生的临时定位**不**自动写回——漂移交人确认。

## 现状 / 待办

- ✅ knowledge light（L1-L4）+ medium（M1-M5/M7）已 live 验证并编码（M6 暂缓，依赖 `packages/ui` 2B）。
- ✅ **DSL → agent-browser 绑定表**已于 fileprocessing 首跑 compile 回填（见「DSL → agent-browser 绑定」节）。
- ✅ fileprocessing（8）+ websearch（9）`.compiled/<id>.json` 已由首跑 compile 产出入 repo；knowledge 待首跑产出。
- ⏳ 飞书 IM 卡片 / Base 台账 / 失败 Doc 的具体模板对齐 bridge 输出格式。
