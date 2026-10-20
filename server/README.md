# 家庭学习服务

独立Java 25 / Spring Boot 3.5.16模块，采用Spring Security OIDC、JDBC、PostgreSQL 18及Flyway 11.20.2。保留静态教材前端，云端API和长期历史位于同一来源的 `/edu/math/`；不包含部署身份、家庭数据或教材PDF。

## 构建与配置

```sh
mvn -f server/pom.xml verify
java -jar server/target/family-learning-server.jar
```

应用默认只监听回环地址8080端口。由HTTPS反向代理公开应用，并传递可信的来源协议和主机；`/internal/registration/` 仅允许认证中心从受保护网络访问，公开入口必须拒绝此路径。

以下配置从受保护环境注入，禁止进入Git或启动日志：

| 环境变量 | 用途 |
|---|---|
| `DB_URL` | PostgreSQL 18 JDBC地址，生产经私网；按实例能力验证TLS，见部署文档 |
| `DB_USER`、`DB_PASSWORD` | Web运行账号，用户名固定为 `learning_app` |
| `DB_MIGRATION_USER`、`DB_MIGRATION_PASSWORD` | 独立迁移账号，拥有业务表，不能与Web身份相同 |
| `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET` | 统一认证中心与保密客户端配置 |
| `REGISTRATION_REDIRECT_URI` | 注册和普通登录共用的完整 `/edu/math/login/oauth2/code/learning` 回调地址 |
| `REGISTRATION_KEY` | 与注册扩展共用的独立随机秘密，至少32字符 |
| `OPERATOR_ISSUER`、`OPERATOR_SUBJECT` | 可选；二者明确匹配才启用站点开户邀请权限 |
| `BIND_ADDRESS`、`PORT` | 监听地址与端口，容器部署由受保护网络限制 |

独立业务库预先创建 `learning_app` 与 `learning_backup` 角色，以及独立迁移角色。Web和备份角色均为 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`，不属于迁移或其他高权限角色。迁移账号需要在业务库创建schema、表、函数和授权的权限。启动检查会拒绝PostgreSQL其他主版本、高权限Web角色、表所有者以及未开启FORCE RLS的业务表。

客户端需配置准确的登录回调、退出返回地址及 `/edu/math/logout/connect/back-channel/learning`；启用携带会话ID的Keycloak后向退出。服务使用host-only、Secure、HttpOnly、SameSite=Lax会话Cookie，OIDC令牌不交给前端。

## 权限与持久化

身份只按issuer与subject建立；不同系统中的同名用户不会自动合并。每个请求在事务内重新验证成员资格，再设置事务级用户、家庭和角色上下文。数据库所有家庭表启用FORCE RLS，孩子关联使用家庭与孩子复合外键。连接归还池时事务上下文自动结束。

家庭管理员管理成员、邀请、孩子与导出；记录成员新增学习记录；只读成员仅浏览。移除和自行离开均保留署名，最后一位管理员不能离开或降级；修改管理员使用家庭行锁防止并发写偏差。

每个成人账号最多有一个启用中的家庭成员关系。创建或加入家庭后，不能再次创建家庭或接受新的开户/家庭邀请；同一账号并发创建、加入也只允许一项成功，返回 `409 FAMILY_ALREADY_JOINED`。已经成功接受的邀请重试保持幂等，不会恢复已退出的旧家庭。合法退出或被移除后，可以重新加入家庭；旧学习记录与署名继续保留。管理员重新启用旧成员也受同一限制。

V7迁移使用 `members_one_active_family` 部分唯一索引落实该约束，FORCE RLS仍然保留。上线前必须由受保护的全行只读账号检查是否存在同一账号的多个启用关系；若存在，迁移会事务回滚并停止发布，先明确处理归属，不自动删成员或学习历史。常驻服务的启动安全检查也会拒绝缺失或无效的该索引。

邀请令牌只存SHA-256摘要，7天过期、单次消费；注册grant为10分钟。注册预留按邀请行串行，绑定创建后的身份，登录后仍需显式接受邀请。过期未绑定的预留可以重新开始，原reservation保留账本以便已创建身份续办；每个邀请只有一个最终绑定身份。

注册扩展在身份事务内保存HMAC收据，身份提交后尝试绑定。响应丢失时，应用仅从已验证OIDC ID token的专属claim验证收据并幂等补绑；不把密码交给应用。有效收据可在grant过期后续办，但不能越过失效、撤销或已由另一身份消费的邀请。原邀请失效时账号仍能登录并接受新邀请，`me.registrationPending` 明确表示原注册未完成。已在账本绑定到同一issuer/subject的身份不会因之后轮换共享秘密被封锁。

观察更正追加保存，活动卡保存服务器端当时的内容快照，升级目录后仍可查看旧玩法并更正旧观察；同ID同内容幂等，不同内容409。练习保存使用版本号，竞争编辑返回409；结束的记录保留原题目内容，不根据升级后的题库重新判分，更新不能改写所属数据版本。历史按时间、ID与类型进行游标分页；引擎推断跳过的基础不构成长时掌握证据。旧JSON导入必须先预览并明确目标家庭与孩子，明确标注的试运行记录被拒绝。

## 验证

常规 `mvn test` 执行HTTP安全与OAuth请求测试。真实数据库集成测试仅在明确提供一次性测试库时运行：

```sh
LEARNING_TEST_JDBC_URL=jdbc:postgresql://127.0.0.1:18543/learning_test mvn -f server/pom.xml test
```

测试库需要预先建立上述三个固定角色，测试运行会清空该库的全部合成业务数据，不能指定生产库。密码通过 `LEARNING_TEST_APP_PASSWORD` 与 `LEARNING_TEST_MIGRATION_PASSWORD` 注入。集成测试覆盖数据库RLS与跨孩子外键、双家庭越权、单账号家庭限制与创建/加入并发、退出后加入及旧成员重新启用、角色撤销、并发最后管理员、邀请绑定与过期恢复、记录幂等和并发冲突、导入、观察更正与分页。

健康检查为 `/edu/math/healthz`；就绪检查为 `/edu/math/readyz`，后者验证数据库连接、PostgreSQL主版本和运行角色隔离，不返回连接信息。

## 备份恢复

`learning_backup` 只拥有明确的全行SELECT策略与读取权限，不能写业务表。独立业务库完整备份包含 `public.flyway_schema_history`；必须使用 `pg_dump --enable-row-security`，不能以Web运行身份备份部分可见记录。

完整自定义格式归档可由非超级用户恢复到全新隔离库，使用 `pg_restore --no-owner --no-acl`；数据在恢复FORCE RLS策略前载入。恢复后重新给予应用与备份角色各自的最小权限，核对所有表计数与Flyway历史，再开放服务。禁止关闭生产RLS或把归档恢复到已有业务库。通用受保护备份与隔离恢复校验工具见根目录 `ops/`。
