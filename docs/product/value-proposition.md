# Realmroot Value Proposition / Realmroot 价值说明

[English](#english) · [简体中文](#简体中文)

## English

### Product Thesis

**Every API, Agent-ready.**

Realmroot turns existing OpenAPI services into secure, discoverable tools for
Agents—without requiring every resource server to build and maintain a separate
Agent integration.

Its long-term vision is to make the capabilities already built across the
internet safely available to Agents. Identity is essential to that vision, but
identity is the trust foundation rather than the final outcome. The outcome is
that an Agent can find the right tool, obtain appropriate authority, and finish
the requested operation against the original service.

### The Problem Realmroot Solves

Most useful digital capabilities already exist behind HTTP APIs. An Agent still
needs answers to four questions before it can use them:

1. What resources and operations are available?
2. How does it invoke an operation correctly?
3. Who is the Agent, and who controls it?
4. Why should the resource server allow this exact request?

A purpose-built MCP server or custom CLI can answer the first two questions for
one service. Repeating that integration for every service creates another
contract to design, release, secure, document, and maintain. The initial
development cost is visible; the long tail of keeping the adapter aligned with
the API is larger and easier to underestimate.

A central permission registry creates a similar problem for the last question.
When another platform copies business permissions and endpoint mappings away
from the resource server, policy can drift from the code that actually protects
the data.

Realmroot avoids both duplicated surfaces. RFC 9728 protected-resource metadata
remains the scope vocabulary, OpenAPI remains the tool contract, and the
resource server remains the final authorization boundary.

### Value 1: The Agent Tool Plane

Realmroot provides a shared route from an existing API to an Agent capability:

```text
API + OpenAPI + local enforcement
              ↓
Realmroot registration, discovery, identity, and delegated authorization
              ↓
Restish generic CLI + Realmroot Skill
              ↓
Agent discovery and direct invocation
```

This creates value in four ways:

- **Reuse instead of reintegration.** A resource server maintains one API and
  one OpenAPI contract rather than a separate Agent-facing surface.
- **Live discovery.** The Agent discovers registered resources and reads the
  current contract instead of depending on a copied catalog.
- **Generic invocation.** Restish maps standard OpenAPI operations to a common
  CLI, while the Skill provides the operating procedure.
- **Unbounded composition.** The Agent's toolbox grows with the resource servers
  connected to Realmroot; it is not limited to tools compiled into one runtime.

Realmroot does not claim that every interaction should be OpenAPI-based.
Purpose-built tools remain appropriate for specialized protocols and highly
curated interactions. Realmroot optimizes the much broader case where a stable
HTTP API already exists.

### Value 2: Identity And Trust Infrastructure

Realmroot also solves the conventional identity work that every product needs:

- a deployable realm with one issuer, user pool, application registry, policy
  boundary, and administrative control plane;
- hosted authentication, recovery, consent, MFA, passkeys, and session
  management;
- OIDC/OAuth integration for product applications;
- user self-service through Account Center;
- operational management of users, organizations, roles, connectors, API
  Resources, security, branding, webhooks, and audit through Admin Console;
- an OpenAPI-described management API for automation.

This is independently useful infrastructure. It replaces repeated work across
database schemas, authentication pages, protocol flows, application-client
handling, security settings, email operations, and administrative interfaces.

It also establishes the trust plane for Agent access. Realmroot can distinguish
the stable Agent from its current Host, identify the person or organization that
controls it, record an explicit delegated grant, issue or coordinate a bounded
credential, and preserve revocation and audit context.

### Why These Two Values Belong Together

The two layers complete one another:

| Tool plane without trust | Trust infrastructure without tools | Realmroot together |
| --- | --- | --- |
| An Agent can reach APIs, but authority is ambiguous or overbroad. | Identity is reliable, but the Agent still cannot discover or use the service. | The Agent discovers a live contract, receives exact delegated authority, and calls the service directly. |

The same people, organizations, applications, sessions, and policies used by a
product become the control context for its Agents. The same APIs maintained for
applications become tools for those Agents. Realmroot connects these existing
assets instead of creating a separate identity silo and integration stack.

### Responsibility Boundary

Realmroot deliberately owns:

- registration and discovery of API Resources;
- stable Agent identity and Host binding;
- controller and home-space relationships;
- grant request, approval, lifecycle, revocation, and audit context;
- role definitions as named groupings of scopes;
- token issuance for native resources and issuance coordination for external
  resources;
- the Agent operating procedure supplied through the Realmroot Skill.

The resource server deliberately owns:

- its API behavior and OpenAPI contract;
- the definition of business scopes in RFC 9728 protected-resource metadata;
- the mapping from scopes to operations and data in OpenAPI and local policy;
- resource ownership, tenancy, and object-level policy;
- final token validation and the allow-or-deny decision.

Realmroot supplies trustworthy identity and authority data. It does not decide
which business object a principal may access and it does not proxy the protected
request. This boundary keeps policy beside the code and data it protects. The
detailed model is recorded in
[ADR 0010](../adr/0010-resource-server-owns-business-authorization.md).

### Value By Participant

| Participant | Value |
| --- | --- |
| Agent user | More useful tasks can be completed without handing the Agent a personal API key. |
| Agent developer | One Skill and generic CLI replace a growing collection of service-specific adapters. |
| Resource-server team | Existing API and OpenAPI investments become Agent-accessible without a parallel integration surface. |
| Product team | Hosted identity, OIDC, account management, and administration do not need to be rebuilt. |
| Security team | Agent identity, controller approval, narrow scopes, short-lived DPoP credentials, revocation, and audit remain explicit. |

### Product Test

Realmroot is succeeding when adding a resource server expands what an Agent can
do without requiring Agent-specific backend code, while every protected request
still carries enough identity and authority for the resource server to make its
own correct decision.

## 简体中文

### 产品主张

**让每个 API，都能为 Agent 所用。**

Realmroot 将现有 OpenAPI 服务转化为 Agent 可安全发现和调用的工具，无需每个资源服务器
单独开发和长期维护 Agent 集成。

Realmroot 的长期愿景，是让互联网已经积累的能力都能被 Agent 安全使用。身份是实现这个
愿景不可缺少的条件，但身份是信任基础，而不是最终结果。最终结果是 Agent 能够找到正确
的工具、获得适当权限，并在原始服务上完成用户要求的操作。

### Realmroot 解决的问题

绝大多数有价值的数字能力已经存在于 HTTP API 之后。Agent 真正使用它们之前，仍然需要
回答四个问题：

1. 有哪些资源和操作可用？
2. 如何正确调用一个操作？
3. 这个 Agent 是谁，又由谁控制？
4. 资源服务器为什么应该允许这一次具体请求？

专用 MCP Server 或自定义 CLI 可以为一个服务回答前两个问题。但为每个服务重复建设这套
集成，就会多出一份需要设计、发布、加固、记录和维护的契约。初始研发成本容易量化，
让适配器长期跟随 API 演进的长尾成本则更大，也更容易被低估。

中心化权限注册表会为最后一个问题制造类似风险。当另一个平台把业务权限和 Endpoint
映射复制到资源服务器之外时，策略可能逐渐偏离真正保护数据的代码。

Realmroot 避免复制这两个表面。RFC 9728 受保护资源元数据继续作为 Scope 词汇来源，
OpenAPI 继续作为工具契约，资源服务器继续作为最终授权边界。

### 价值一：Agent 工具平面

Realmroot 为现有 API 成为 Agent 能力提供一条共享路径：

```text
API + OpenAPI + 本地权限执行
              ↓
Realmroot 注册、发现、身份与委托授权
              ↓
Restish 通用 CLI + Realmroot Skill
              ↓
Agent 发现并直接调用
```

它从四个方面创造价值：

- **复用，而不是重复集成。** 资源服务器维护一套 API 和一份 OpenAPI 契约，不需要再维护
  Agent 专用接口；
- **动态发现。** Agent 发现已注册资源并读取当前契约，而不是依赖复制出来的目录；
- **通用调用。** Restish 将标准 OpenAPI 操作映射为统一 CLI，Skill 提供操作方法；
- **持续组合。** Agent 的工具箱随着接入 Realmroot 的资源服务器增加而扩展，不受限于
  某个 Runtime 中预先编译的工具。

Realmroot 并不主张所有交互都应基于 OpenAPI。对于特殊协议和高度策划的交互，专用工具
仍然合适。Realmroot 优化的是更广泛的场景：服务已经拥有稳定的 HTTP API。

### 价值二：身份与信任基础设施

Realmroot 同时解决每个产品都会面对的传统身份工作：

- 一个可部署的 Realm，包含 Issuer、用户池、应用注册表、策略边界和管理控制面；
- 托管认证、恢复、Consent、MFA、Passkey 和 Session 管理；
- 产品应用的 OIDC/OAuth 集成；
- 通过 Account Center 提供用户自助服务；
- 通过 Admin Console 管理用户、组织、角色、Connector、API Resource、安全、品牌、
  Webhook 和审计；
- 一个由 OpenAPI 描述、用于自动化的管理 API。

这是一套能够独立创造价值的基础设施。它替代了产品在数据库 Schema、认证页面、协议
流程、应用客户端处理、安全设置、邮件运维和管理界面上的重复建设。

它也建立了 Agent 访问所需的信任平面。Realmroot 能区分稳定 Agent 与当前 Host，识别
控制它的人或组织，记录显式的委托 Grant，签发或协调获得受限凭证，并保留撤销和审计
上下文。

### 为什么这两层价值应该在一起

两层能力互相补全：

| 只有工具平面，没有信任 | 只有信任基础设施，没有工具 | Realmroot 将两者结合 |
| --- | --- | --- |
| Agent 能触达 API，但权限主体模糊或范围过大。 | 身份可靠，但 Agent 仍无法发现和使用服务。 | Agent 发现实时契约，获得精确委托权限，并直接调用服务。 |

产品已有的人、组织、应用、Session 和策略会成为 Agent 的控制上下文；为应用维护的 API
会成为 Agent 的工具。Realmroot 连接这些现有资产，而不是再创建一套身份孤岛和集成栈。

### 责任边界

Realmroot 刻意负责：

- API Resource 的注册与发现；
- 稳定 Agent 身份和 Host 绑定；
- Controller 与 Home Space 关系；
- Grant 申请、批准、生命周期、撤销和审计上下文；
- 将角色定义为具名的 Scope 集合；
- 为 Native 资源签发 Token，为 External 资源协调签发；
- 通过 Realmroot Skill 提供 Agent 操作方法。

资源服务器刻意负责：

- 自身 API 行为和 OpenAPI 契约；
- 在 RFC 9728 受保护资源元数据中定义业务 Scope；
- 在 OpenAPI 和本地策略中定义 Scope 到操作和数据的映射；
- 资源所有权、租户和对象级策略；
- 最终 Token 验证和允许或拒绝决定。

Realmroot 提供可信的身份与权限数据，但不决定某个 Principal 能访问哪个业务对象，也不
代理受保护请求。这个边界让策略与它保护的代码和数据保持在一起。详细模型记录在
[ADR 0010](../adr/0010-resource-server-owns-business-authorization.md)中。

### 各参与方获得的价值

| 参与方 | 价值 |
| --- | --- |
| Agent 用户 | 无需把个人 API Key 交给 Agent，也能完成更多真实任务。 |
| Agent 开发者 | 一套 Skill 和通用 CLI 替代不断增长的服务专用适配器集合。 |
| 资源服务器团队 | 现有 API 和 OpenAPI 投资无需平行集成面即可服务 Agent。 |
| 产品团队 | 无需重复建设托管身份、OIDC、账户管理和管理后台。 |
| 安全团队 | Agent 身份、控制者批准、最小 Scope、短期 DPoP 凭证、撤销和审计保持显式。 |

### 产品检验标准

当接入一个资源服务器就能扩展 Agent 可完成的任务，而不要求编写 Agent 专用后端代码，
同时每个受保护请求仍然携带足够的身份与权限信息，让资源服务器能够自行作出正确判定，
Realmroot 就实现了它的价值。
