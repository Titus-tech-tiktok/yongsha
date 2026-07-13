# Change2Pro 双密钥 API 配置设计

## 目标

将当前共用一个 API Key 的配置升级为两条相互独立的 Change2Pro 通道：文字分析通道和 Image2 生图通道。每条通道只配置一个 Key，确保模型分组、密钥和接口族严格对应，并覆盖软件当前所有 AI 调用。

本次不支持 Nano Banana/Gemini Native，也不实现多 Key 轮换或故障切换。

## 方案

采用同一 Change2Pro 网关地址加两套独立凭证：

- 统一网关地址：`https://api.change2pro.com`
- 文字分析：独立 `analysisApiKey` 和 `analysisModel`
- Image2 生图：独立 `imageApiKey` 和 `imageModel`
- 每条通道独立查询 `/v1/models`、独立测试、独立显示配置状态
- 禁止在通道失败时自动借用另一条通道的 Key

## 服务端配置

全局 API 设置升级为版本 2，核心字段为：

```json
{
  "version": 2,
  "baseUrl": "https://api.change2pro.com",
  "analysisApiKey": "server-only",
  "analysisModel": "由文字密钥的 /v1/models 返回",
  "analysisWireApi": "responses",
  "imageApiKey": "server-only",
  "imageModel": "gpt-image-2",
  "responseFormat": "b64_json",
  "requestTimeoutSeconds": 300
}
```

两个密钥只写入服务端全局配置文件。读取配置时，浏览器只能收到 `analysisApiKeyConfigured`、`analysisApiKeyMasked`、`imageApiKeyConfigured` 和 `imageApiKeyMasked`，不能收到明文。

保存时，某个密钥输入留空表示继续使用该通道已保存的密钥。两个通道互不覆盖。

## 旧配置迁移

当前版本只有 `apiKey`。首次读取旧配置时执行一次兼容迁移：

- 旧 `apiKey` 迁移为 `imageApiKey`，因为当前密钥已经通过验证且只返回 `gpt-image-2`
- `analysisApiKey` 保持未配置
- 保留现有 `imageModel`、`analysisModel`、响应格式和超时设置
- 新格式保存成功后不再依赖旧 `apiKey`

迁移不能在浏览器中暴露旧密钥，也不能因文字密钥为空而破坏现有图片能力。

## 调用映射

### 文字分析通道

以下调用统一使用 `analysisApiKey` 和 `analysisModel`。Change2Pro GPT 分组默认使用 `/responses`；后台保留 `/v1/chat/completions` 兼容选项：

- 套图模板 AI 分析
- 商品资料/商品图片识别
- 套图首次质检与复核
- 标题、提示词或其他语言模型生成
- 代码中所有 `billableLlmJson` 语言模型请求

文字测试先使用文字 Key 查询 `/v1/models`，确认填写的模型 ID 存在，再按所选协议发送最小请求。模型 ID 必须原样使用接口返回值，不能根据分组名称推测。

### Image2 生图通道

以下调用统一使用 `imageApiKey`、`imageModel` 和 `/images/edits`：

- 套图文件夹加印花生成
- 自由生图中的参考图编辑
- 缺失图片补生成
- 重新生成和批量补生成
- 代码中所有 `generateImage` 请求

Image2 测试使用图片 Key 查询 `/v1/models`，确认 `imageModel` 存在。图片响应继续优先使用 Base64，不改变现有输出尺寸处理和文件保存逻辑。

## 管理页面

API 设置页改为两个清晰分区：

1. `文字分析 API`：文字密钥、分析模型、Responses/Chat 协议、测试文字接口、文字模型列表
2. `Image2 生图 API`：图片密钥、图片模型、测试图片模型、图片模型列表

网关地址、图片尺寸、图片质量、响应格式和超时仍是公共设置。两个密钥输入框分别显示自己的脱敏保存状态。

页面总状态区分为：

- 全部已配置
- 仅 Image2 已配置
- 仅文字分析已配置
- 未配置

文字通道未配置时，图片生成仍可运行；图片通道未配置时，文字分析仍可运行。触发缺少配置的功能时，错误信息必须明确指出缺少哪一类 Key。

## 错误处理

- `/v1/models` 未返回当前模型时，显示该 Key 所属分组不支持此模型，并展示可用模型 ID
- HTTP 错误保留 Change2Pro 返回的正文，不只显示 `fetch failed`
- 不记录、不回传、不写入构建产物中的明文密钥
- 不进行跨通道 Key 兜底
- 某通道测试失败不会清空另一通道已保存的配置

## 测试与验收

自动测试覆盖：

- 旧单 Key 配置安全迁移为图片 Key
- 两个密钥独立保存、留空保留和脱敏返回
- 图片请求只携带图片 Key
- 所有语言模型请求只携带文字 Key
- 两类 `/v1/models` 查询互不混合
- 缺少某类 Key 时只阻止对应调用
- 现有 API 设置兼容字段和其他运行时测试不回归

本地验收步骤：

1. 保留当前 Image2 Key，确认图片模型测试仍返回 `gpt-image-2`
2. 文字 Key 留空，确认页面明确显示“文字分析未配置”，图片接口仍正常
3. 填入一把支持文字模型的 Change2Pro Key，读取其模型列表并选择实际返回的模型 ID
4. 分别完成文字测试和 Image2 测试
5. 用一张套图执行 AI 分析，再执行一张 Image2 生图，确认两条通道均真实调用成功

## 不在本次范围

- Nano Banana/Gemini Native
- 每类多个 Key、轮换、负载均衡或自动故障切换
- Change2Pro 之外的多供应商连接管理
- 修改现有计费规则、任务并发数或图片后处理规则
