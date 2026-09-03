<p align="center">
  <img src="https://realmroot.dev/assets/logo.png" alt="Realmroot 标志" width="132" />
</p>

<h1 align="center">Realmroot</h1>

<p align="center">
  <strong>让每个 API 都能为 Agent 所用。</strong>
</p>

<p align="center">
  Realmroot 让 Agent 安全发现并调用现有 OpenAPI 服务。<br />
  服务团队无需改变原有 API，也不必另行维护 Agent 专用集成。
</p>

<p align="center">
  <a href="https://realmroot.dev/zh-cn/">官网</a> ·
  <a href="https://realmroot.dev/zh-cn/docs/">文档</a> ·
  <a href="https://realmroot.dev/zh-cn/docs/getting-started/quick-start/">快速开始</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/realmroot/realmroot/actions/workflows/ci.yaml"><img src="https://github.com/realmroot/realmroot/actions/workflows/ci.yaml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/realmroot/realmroot.svg" alt="许可证" /></a>
  <a href="https://codecov.io/gh/realmroot/realmroot"><img src="https://codecov.io/gh/realmroot/realmroot/branch/main/graph/badge.svg" alt="覆盖率" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D24-339933.svg" alt="Node >=24" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/TypeScript-6.x-3178c6.svg" alt="TypeScript 6.x" /></a>
</p>

## 为什么需要 Realmroot

Agent 需要的大多数能力早已存在于各种 API 之中。真正缺少的是一条共用路径：发现当前
可用的能力、理解实时契约、确认是谁在执行，并且只获得完成当前任务所需的权限。

没有这条路径，每个服务团队都要再维护一套面向 Agent 的集成。契约容易漂移，授权逻辑
会被重复实现，个人凭证可能进入自动化流程，不同 Agent Runtime 还需要各自适配。

Realmroot 在不破坏原有系统边界的前提下补上这条路径：Agent 直接调用原始 API，最终的
业务权限判定仍由 API 自己完成。

> **广泛发现。精确授权。直接调用。**

## 一个产品，两层能力

### Agent Tool Plane

Realmroot 将受保护 API 注册为可发现的 Resource。Agent 读取实时 OpenAPI 契约，选择当前
任务需要的操作，申请准确的 Scope，并通过统一的操作方式调用原始服务。

现有 API 因此可以直接服务于 Agent，而不必为每个服务再建设一套 Agent 专用后端。
[了解 Agent Tool Plane](https://realmroot.dev/zh-cn/docs/concepts/agent-tool-plane/)。

### 身份与信任基础设施

每个 Agent 都拥有独立于当前 Host 和 Runtime 的稳定身份。控制者批准边界明确的 Grant，
凭证保持短期有效，访问可以审计和撤销，同时不会向 Agent 暴露用户的长期凭证。

同一个 Realm 还为人、应用、组织和 Agent 提供托管认证、OAuth/OIDC、Account Center 与
Admin Console。[了解产品身份基础](https://realmroot.dev/zh-cn/docs/guides/product-identity-root/)。

## 工作方式

1. API 团队发布受保护 Resource 及其实时 OpenAPI 契约。
2. Agent 发现该 Resource，并选择完成任务所需的操作。
3. Realmroot 将请求绑定到稳定 Agent，由控制者批准准确的 Scope 和有效期。
4. Agent 获得短期凭证并直接调用 API；API 验证请求并执行自己的业务规则。

Realmroot 不是 HTTP 代理，也不会成为第二套业务权限来源。
[查看完整请求流程](https://realmroot.dev/zh-cn/docs/getting-started/how-it-works/)。

## 为什么选择 Realmroot

- **复用已经运行的 API。** OpenAPI 继续作为实时操作契约，不必再复制出一份工具定义。
- **保留原有授权边界。** Realmroot 协调身份、批准和凭证签发，每个服务继续执行自己的
  数据权限与业务规则。
- **把身份与权限分开。** Enrollment 只确认 Agent 身份；Grant 独立授权一个 Resource、
  一组 Scope、一个账户和一段有效期。
- **不向 Agent 交出个人凭证。** Agent 使用范围明确的短期凭证，而不是控制者的 API Key
  或 Refresh Token。
- **自己掌握部署边界。** Realmroot 完全开源，可在 Cloudflare 上部署为彼此隔离的 Realm。

## 选择你的路径

| 你的角色 | 从这里开始 |
| --- | --- |
| 希望让 Agent 使用私有 API 的用户或开发者 | [快速开始](https://realmroot.dev/zh-cn/docs/getting-started/quick-start/) · [Realmroot Skills](https://realmroot.dev/zh-cn/docs/guides/agent-skills/) |
| 希望让现有服务可被 Agent 使用的 API 团队 | [让 API 可被 Agent 使用](https://realmroot.dev/zh-cn/docs/guides/make-an-api-agent-ready/) |
| 需要统一管理用户、应用和 Agent 身份的产品或平台团队 | [产品身份与信任基础](https://realmroot.dev/zh-cn/docs/guides/product-identity-root/) · [部署 Realmroot](https://realmroot.dev/zh-cn/docs/guides/deploy-realmroot/) |
| 需要评估信任、委托与权限执行模型的安全团队 | [Agent 身份与权限](https://realmroot.dev/zh-cn/docs/concepts/agent-authority/) · [授权边界](https://realmroot.dev/zh-cn/docs/concepts/authorization-boundary/) |

## 开源项目

Realmroot 使用 [Apache 2.0](LICENSE) 许可证。服务运行在 Cloudflare Workers 上，使用 D1
和 R2；托管的 Account Center 与 Admin Console 由 React 构建。

通过[完整文档](https://realmroot.dev/zh-cn/docs/)查看概念说明、接入指南、部署与运维细节。
