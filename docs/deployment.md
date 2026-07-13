# 部署和版本回退

这个项目推荐用 GitHub Actions + Docker Compose 部署。

## 效果

- 推送到 `main` 后，GitHub 自动构建、测试、登录服务器、拉取对应版本并执行 `docker compose up -d --build`。
- 每一次 Git commit 都是一个可回退版本。
- 需要回退时，在 GitHub Actions 手动运行 `Deploy`，填写旧 commit SHA 即可部署旧版本。
- 服务器上的 `data/` 目录通过 Docker volume 持久化，重新部署代码不会删除用户素材、任务和配置。

## 服务器首次准备

服务器需要先安装：

- Git
- Docker
- Docker Compose plugin

首次在服务器拉代码：

```bash
mkdir -p /opt/caishen-web-saas
cd /opt/caishen-web-saas
git clone https://github.com/Titus-tech-tiktok/yongsha.git .
cp .env.example .env
```

然后编辑服务器上的 `.env`，填写真实密钥和生产配置。至少需要：

```env
PORT=8788
CAISHEN_HOST=0.0.0.0
CAISHEN_DATA_DIR=/data
CAISHEN_SESSION_SECRET=至少32位随机字符串
CAISHEN_FILE_TOKEN_SECRET=至少32位随机字符串
CAISHEN_API_BASE_URL=https://api.change2pro.com
CAISHEN_IMAGE_API_KEY=生图key
CAISHEN_ANALYSIS_API_KEY=文字分析key
CAISHEN_ANALYSIS_WIRE_API=chat_completions
CAISHEN_IMAGE_MODEL=gpt-image-2
CAISHEN_REVERSE_PROMPT_MODEL=gpt-5.5
CAISHEN_UPLOAD_FILE_LIMIT_MB=1024
```

首次启动：

```bash
docker compose up -d --build
```

公网部署时，不建议直接暴露 `8788`，建议用 Nginx 或 Caddy 做 HTTPS 反向代理。

如果用户要上传很大的印花或套图文件，还要在反向代理里同步放大上传限制。例如 Nginx：

```nginx
client_max_body_size 1024m;
proxy_read_timeout 600s;
proxy_send_timeout 600s;
```

## GitHub Secrets

到 GitHub 仓库：

`Settings -> Secrets and variables -> Actions -> New repository secret`

添加：

| Secret | 示例 | 说明 |
| --- | --- | --- |
| `DEPLOY_HOST` | `1.2.3.4` | 服务器 IP 或域名 |
| `DEPLOY_USER` | `root` | SSH 用户 |
| `DEPLOY_SSH_PORT` | `22` | SSH 端口 |
| `DEPLOY_SSH_PRIVATE_KEY` | 私钥全文 | 能登录服务器的 SSH 私钥 |
| `DEPLOY_PATH` | `/opt/caishen-web-saas` | 服务器上的项目目录 |

服务器上要把对应公钥加入：

```bash
~/.ssh/authorized_keys
```

## 自动更新

以后只要推送到 `main`：

```bash
git push origin main
```

GitHub Actions 会自动执行：

1. 安装依赖
2. `npm run check`
3. SSH 登录服务器
4. `git fetch`
5. 切换到本次提交
6. `docker compose up -d --build`

## 回退版本

1. 打开 GitHub 仓库的 `Actions`
2. 选择 `Deploy`
3. 点击 `Run workflow`
4. `deploy_ref` 填旧的 commit SHA，例如：

```text
d98091b
```

5. 运行后服务器会切换到该版本并重建容器。

## 注意

- 代码版本可以快速回退。
- 数据目录 `data/` 不会跟随代码回退，数据库/素材/任务仍保留当前服务器数据。
- 如果某次代码改动改变了数据结构，回退前需要确认该改动是否兼容旧版本。
