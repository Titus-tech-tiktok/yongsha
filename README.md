# 财神测款机 Web SaaS
作者微信：胡小亮 huxiaoliang2333

这是当前 macOS V8 的 Web 全栈迁移版。前端保留完整业务入口，后端复用同一套模板判断、提示词、审核和标题算法。素材、配置、任务和输出按团队账号分别保存在服务器工作区，不依赖 Supabase 或其他云存储。

## 功能对应

| Mac 功能 | Web 对应 |
| --- | --- |
| 素材资产 | 品类款式、印花素材、套图模板上传与当前素材映射 |
| 系统设置 | 运营标识、输出位置、审核模式 |
| 素材生图 | 款式/印花素材库、任务队列、模板换印花、母版模式 |
| 套图配置 | AI 标注、换印花/保留/跳过/人工确认、区域蒙版、商品资料 |
| 人工筛图 | 单图通过/不通过/重生成、整套生成、批量生成/通过、日志 |
| 生成标题 | xlsx/csv 词库、词根、批量生成/导出、审核通过任务标题 |
| 自由生图 | 上传参考图、提示词生成、下载结果 |

素材资产页支持选择电脑文件夹、增量扫描、跳过未变化图片，并在网页直接预览。每位美工登录自己的账号后，只能看到自己的素材、任务、提示词和输出配置。

## 团队账号

首次打开网站会要求创建管理员账号；首位管理员继续使用原 `local` 工作区，不会丢失升级前素材。管理员可在“系统设置 → 团队账号”创建或停用成员账号。每个新成员使用独立的 `data/workspaces/user-*` 工作区。

浏览器无法让远程服务器直接读取成员电脑上的绝对路径。成员选择本机文件夹后，网站只上传新增或变化的图片到该成员的服务器工作区；成品输出路径也是服务器上的路径。

权限分工：

| 功能 | 管理员 | 普通成员 |
| --- | --- | --- |
| 素材、生图、筛图、标题、自由生图 | 可用 | 可用 |
| 基础设置与个人输出目录 | 可用 | 可用 |
| 提示词设置 | 可见、可修改 | 不显示、接口拒绝 |
| API 设置 | 可见、可修改 | 不显示、接口拒绝 |
| 团队账号 | 可见、可管理 | 不显示、接口拒绝 |

API 与提示词是服务器全局设置，由管理员统一维护，普通成员的生成任务会自动使用该配置。

## 本地启动

```bash
cp .env.example .env
# 在 .env 分别填写 CAISHEN_IMAGE_API_KEY / CAISHEN_ANALYSIS_API_KEY
npm install
npm run dev
```

- Web 开发地址：`http://127.0.0.1:5173`
- API：`http://主电脑局域网IP:8788`
- 健康检查：`http://主电脑局域网IP:8788/api/health`

生产构建：

```bash
npm run check
npm start
```

生产地址为 `http://主电脑局域网IP:8788`。局域网共享时设置 `CAISHEN_HOST=0.0.0.0`。数据默认写入 `./data`，也可以通过 `CAISHEN_DATA_DIR` 指向外接 SSD 或 NAS。公网部署必须放在 HTTPS 反向代理后，并在 `.env` 配置至少 32 位的 `CAISHEN_SESSION_SECRET`。API 密钥只存在根目录 `.env` 和服务端进程，不会进入前端包。

## OpenAI 兼容接口

服务端通过以下变量接入 OpenAI 兼容服务：

```env
CAISHEN_API_SERVICE_URL=http://your-api-host
CAISHEN_API_BASE_URL=https://api.change2pro.com
CAISHEN_IMAGE_API_KEY=your-image2-group-key
CAISHEN_ANALYSIS_API_KEY=your-text-analysis-group-key
CAISHEN_ANALYSIS_WIRE_API=chat_completions
CAISHEN_IMAGE_MODEL=gpt-image-2
CAISHEN_REVERSE_PROMPT_MODEL=gpt-5-3
CAISHEN_FILE_TOKEN_SECRET=至少32位随机字符串
CAISHEN_SESSION_SECRET=至少32位随机字符串
```

- 模型与服务检测：`GET /v1/models`
- 模板分析、商品资料、AI 质检：`POST /v1/chat/completions`
- 母版、模板换印花、重新生成、自由生图：`POST /v1/images/edits`
- 图片编辑严格使用 multipart，多张参考图重复提交 `image` 字段。

生图、AI 分析和重生成都由服务端持久后台任务执行，任务记录保存在 `data/workspaces/<workspace>/jobs`。浏览器只轮询状态，不会让单次生图请求长期占用反向代理连接。

## Docker 部署

```bash
cp .env.example .env
docker compose up -d --build
```

主电脑应给 `/data` 挂载持久磁盘，并配置独立备份。局域网内的美工通过主电脑 IP 访问；公网访问时通过 Nginx/Caddy 配置 HTTPS，不要把 8788 端口直接暴露到公网。

## 目录

```text
apps/web/            浏览器 UI 与 API bridge
apps/api/            Node API、本地工作区适配器、复用业务核心
data/                本地开发数据（不提交）
```

## 本地素材工作流

1. 美工登录自己的团队账号，在“素材资产”选择印花或套图文件夹。
2. 点击“开始扫描”，浏览器只上传新增和变化的图片。
3. 文件保存到该账号的 `CAISHEN_DATA_DIR/workspaces/<workspace>/assets`。
4. 图片 URL 带文件版本并使用浏览器硬盘缓存；文件变化后自动换新 URL。
5. 其他美工的账号使用不同工作区，彼此素材和任务不会混在一起。
