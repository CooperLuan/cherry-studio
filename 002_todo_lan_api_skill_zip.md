# 002 TODO: 局域网 API 绑定与 Cherry 知识库 Skill zip 分发

- [002 TODO: 局域网 API 绑定与 Cherry 知识库 Skill zip 分发](#002-todo-局域网-api-绑定与-cherry-知识库-skill-zip-分发)
  - [结论](#结论)
  - [API Server 是否可以绑定 `0.0.0.0`](#api-server-是否可以绑定-0000)
  - [局域网安全风险](#局域网安全风险)
  - [能否把知识库封装成 Skill zip 给局域网其他机器使用](#能否把知识库封装成-skill-zip-给局域网其他机器使用)
  - [Skill zip 的推荐结构](#skill-zip-的推荐结构)
  - [Skill zip 的使用体验](#skill-zip-的使用体验)
  - [Skill zip 的限制](#skill-zip-的限制)
  - [推荐落地顺序](#推荐落地顺序)

## 结论

可以做。`0.0.0.0` 绑定和 Skill zip 分发应独立于 `001_todo_knowledge_base_directory_api.md` 推进：`001` 专注知识库目录增删、刷新、单文件更新；本文件专注让局域网其他机器访问 Cherry Studio API，并用 Skill zip 封装远程知识库查询工作流。

推荐原则：

- API Server 绑定 `0.0.0.0` 是“网络暴露能力”，需要单独的 UI 开关、安全提示和权限策略。
- Skill zip 应封装“远程查询 Cherry 知识库 API 的流程和脚本”，不应打包 Cherry 的向量库本体。
- 第一版 Skill 只做只读查询；添加目录、刷新目录、刷新单文件等写操作等 `001` 的正式 API 就绪后再扩展。

## API Server 是否可以绑定 `0.0.0.0`

可以。当前后端已经是按配置里的 `host` 调用 Node HTTP server：

```ts
this.server!.listen(port, host, () => {
  logger.info('API server started', { host, port })
})
```

相关位置：

- `src/main/apiServer/server.ts`
- `src/main/apiServer/config.ts`
- `packages/shared/config/constant.ts`
- `src/renderer/src/store/settings.ts`

当前默认值是：

```ts
export const API_SERVER_DEFAULTS = {
  HOST: '127.0.0.1',
  PORT: 23333
}
```

因此当前状态是：

- 后端能力：支持从配置读取 host，并绑定到指定 host。
- 默认行为：只绑定 `127.0.0.1`，只能本机访问。
- UI 状态：API Server 设置页目前只暴露端口和 API key，未暴露 host 输入框。

要正式支持局域网访问，建议补以下改动：

- 在 `src/renderer/src/store/settings.ts` 增加 `setApiServerHost` reducer。
- 在 `src/renderer/src/pages/settings/ToolSettings/ApiServerSettings/ApiServerSettings.tsx` 增加 host 输入框。
- 允许输入：
  - `127.0.0.1`：仅本机；
  - `0.0.0.0`：监听所有网卡；
  - 具体 LAN IP，例如 `192.168.2.10`：只监听指定网卡。
- API Server 正在运行时禁止修改 host，提示需要重启。
- 文档和 UI 显示要区分：
  - bind host：`0.0.0.0`
  - client URL：`http://<这台机器的局域网 IP>:23333`

注意：客户端不要访问 `http://0.0.0.0:23333`；`0.0.0.0` 是监听地址，不是远端访问地址。局域网内其他机器应访问服务端机器的真实 IP，例如：

```text
http://192.168.2.10:23333/v1/knowledge-bases/search
```

还需要：

- Windows 防火墙放行端口 `23333` 或用户自定义端口；
- 路由器/AP 未开启客户端隔离；
- 继续使用 `Authorization: Bearer <api-key>`；
- 不建议暴露到公网，除非前面有 Tailscale/ZeroTier/VPN/反向代理鉴权。

## 局域网安全风险

绑定 `0.0.0.0` 之后，Cherry Studio API Server 的所有已挂载接口都会对局域网可达，不只是知识库搜索。

当前 `/v1` 下已有：

- chat
- messages
- models
- mcps
- agents
- channels
- tasks
- claw
- knowledge-bases

因此如果目标只是共享知识库，建议进一步做“只读知识库共享模式”：

- 增加 `apiServer.allowLanAccess` 显式开关；
- 增加 `apiServer.lanMode = 'full' | 'knowledge-readonly'`；
- `knowledge-readonly` 模式只开放：
  - `GET /v1/knowledge-bases`
  - `GET /v1/knowledge-bases/:id`
  - `POST /v1/knowledge-bases/search`
- 对写接口、MCP、agents、chat completion 等接口继续限制本机或要求更高权限。

如果不做权限分层，至少要在 UI 上给强提醒：局域网内拿到 API key 的机器可以调用完整 API。

## 能否把知识库封装成 Skill zip 给局域网其他机器使用

可以，但推荐封装的是“远程查询这个知识库的 Skill”，不是把知识库向量数据库本体打包进 Skill。

Skill 负责：

1. 读取用户机器上的配置：
   - `CHERRY_KB_API_BASE=http://192.168.2.10:23333`
   - `CHERRY_KB_API_KEY=cs-sk-...`
   - `CHERRY_KB_IDS=YeQe0FgTB4IdThYFGtDO7,...`
2. 调用：

```http
POST /v1/knowledge-bases/search
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "query": "...",
  "knowledge_base_ids": ["..."],
  "document_count": 5
}
```

3. 把返回结果整理为引用材料，供 agent 回答用户问题。

Skill zip 不应包含：

- Cherry Studio 的 `Data/KnowledgeBase/*` 向量库文件；
- API key 明文；
- 用户原始知识库全文，除非用户明确就是要离线分发静态资料。

原因：

- 当前知识库元数据仍依赖 Cherry Studio 的 Redux/配置和 embedding provider；
- 向量库文件直接拷贝到另一台机器不能保证模型、维度、provider、路径 metadata 全部一致；
- Skill 的优势是封装流程、脚本、API 调用约定，而不是替代知识库服务。

## Skill zip 的推荐结构

推荐形态：

```text
cherry-lan-knowledge/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
│   └── query_cherry_knowledge.py
└── references/
    └── api.md
```

`SKILL.md` 负责告诉 agent：

- 什么时候使用这个 Skill；
- 如何读取配置；
- 如何调用查询脚本；
- 如何把结果作为引用材料回答。

`scripts/query_cherry_knowledge.py` 负责：

- 读取环境变量或本地配置；
- 发起 HTTP 请求；
- 处理错误，例如 401、503、网络不可达；
- 输出结构化 JSON 或 Markdown 片段。

`references/api.md` 负责：

- 记录 Cherry Studio API 地址；
- 记录请求/响应格式；
- 记录常见错误排查。

## Skill zip 的使用体验

局域网其他机器安装 Skill zip 后，可以这样使用：

```text
使用 cherry-lan-knowledge 查一下：津津有味里有没有提到低碳饮食？
```

Skill 内部步骤：

1. 检查环境变量或本地 config；
2. 调 Cherry Studio API；
3. 展示命中的知识库片段和来源；
4. 基于片段回答。

## Skill zip 的限制

- 只要服务端 Cherry Studio 没开、API Server 没启动、电脑睡眠、IP 变化，Skill 就不可用。
- 现有知识库 search API 仍依赖主窗口/Redux 可用；若主窗口不可用可能返回 503。
- 如果要让 Skill 支持“添加目录、刷新目录、刷新单文件”，还要先实现 `001_todo_knowledge_base_directory_api.md` 规划的写接口。
- 多人共用同一个 API key 风险较高，最好后续做 scoped token：
  - `knowledge:read`
  - `knowledge:write`
  - `chat:read`
  - `chat:write`

## 推荐落地顺序

- [ ] 第一阶段：只做 `0.0.0.0` host UI + 防火墙/安全提示。
- [ ] 第二阶段：验证局域网机器能调用现有 search API。
- [ ] 第三阶段：制作 `cherry-lan-knowledge` Skill zip，只支持只读查询。
- [ ] 第四阶段：等 `001_todo_knowledge_base_directory_api.md` 的目录 add/refresh API 就绪。
- [ ] 第五阶段：把 Skill 扩展为可触发目录刷新或单文件刷新。
