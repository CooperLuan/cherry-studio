---
name: e2e-run
description: Run the project's deterministic agent-browser E2E cases (tests/e2e-agent) in B-mode — compile on first run, then LLM-free replay with self-heal-on-drift. Use when triggered by Feishu IM `run <tier> [domain] [on <ref>]` (via lark-channel-bridge → Codex) to gate a branch/PR, or when asked to run/replay an e2e-agent tier locally on the test machine.
---

# e2e-run — deterministic agent-browser E2E runner（草案 / scaffold）

> **状态**：YAML 契约（[`tests/e2e-agent/README.md`](../../../tests/e2e-agent/README.md)）+ light/medium 用例已 live 验证并编码。
> 本 skill 是**执行契约草案**——把 §2 的 DSL verb 落到 **agent-browser 实际命令面**这一步，由测试机在首次接入时确认并回填 `## DSL → agent-browser 绑定`。绑定确认前，本 skill 以**带人确认的半自动**方式跑（每个 `do`/`check` 由 agent 解释执行 + 截图）。

## 触发与参数

- **来源**：飞书 IM `run <tier> [domain] [on <branch|PR>]` → lark-channel-bridge（哑管道）→ spawn Codex + 本 skill。
- `$ARGUMENTS`：
  - `tier`（必填）：`light` | `medium` | `full`
  - `domain`（可选）：如 `knowledge`；缺省 = 该 tier 全域
  - `on <ref>`（可选）：分支名 / PR 号 / `HEAD`；缺省 = 当前 checkout

**选例规则**：跑某 tier = 跑所有 `tier:` ⊆ 请求 tier 的 case（**层累积**：medium 必含 light）。带 domain 再 `∧ domain == 请求 domain`。case 的 tier 由 YAML `tier:` 字段决定，**不靠目录**。

## 前置（测试机 harness 提供）

- `agent-browser` 已装；`pnpm install` 完成；mise/Node ≥22。
- **golden profile**（repo 外）：老用户 + 可用 embedding provider/key + zh-CN locale，作 light/medium 默认起点。
- **secrets / fixtures**：`~/.cherry-e2e/secrets.local.json`（repo 外，脱敏模板见 repo 内 `tests/e2e-agent/secrets.example.json`）。**取值规则**：`${secrets.<key>}` → `providers[activeProvider].<key>`（如 `${secrets.embeddingModelId}` 取当前 `activeProvider` 档案的 embedding id）；`${fixtures.<key>}` → `fixtures.<key>`（绝对路径或字符串）。**值 `null`/缺失** → 引用它的步骤按 `skip-if-absent` 跳过（如 `rerankModelId`）。**切 provider 只改 `activeProvider`**。
- **prereqs**：`golden-profile` / `completed-base` / `notes-seeded` / `no-existing-group` … 由 harness 在每 case 前置满足（详见 README §4 + 域 spec）。

## 工作流

### Phase 0 — 解析请求 + 选例

1. 解析 `tier`/`domain`/`on`。
2. `on <ref>` 给定 → checkout（`gh pr checkout <N>` 或 `git checkout <branch>`）；否则用当前 checkout。
3. glob `tests/e2e-agent/<domain>/cases/**/*.yaml`，按 `tier:`/`domain:` 字段过滤选例，按 `after:` 链拓扑排序（无 `after` 的先跑；`after` 形成同 run 内的状态继承链，如 L1→L2→L3）。
4. 校验每 case 的 `prereqs`/`fixtures`/`secrets` 在 harness 配置里可解析；缺 live secret 且 case 带 `live:` → 标 **blocked**（不算 fail），写入报告。

### Phase 1 — 启动 App + 连 agent-browser

复用 [`cherry-pr-test`](../cherry-pr-test/SKILL.md) 的 Launch/Connect 流程：

1. kill 残留 Cherry/electron-vite/9222/5173。
2. `nohup pnpm debug > /tmp/cherry-debug.log 2>&1 &`，轮询 9222 LISTEN（≤30s）。
3. `agent-browser connect 9222` → `agent-browser tab` 选 `localhost:5173` 主页（避开 webview target）。
4. 处理首启场景（v2 迁移向导 / splash），落到主 UI。

### Phase 2 — 逐 case：满足前置 → compile / replay → 自愈

每个 case：

1. **置前置**：按 `prereqs` 让 harness 把 App 带到起点（建库、seed 笔记、清分组…）；继承 `after` 链上一 case 的态。
2. **compile（首跑或无 `.compiled`）**：按 `steps` 顺序驱动 agent-browser；逐步把 `by:` 解析成实际定位 + 截图，写 `tests/e2e-agent/<domain>/.compiled/<id>.json`；`check:` 记基线。
3. **replay（有 `.compiled`）**：直接执行已解析定位，**无 LLM**、确定性。`check` 失败 / 定位丢失 → 自愈。
4. **self-heal**：从该步语义（`do`/`intent` + `by`）让 LLM **重解析定位**，**临时**用 + **报告漂移**，**不自动改 `.compiled`**（漂移交人确认）。
5. `skip-if-absent: <ref>` 引用不满足 → 跳过该步（如无 rerank 模型）；记为 skipped 非 fail。

**红线（来自架构）**：`check:` 只能是确定性事实——DOM 在/不在、enabled/disabled、属性等值、count、文本信封。**禁止**断言召回排序/分数/命中内容/生成文本（→ full 非 gating 观测）。碰 `live:` 的步骤只断终态/信封（`data-status=completed`、摘要出现、对话框关闭）。

### Phase 3 — 清理

kill 全部 Cherry 进程；`on <ref>` 切过分支则切回默认分支（见 cherry-pr-test Phase 6）。**绝不**留 debug 进程。

### Phase 4 — 汇报（对齐架构）

- **全绿** → 飞书 IM 卡片 + Base 台账（tier/domain/ref/通过数/耗时）。
- **有失败** → 另写飞书 Doc：复现步骤 + 逐步截图 + 诊断 + 漂移项；`full` 失败附根因。
- **blocked/skipped** 单列，不计入 pass/fail，但在卡片注明。

## DSL → agent-browser 绑定（**待测试机确认后回填**）

`do`/`check` verb（README §2.2/2.3）→ agent-browser 原语的映射。下表为**待确认占位**，测试机首次接入时按实际命令面校正：

| DSL | 预期 agent-browser 形态（占位） |
|---|---|
| `by: {testid}` / `{id}` / `{aria}` / `{role+i18n}` | `snapshot -i` 选元素 / CSS / role 查询（i18n key 先按 case `locale` 解析成文本） |
| `do: click` / `type` / `hover` / `press` | 对应交互原语；`type` = 清空后填（非追加） |
| `do: select` | 下拉选 option（按内部值 `vector`/`hybrid`/`bm25`） |
| `do: pick-model` | 打开 KnowledgeModelSelect → 按 `${secrets.*ModelId}` 选 |
| `do: shell osascript: pick-file` | **OS 逃生口**：macOS `osascript` 驱动原生「打开」框，`Cmd+Shift+G` 输 fixture 绝对路径（agent-browser 驱不动原生 picker） |
| `do: wait` | 显式等待（`by:` 可见 / `timeout`），替代 sleep |
| `check: visible/hidden/enabled/disabled` | DOM 存在性 / `disabled` 属性 |
| `check: attr` | `agent-browser eval` 读属性等值（如 `data-status`），可带有界轮询 `timeout` |
| `check: count` | 计 `[data-testid=…]` 数量（`equals` / `min`） |
| `check: text` | 正则匹配（信封类，如 `\d+ 结果`） |

> 绑定确认前：本 skill 对每步以 `snapshot -i` 发现元素 + 解释执行 + 截图的方式半自动跑，人确认 gate。确认后把上表替换为真实命令并标注「已绑定」。

## 约束（同 cherry-pr-test）

- 启动前先 kill 残留；测试后不留 debug 进程；切过分支要切回默认分支。
- golden profile = zh-CN；关键状态/列表/分块断言走 `data-*`（locale 无关），文本锚点写 case `locale` 的 i18n key。
- `.compiled/` 进 repo；自愈产生的临时定位**不**自动写回——漂移交人确认。

## 现状 / 待办

- ✅ knowledge light（L1-L4）+ medium（M1-M5/M7）已 live 验证并编码（M6 暂缓，依赖 `packages/ui` 2B）。
- ⏳ **DSL → agent-browser 绑定表**待测试机首次接入回填。
- ⏳ `.compiled/<id>.json` 由首跑 compile 产出后入 repo。
- ⏳ 飞书 IM 卡片 / Base 台账 / 失败 Doc 的具体模板对齐 bridge 输出格式。
