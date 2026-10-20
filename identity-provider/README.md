# 邀请制注册门禁

独立的 Keycloak **26.7.3** FormAction Provider。使用 JDK 25 构建，生成 Java 21 字节码：该版本官方 Keycloak 镜像运行 Java 21。应用后端的 Java 25 要求不变。

## 行为与边界

仅配置的教育客户端可以注册。初次注册页从 `invite_grant` 查询参数取得短期授权，保存在服务端认证会话；表单验证时调用内部 `reserve`。缺少配置、授权无效、错误客户端及预留失败均拒绝创建身份。表单纠错保留同一认证会话的授权，后端负责重复预留、撤销、过期及绑定校验。

注册成功只创建统一身份并绑定邀请，不加入任何家庭。用户完成正常 OIDC 回调后，还需在应用中明确接受邀请。认证令牌的 state、nonce 由应用的正常 OAuth2 登录过程创建；应用注册入口应使用登录请求解析器切换为 Keycloak `registrations` 端点并添加 `invite_grant`，不能直接拼接一个缺少 state 的回调链接。

Provider 不读取、保存或转发密码；不写授权令牌和回调正文到日志。在 User Creation 的 `success` 之后，将签名续办凭据与新身份写入同一个 Keycloak 事务。只有该事务成功提交，`enlistAfterCompletion` 才尝试外部 `bind`；本地回滚不调用绑定。外部失败、提交成功但响应丢失时保留已提交身份和凭据，正常 OIDC 登录后的后端可核验并幂等续绑，因此不会留下业务已绑定而身份未提交的悬空状态。凭据生成失败则明确标记 Keycloak 事务回滚。

续办凭据的用户属性和教育客户端专属 ID-token claim 均为 `learning_registration_receipt`。格式为 `base64url(JSON).base64url(HMAC-SHA256(key,payloadBase64ASCII))`，不带补位；JSON含 `v:1`、`reservationId`、`clientId`、`authSessionId`、`issuer`、`subject`，密钥为内部注册密钥的UTF-8字节。后端只从经过正常 OIDC 验证的 ID token 读取，核对签名和完整身份，再检查原邀请状态；同一预留不能改绑。修改用户属性不能伪造签名。凭据不进入其他客户端、access token 或 userinfo。

## 配置

通过认证中心进程环境或受保护的部署环境文件注入，实际值不进入仓库：

| 环境变量 | 含义 |
|---|---|
| `LEARNING_REGISTRATION_CLIENT_ID` | 唯一允许注册的教育 OIDC client ID |
| `LEARNING_REGISTRATION_BACKEND_URL` | 私网后端根地址；含应用上下文时包含该上下文 |
| `LEARNING_REGISTRATION_KEY` | 至少32字符的内部专用密钥，与后端匹配，同时用于续办凭据签名 |

Provider 在后端根地址追加 `/internal/registration/reserve` 或 `/internal/registration/bind`；请求携带 `X-Registration-Key`，不跟随重定向。连接超时3秒、单次请求超时5秒。内部路径不得在公开反向代理中开放。

## 构建、隔离验收与增量配置

```sh
mvn -f identity-provider/pom.xml clean package
python3 identity-provider/scripts/test_isolated.py
```

验收启动一次性官方 Keycloak 26.7.3 容器，使用专用合成 Realm、一次性管理员和私有网关模拟器，实际提交注册表单并检查身份数据库及 OIDC 授权码。容器会清理，结果和诊断日志保存在忽略的 `.local/identity-provider-acceptance/`。验收不读取或修改现有统一身份服务。

将生成的 JAR 放入认证中心 `providers/` 并按该服务原有方式构建、重启后，使用短期管理员令牌运行只读检查：

```sh
python3 identity-provider/scripts/configure_flow.py \
  --base-url "$IDENTITY_ADMIN_URL" --realm "$IDENTITY_REALM" \
  --client-id "$EDUCATION_CLIENT_ID"
```

令牌通过 `KEYCLOAK_ADMIN_ACCESS_TOKEN` 环境变量提供。默认不写入；不会创建用户、重导入 Realm、重建客户端或修改登录流。

部署方核对 Provider 配置和隔离验收后，显式加 `--apply --enable-registration` 才会复制注册流、追加最后一个 REQUIRED 门禁并绑定注册流，同时为指定教育客户端幂等添加上述 ID-token claim mapper。工具只接受原生注册流或本工具创建的流；发现其他自定义注册流会停止，避免覆盖。重复执行验证门禁唯一、最后执行、User Creation 为 REQUIRED；其余客户端的注册请求由同一个门禁拒绝。既有登录流、主题和身份不变。

上线验收还必须接入真实业务后端和 PostgreSQL，验证受邀注册、完整 OIDC 登录、显式入家和权限隔离；模拟网关验收不代替该联合检查。

联合验收工具要求预先准备独立的合成 PostgreSQL 18 数据库，迁移账号和运行账号与应用约定一致；不连接生产库：

```sh
# DB_URL、DB_MIGRATION_USER 等只指向合成测试数据库。
python3 identity-provider/scripts/prepare_joint.py
# 用生成的受保护 backend.env 启动真实后端后：
python3 identity-provider/scripts/test_joint.py
python3 identity-provider/scripts/prepare_joint.py --stop
```

`prepare_joint.py` 创建一次性 Keycloak、专用合成 Realm 和强制PKCE S256的 confidential OIDC 客户端，默认端口为18885/18886；生成的管理员、运营身份和客户端秘密仅在忽略目录中。`test_joint.py` 通过真实登录表单、S256授权码交换和 Cookie/CSRF 测试入站邀请、受控注册、明确接受邀请、家庭与孩子历史隔离、只读成员、错误 OAuth state 和全局退出。`--stop` 删除一次性身份容器及凭据文件，业务后端和合成数据库由启动方清理。

SPI依据：[Keycloak官方扩展文档](https://www.keycloak.org/docs/latest/server_development/#_auth_spi)、[FormAction注册顺序说明](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_development/topics/auth-spi.adoc)。
