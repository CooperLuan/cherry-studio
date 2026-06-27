# e2e-agent — runner & case format（框架契约 · 草案）

> 项目级 agent-browser E2E 框架。**执行后端 = agent-browser**（测试机上由 Codex 驱动），**断言确定性、B 模式重放**。
> 本文是 runner/YAML 的**格式契约草案**；可执行的 `e2e-run` skill 待 schema 确认 + 对齐 agent-browser 命令面后实现。
> 域 spec（人读 SoT、逐 case live 校准）见各域目录，如 [`knowledge/light-medium.md`](knowledge/light-medium.md)。

## 1. 目录布局

```
tests/e2e-agent/
  README.md                       # 本文：框架契约
  <domain>/                       # 一个 feature 一个域，如 knowledge/
    <spec>.md                     # 人读 spec（SoT，带 live 验证记录）
    cases/<tier>/<id>.yaml        # 机器可读用例（authoring）
    .compiled/<id>.json           # runner 首跑产出的确定性重放产物（进 repo）
```

- **tier 累积**：`run medium` = light ⊂ medium 全跑；`run full` 含全部。
- **case 归属 tier** 由 `tier:` 字段决定，**不靠目录**（目录仅方便浏览）。
- `.compiled/` **进 repo**（架构定）：重放只读它、无 LLM。

## 2. Case YAML schema

```yaml
id: kb-l1-create-kb            # 全局唯一，<domain>-<tier>-<slug>
title: 创建知识库（含离线校验）
tier: light                    # light | medium | full
domain: knowledge
locale: zh-CN                  # 文本断言按此 locale 解析 i18n key
live: [embedding-key]          # [] | embedding-key | network —— 标注碰真实后端的步骤
prereqs: [golden-profile, no-existing-kb]   # 命名前置（见 §4）
fixtures: [sample-md]          # 命名 fixture（见 §4）
after: kb-l1-create-kb         # 可选：继承该 case 跑完后的 App 状态（同一 run 内顺序链，如 L1→L2→L3）

steps:
  - do: <verb>  ...            # 动作
  - check: <verb>  ...         # 断言（确定性 gate）
```

### 2.1 选择器 DSL（`by:`）

| 形式 | 含义 | 稳定度 |
|---|---|---|
| `{ testid: kb-item-row }` | `[data-testid=...]` | 最稳（locale 无关） |
| `{ attr: { data-status: completed }, testid: kb-item-row }` | 属性匹配 | 最稳 |
| `{ id: knowledge-create-name }` | `#id` | 稳 |
| `{ aria: Add }` / `{ aria-i18n: knowledge.embedding_model }` | aria-label（字面 / i18n 解析） | 稳 |
| `{ placeholder-i18n: knowledge.recall.placeholder }` | 按 `placeholder` 属性（i18n 解析）定位输入框 | 稳（输入框无 id 时） |
| `{ role: menuitem, i18n: knowledge.context.rename }` | role + 文本 | 中 |
| `{ i18n: knowledge.empty }` | 按 i18n key 解析成 `locale` 文本再匹配 | locale 依赖（**优先 testid**） |
| `{ submit: dialog }` | 当前对话框的 `button[type=submit]` | 稳 |
| `{ field-i18n: knowledge.rag.chunk_size }` | label(i18n) 关联的表单控件（input/slider/select） | 稳 |
| `{ within: { testid: … }, role: listitem, has-text: "name" }` | 容器内按 role + 文本定位（`within:` 可裹任意选择器，含 `has-attr`） | 中 |
| `{ has-attr: data-recall-history }` / `{ has-attr: "data-lucide=check" }` | 含该属性 `[attr]`，或属性等值 `[attr=value]` | 稳 |
| `{ class: bg-secondary }` / `{ role: heading, has-text: "name" }` | Tailwind 原子类模糊匹配 / 角色 + 文本（无 testid 时退路） | 弱（**优先 testid**） |

> **locale 规则**：作者写 **i18n key**，runner 按 case 的 `locale` 解析成实际文本。关键状态/列表/分块断言走 `testid`+`attr`（locale 无关）。

### 2.2 `do:` 动作

| verb | 字段 | 说明 |
|---|---|---|
| `goto` | `nav: knowledge` | 点侧边栏导航（非 URL） |
| `click` | `by:` | 点击 |
| `type` | `by:`, `text:` | **替换**字段内容（非追加；`text: ""` 清空）；可含 `${...}` 插值 |
| `select` | `by:`, `option:` | 下拉选项（按内部值，如 searchMode `vector`/`hybrid`/`bm25`） |
| `pick-model` | `by:`, `model:` | KnowledgeModelSelect 选模型（`${secrets.embeddingModelId}`） |
| `hover` | `by:` | 悬停（露出 hover-only 控件） |
| `press` | `keys: Escape` | 键盘 |
| `shell` | `osascript: pick-file`, ... | **OS 级逃生口**（agent-browser 驱动不了原生框时，如 file 源 native picker）；macOS-only，重放时原样执行 |
| `wait` | `by:`, `timeout:` | 显式等待（替代 sleep） |

### 2.3 `check:` 断言（gate）

| verb | 字段 | 说明 |
|---|---|---|
| `visible` / `hidden` | `by:` | 元素在/不在 |
| `enabled` / `disabled` | `by:` | 按钮态 |
| `attr` | `by:`, `attr:`, `equals:`, `timeout?:` | 属性等值（如 `data-status=completed`，可带有界轮询） |
| `count` | `by:`, `equals:` / `min:` | 元素数量（如 `kb-item-row` ≥1 / =2） |
| `text` | `by:`, `matches:` | 文本/正则（信封类，如 `\d+ 结果`） |
| `no-modal` | `dialog?:` | 断言无对话框（如旧 M2，已废） |

**红线**：`check:` 只能是确定性事实。**禁止**断言召回排序/分数/命中内容/生成文本（→ full 非 gating 观测）。碰 `live` 的只断终态/信封。

**步级可选**：`intent:`（语义说明，自愈时给 LLM）、`skip-if-absent: <ref>`（引用的 secret / prereq / 命名条件不存在或不满足则跳过该步——如 rerank 模型 `secrets.rerankModelId`、可选 testid `kb-base-row`、内容相关条件 `result-card-expandable`）。

## 3. 生命周期：compile → replay → self-heal（B 模式）

1. **首跑（compile）**：runner 按 `steps` 驱动 agent-browser；逐步把 `by:` 解析成**实际定位结果 + 截图**写入 `.compiled/<id>.json`；`check:` 记录通过基线。
2. **重放（replay）**：直接执行 `.compiled` 的已解析定位，**无 LLM**、确定性。`check` 失败 / 定位丢失 → 进自愈。
3. **自愈（self-heal）**：从该步的语义（`do`/`intent` + `by`）让 LLM **重新解析定位**，**临时**用 + **报告漂移**，**不自动提交 `.compiled`**（漂移交人确认，对齐架构）。

`.compiled/<id>.json`（形态草案）：`{ id, compiledAt, locale, steps:[{ index, resolved:{selector,screenshot}, ok }], checks:[...] }`。

## 4. 前置 / fixtures / secrets（repo 外引用）

真值只存 **repo 外** `~/.cherry-e2e/secrets.local.json`；repo 内只放脱敏模板 [`secrets.example.json`](secrets.example.json)（**禁止 commit 真 key / 内部域名 / 绝对路径**）。配置一份、可切 provider、命名对齐 YAML 引用：

```jsonc
{
  "activeProvider": "ollama",                  // 切 provider 只改这一行
  "providers": {                               // provider 档案库（每个一套 key/baseUrl/模型 id）
    "ollama": {
      "apiKey": "", "baseUrl": "http://127.0.0.1:11434",
      "embeddingModelId": "ollama::qwen3-embedding:0.6b",
      "secondEmbeddingModelId": "ollama::bge-m3:latest",
      "rerankModelId": null                    // null = 无 → 依赖它的步骤 skip-if-absent
    }
    /* 其余 provider 同形，见 secrets.example.json */
  },
  "fixtures": {                                // 命名 → 绝对路径 或 字符串值
    "sample-md": "/abs/.../e2e/sample.md",
    "dupe-a": "/abs/.../e2e/dupe/a/report.md",
    "dupe-b": "/abs/.../e2e/dupe/b/report.md",
    "recall-query": "<sample.md 的已知字面子串>",
    "seed-note": "/abs/.../e2e/notes/e2e-seed-note.md"
  }
}
```

- **解析规则（runner / agent 必须照此取值）**：`${secrets.<key>}` → `providers[activeProvider].<key>`；`${fixtures.<key>}` → `fixtures.<key>`（绝对路径或字符串）。**值为 `null` 或缺失** → 引用它的步骤按 `skip-if-absent` 跳过（如 `rerankModelId`→M4 rerank 子断言）。
- **secrets key（per provider）**：`apiKey` / `baseUrl` / `embeddingModelId`(L1) / `secondEmbeddingModelId`(M3 文案切换) / `rerankModelId`(M4,可选)。`two-embedding-models` 前置 = 该 provider 同时有前两个 embedding id。
- **fixtures**：`sample-md`(L2/L3) / `dupe-a`+`dupe-b`(M2,**同 basename 异目录**) / `recall-query`(M5,字符串=sample.md 字面子串) / `seed-note`(M1)。
- **prereqs**（非 local.json，由 harness 置 app 态）：`golden-profile`(老用户+key,zh-CN；真身 `~/.cherry-e2e/golden-profileDev`，dev 强制 `Dev` 后缀 → per-run 复制到 `<base>Dev`、启动传 `<base>`)、`no-existing-kb`、`completed-base`、`no-existing-group`、`notes-seeded`(`feature.notes.path` 指 seed 目录 + plain `.md`)、`notes-empty`、`two-embedding-models`、`rerank-model`(可选)。

## 5. 触发与输出（对齐架构）

- 触发：飞书 IM `run <tier> [domain] [on <分支/PR>]` → bridge → Codex + `e2e-run` skill。`run <tier> <domain>` 选 `tier:⊆请求tier ∧ domain:==请求domain` 的 case。
- 输出：全绿 → IM 卡片 + Base 台账；有失败 → 另写飞书 Doc（复现+逐步截图+诊断+[full]根因）。

## 6. 待实现 / 开放

- **`e2e-run` skill 实现**：需对齐 **agent-browser 实际命令面**（§2.2/2.3 verb → agent-browser 原语），在测试机侧落地。
- **自愈范围**：仅重解析定位 vs 重排步骤——倾向**仅定位**（步骤改动交人）。
- **`.compiled` 截图基线**用途：仅诊断附件，还是参与视觉回归（v1 不做视觉 gate）。
- 现状：
  - **knowledge**：11 个 light/medium case 已 live 验证并编码（light L1-L4 · medium M1-M5/M7；M6 暂缓，依赖 2B/`packages/ui`）。
  - **websearch**：9 个 light/medium case 已 live 校准并编码并跑通（light L1-L4 · medium M1-M5；首跑 8 PASS，M5 首版 disabled-gate 因 golden 活动模型支持 web search 而 FAIL→已转向 enable/disable toggle，待复跑；删除 CRUD/disabled-state/真实搜索 推 full M2b/M5c/M6）。见 [`websearch/light-medium.md`](websearch/light-medium.md)。
  - **fileprocessing（文档解析）**：8 个 light/medium case 已 live 校准并编码（light L1-L4 · medium M1-M4；设置页配置面，真实转换 renderer 不可见→推 full；M2 弹窗快照不重渲染→只测 add+空值拒绝+cancel，真实 CRUD 推 full M2b）。见 [`fileprocessing/light-medium.md`](fileprocessing/light-medium.md)。
  - `.compiled/` 待测试机首跑 compile 后回填（各域皆是）。
