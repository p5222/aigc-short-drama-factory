# 项目后续迭代与无感发布方案

更新时间：2026-07-04

## 现在可以怎么迭代？

短期最简单：

1. 你继续在这个 Codex 对话里提需求。
2. 我修改本地项目。
3. 我本地构建验证。
4. 我上传到云服务器。
5. 我重启服务并验证 `https://manjiao.cloud`。

这适合当前早期阶段，速度快。

## 为什么不建议长期直接改生产？

直接改生产目录有风险：

- 改到一半用户访问可能报错。
- 数据库结构变更失败可能影响真实数据。
- 新版本如果有 bug，不容易快速退回。
- 多人协作时不知道线上到底是哪版代码。

所以后续要逐步走“本地开发 -> 预发布 -> 生产”的流程。

## 没有 Codex 时，自己部署要怎么做？

你需要掌握三件事：

1. 代码管理：Git
   - 本地改代码后提交 commit。
   - 推送到 GitHub/Gitee/私有仓库。
2. 服务器更新：SSH
   - 登录服务器。
   - 拉取新代码或上传新包。
   - 执行构建和重启命令。
3. 数据保护：备份
   - 发布前备份 PostgreSQL。
   - 发布前备份 `storage`。
   - 出问题能回滚。

当前服务器生产目录：

```bash
/opt/manjiao
```

常用查看命令：

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
curl https://manjiao.cloud/health
```

## 推荐的正式目录结构

生产环境：

```bash
/opt/manjiao
```

预发布环境：

```bash
/opt/manjiao-staging
```

备份目录：

```bash
/opt/manjiao-backups
```

端口建议：

- 生产：`127.0.0.1:8080`
- 预发布：`127.0.0.1:8081`

域名建议：

- 生产前台/后台：`https://manjiao.cloud`
- 预发布验证：`https://staging.manjiao.cloud`

## 无感迭代怎么实现？

最稳妥的方式是“预发布验证 + 短时间切换”。

1. 新版本先部署到 `/opt/manjiao-staging`。
2. 使用独立数据库或生产数据库备份副本测试。
3. 访问 `https://staging.manjiao.cloud` 验证。
4. 验证通过后备份生产数据库和 `storage`。
5. 把生产目录切到新版本。
6. 重启 API。
7. 访问 `https://manjiao.cloud/health` 验证。

对用户来说，通常只有几秒钟影响，甚至无感。

## 更高级的蓝绿发布

以后用户多了，可以做蓝绿发布：

- Blue：当前线上版本，端口 `8080`
- Green：新版本，端口 `8081`
- Caddy 当前指向 Blue。
- Green 验证通过后，Caddy 切到 Green。
- 如果出问题，Caddy 立刻切回 Blue。

这种方式更接近无感发布。

## 每次发布前必须做的事

1. 备份数据库：

```bash
cd /opt/manjiao
mkdir -p /opt/manjiao-backups
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U aigc -d aigc_drama -Fc > /opt/manjiao-backups/aigc_drama_$(date +%Y%m%d_%H%M%S).dump
```

2. 备份 storage：

```bash
cd /opt/manjiao
docker compose -f docker-compose.prod.yml cp api:/app/storage /opt/manjiao-backups/storage_$(date +%Y%m%d_%H%M%S)
```

3. 确认健康检查：

```bash
curl https://manjiao.cloud/health
```

## 当前阶段建议

当前项目还在快速开发期，建议先这样：

1. 继续由 Codex 帮你迭代。
2. 每次我发布前先备份数据库和 `storage`。
3. 等功能稳定后，再加 `staging.manjiao.cloud`。
4. 等有真实用户后，再做蓝绿发布。

