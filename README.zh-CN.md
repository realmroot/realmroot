<p align="center">
  <img src="assets/logo.png" alt="Realmroot 标志" width="132" height="132" />
</p>

<h1 align="center">Realmroot</h1>

<p align="center">
  <strong>让每个 API，都能为 Agent 所用。</strong>
</p>

<p align="center">
  Realmroot 将现有 OpenAPI 服务转化为 Agent 可安全发现和调用的工具，
  无需每个资源服务器单独开发和长期维护 Agent 集成。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/saltbo/realmroot/actions/workflows/ci.yaml"><img src="https://github.com/saltbo/realmroot/actions/workflows/ci.yaml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/saltbo/realmroot.svg" alt="许可证" /></a>
  <a href="https://codecov.io/gh/saltbo/realmroot"><img src="https://codecov.io/gh/saltbo/realmroot/branch/main/graph/badge.svg" alt="覆盖率" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D24-339933.svg" alt="Node >=24" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/TypeScript-6.x-3178c6.svg" alt="TypeScript 6.x" /></a>
</p>

## 让互联网已有的能力被 Agent 使用

互联网已经积累了数十年的 API。现在缺少的不是把每个 API 再实现一遍，
而是一种可靠的方法，让 Agent 能够发现正确的能力、获得完成任务所需的精确权限，
并调用原有服务。

专门开发的 MCP Server 和自定义 CLI 适合具有特殊交互模型的工具。但如果要求每个
资源服务器都提供一套，就会产生第二个集成面和没有尽头的维护成本：API 与工具定义
可能漂移，安全修复需要重复实施，每种 Agent Runtime 还需要新的适配器。

Realmroot 选择一条可复用的路径：

1. 资源服务器维护自己的 API、OpenAPI 文档和权限执行逻辑。
2. Realmroot 注册并暴露资源，负责 Agent 身份和委托授权。
3. Restish 将 OpenAPI 契约转化为通用 CLI 操作。
4. Realmroot Skill 教会 Agent 如何发现、申请和调用这些操作。

资源服务器不需要为 Agent 设计一套专用 API。Realmroot 接入的资源服务器越多，
Agent 可以使用的工具就越丰富。

## 两层价值

### Agent 工具平面

Realmroot 帮助 Agent 解决两个基础问题：**工具发现**和**工具调用**。

- 将已注册的私有 API 发现为能力，而不是为每个服务预装专用集成；
- 检查服务当前的 OpenAPI 契约，而不是依赖复制出来的工具定义；
- 只申请当前任务所需的资源和 scope；
- 通过 Restish 将 API 作为通用、可组合的 CLI 使用；
- 使用短期凭证直接调用资源服务器。

### 身份与信任基础设施

Realmroot 同时是一套完整、可独立部署的产品身份根：

- 一个用户池、Issuer、客户端注册表、管理边界和安全策略；
- 托管的登录、注册、恢复、同意、MFA、Passkey 和会话流程；
- 面向 Public、Native 和 Confidential 应用的 OIDC/OAuth 集成；
- 面向用户的 Account Center 和面向运营者的 Admin Console；
- 稳定的 Agent 身份、控制者关系、委托授权、撤销和审计上下文。

即使没有 Agent，这一层也有独立价值：产品不必反复实现认证流程、身份数据表、
应用客户端、账户管理和后台控制。对 Agent 工作负载而言，它还提供了回答
“谁控制这个 Agent”以及“它可以申请什么权限”所必需的人、组织、应用和策略边界。

没有身份的工具不安全；没有可用能力的身份也无法完成 Agent 的任务。Realmroot 将
这两层连接起来，同时把最终业务权限判定留在它本来就应该存在的地方：资源服务器内部。

阅读[完整价值说明](docs/product/value-proposition.md)，了解产品主张、责任边界以及
Realmroot 为各参与方创造的价值。

## 从 OpenAPI 到 Agent 工具

```text
资源服务器
  稳定 API + OpenAPI + 本地权限执行
                    │
                    ▼
Realmroot
  资源发现 + Agent 身份 + 委托授权
                    │
                    ▼
Restish + Realmroot Skill
  通用 CLI 操作 + Agent 操作方法
                    │
                    ▼
Agent
  广泛发现 → 精确授权 → 直接调用
```

Realmroot 不是 HTTP 代理，也不替代资源服务器的授权逻辑。资源服务器在 OpenAPI 中
定义 scope，将 scope 映射到操作，并作出最终的允许或拒绝决定。Realmroot 识别这些
scope、取得控制者批准、在适合时将 scope 组织成角色，并把最终权限签发到 Token 中，
或者与外部授权服务器协调完成签发。

这样可以避免建立一个会逐渐偏离 API 代码的中心化权限目录。详细的所有权模型请参阅
[授权边界](docs/architecture/authorization-boundaries.md)。

## 广泛发现，精确授权，直接调用

Agent 可以检查资源目录，但不会因此获得业务权限。选定操作后，Realmroot 根据该资源
当前的 OpenAPI 文档确定可申请的 scope。控制者会检查 Agent、资源、账户、用途、
精确 scope 和授权有效期。

注册只建立身份，不授予权限。Realmroot 将两种批准边界彼此分开：

- **Realmroot 管理能力**允许 Agent 操作 Realmroot 自身 Resource API 中的特定资源；
- **API Resource Grant**允许 Agent 使用精确的 scope 集调用一个受保护的业务 API。

控制者的浏览器会话只负责作出决定，不会成为 Agent 的 CLI Principal。角色可以对
scope 分组并约束申请资格，但不会产生隐式权限。一次性、限时、长期、过期和已撤销的
Grant 都具有明确的生命周期语义和审计上下文。

## 稳定的 Agent 身份与委托访问

Agent 注册一次后会获得不可变的 `(issuer, subject)` 身份。这个身份与它的 Host、
Runtime 会话、API Profile 和密钥相互独立。控制者可以绑定替代 Host，或撤销一个
被攻破的 Host，而无需改变 Agent Subject，也不会影响其他 Host。

资源服务器在 RFC 8693 `act` Claim 中看到的是稳定 Agent，而不是发起请求的运行环境。
公开的 AgentInfo 只提供可缓存的展示信息，永远不参与授权。

Realmroot 用同一套申请、批准、撤销和审计模型支持两种资源边界：

| | Native API Resource | External API Resource |
| --- | --- | --- |
| Token Issuer | Realmroot | 目标平台 |
| 用户资源 | Realmroot 用户或组织 Home Space | 已连接的目标账户 |
| 向 Agent 暴露用户 Refresh Credential | 永不 | 永不 |
| 最终凭证 | 五分钟有效的 Realmroot `at+jwt` | 目标平台签发的短期 DPoP Token |
| Subject | 个人所有者或组织 Home Space | 已连接的目标用户 |
| Actor | 稳定 Agent | 稳定 Agent |

Native 资源信任 Realmroot 的 Issuer 和 JWKS。External 资源继续拥有自己的用户、
OAuth Server、Token 和 Consent。Realmroot 保护已连接用户的 Refresh Credential，
通过标准的 PKCE、JWT Bearer、Token Exchange 和 DPoP 流程获得范围明确的委托访问。

Restish Adapter 会为每个 Resource Grant 创建独立的 P-256 DPoP 密钥，在受保护的本地
状态中保存短期 Token，并从命令输出中移除原始 Token。随后 Agent 直接调用资源 URL。
资源服务器负责验证 Issuer、Audience、Scope、有效期、密钥绑定、请求证明和重放保护。

[Agent 访问指南](docs/guides/agent-access.md)和
[Agent 身份架构](docs/architecture/agent-identity.md)说明了完整生命周期和信任模型。

## 资源服务器需要做什么

要让一个 API 可供 Agent 使用，资源服务器只需继续拥有并维护正常的 API 契约和
授权边界：

1. 维护一个稳定的受保护资源 URL；
2. 通过 RFC 8631 `service-desc` Link 从该 URL 暴露 OpenAPI 3.x 文档；
3. 使用标准 OpenAPI Security Requirement 声明操作所需 scope；
4. 验证签发的 Token 并在本地执行权限判定；
5. 将资源以 `native` 或 `external` 类型注册到 Realmroot。

当 API 信任 Realmroot 作为授权服务器时选择 `native`；当目标平台拥有自己的用户和
OAuth Server 时选择 `external`。两种方式都不需要维护 Agent 专用 Endpoint 或
针对不同 Runtime 的适配器。

完整协议和验证清单位于[资源服务器集成](docs/integrations/resource-servers.md)。可运行的
[Native 示例](examples/native-resource-server/README.md)和
[External 示例](examples/external-resource-server/README.md)分别实现了端到端流程。

如需设计或审查面向资源的 OpenAPI 契约，请安装配套 Skill：

```bash
npx skills add realmroot/realmroot -g --skill design-resource-api
```

然后向它提供 API 需求或现有 OpenAPI 契约：

```text
Use $design-resource-api to model this API as resources, produce its OpenAPI
contract, and justify any exceptional generated commands.
```

## Agent 快速开始

为需要使用 Realmroot 的 Agent Runtime 全局安装 Skill：

```bash
npx skills add realmroot/realmroot -g --skill realmroot
```

Codex 的非交互式安装命令：

```bash
npx skills add realmroot/realmroot -g --skill realmroot --agent codex -y
```

检查安装来源和 Scope：

```bash
npx skills list -g
```

然后给 Agent 一个目标：

```text
使用 Realmroot 发现并调用完成这个任务所需的私有 API 能力。
```

第一次执行受保护操作时，Restish Adapter 会打开托管的注册或批准页面。控制者批准后，
原操作会继续以 Agent 身份执行。发现、授权和 Token 签发都是中间步骤；完成用户要求的
资源操作才是结果。

准确的安装与操作流程位于 [`skills/realmroot`](skills/realmroot/SKILL.md)。Skill 与
Restish Adapter 独立更新；当协议或资源授权模型变化时，请遵循
[部署升级指南](docs/deploy/upgrades.md#agent-client-compatibility)。

## 面向产品的身份基础设施

即使产品还没有接入 Agent 能力，也可以将 Realmroot 部署为应用的身份根：

- 托管认证、Consent、恢复、MFA、Passkey 和 Session；
- 一个 Better Auth OIDC Issuer 和用户池；
- Public、Native 和 Confidential 应用客户端；
- 用于管理资料、凭证、Session、关联账户、授权应用和个人 Agent 的 Account Center；
- 用于管理应用、用户、组织、角色、Connector、API Resource、安全、品牌、Webhook、
  Agent 和审计的 Admin Console；
- 一个通过 OpenAPI 描述、用于管理和自动化的 Resource API。

应用通过以下地址发现 Issuer：

```text
/api/auth/.well-known/openid-configuration
```

管理 Resource API 的契约位于：

```text
/api/openapi.json
```

产品应用使用 OIDC 完成登录，不应在普通登录或 Session 集成中调用 Resource API。

## 架构与部署

Realmroot 在 Cloudflare Worker 内运行 Better Auth。Hono 提供 HTTP 接口，Drizzle
管理 Cloudflare D1 Schema，加密后的凭证材料保留在服务端 Adapter 之后，React 提供
托管的 Account Center 和 Admin Console。

一次部署就是一个 Realm：一个 Issuer、用户池、Agent Namespace、策略边界和管理控制面。
当产品需要隔离用户、管理员、Issuer URL 或登录策略时，应部署新的实例。

部署一个 Realm：

1. Fork `saltbo/realmroot`；
2. 将 [`deploy/realmroot-fork.yml`](deploy/realmroot-fork.yml) 安装为
   `.github/workflows/deploy.yml`，并启用 GitHub Actions；
3. 按照 [Cloudflare 部署指南](docs/deploy/cloudflare.md)配置 Cloudflare Secret 和发件人；
4. 运行 **Deploy Realmroot Fork**，打开部署后的 URL，并完成首位管理员初始化。

后续升级使用 **Sync fork**。Workflow 实际部署的版本就是推送到 Fork 的 Commit。
运维细节请参阅[部署升级](docs/deploy/upgrades.md)、
[全新部署设置](docs/deploy/setup.md)和[租户模型](docs/architecture/tenancy.md)。

## 文档

- [价值说明](docs/product/value-proposition.md)：为什么 Realmroot 将 Agent 工具平面与
  身份和信任基础设施组合在一起；
- [Agent 访问指南](docs/guides/agent-access.md)：身份、批准、账户连接、Token 和撤销旅程；
- [Agent 身份架构](docs/architecture/agent-identity.md)：稳定身份、Host 绑定、权限、凭证、
  AgentInfo 和审计；
- [授权边界](docs/architecture/authorization-boundaries.md)：资源自有 Scope、角色语义、
  签发策略和最终执行；
- [资源服务器集成](docs/integrations/resource-servers.md)：发布并验证 Native 或 External
  受保护 API；
- [Resource API](docs/api/resource-api.md)：Realmroot 管理 API 和 Agent 能力模型；
- [技术文档索引](docs/README.md)：全部架构、集成和部署文档。
