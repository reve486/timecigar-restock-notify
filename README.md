# TimeCigar 美纽杜补货提醒

给自己和少量朋友使用的 TimeCigar 库存监控与 QQ 邮箱提醒。

当前监控 3 件商品：

| 商品 | 商品编号 | 当前状态 |
|---|---|---|
| 美纽杜 雪茄管，2 x 25 支 / 盒 | `TC-2100004299` | 无货 |
| 美纽杜，40 支 | `TC-2100007413` | 无货 |
| 美纽杜 雪茄管，15 x 3 支 / 盒 | `TC-2100004909` | 无货 |

页面会读取仓库中公开的库存状态文件；其中不含邮箱、邀请码或任何密钥。

## 架构

| 部分 | 用途 | 隐私 |
|---|---|---|
| GitHub Pages | 公开状态页和邀请码订阅表单 | 公开，不保存邮箱 |
| Cloudflare Worker + D1 | 保存朋友的订阅邮箱和退订令牌 | 私有 |
| GitHub Actions | 每 5 分钟检查库存，并通过 QQ SMTP 发信 | 密钥仅存 GitHub Secrets |

邀请码订阅适合小范围朋友使用。网站不做公开注册，也不会显示或泄露订阅者邮箱。

## 你需要准备的内容

1. 一个 QQ 邮箱作为发件箱。
2. QQ 邮箱的 SMTP 授权码，不是 QQ 登录密码。
3. 一个免费的 Cloudflare 账户，用于保存订阅列表。
4. 一段只发给朋友的邀请码，例如随机的 16 位字母数字字符串。

## 1. 取得 QQ SMTP 授权码

在 QQ 邮箱网页版中：

1. 进入 **设置 → 账户**。
2. 找到 **POP3/IMAP/SMTP 服务**，开启 SMTP 服务。
3. 按 QQ 的验证流程生成授权码。

不要把授权码粘贴到仓库、网页、聊天记录或 `config.js`；它只会被填入 GitHub Secret。

## 2. 部署订阅服务

先登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。电脑需安装 Node.js 20+ 后，在本仓库运行：

```powershell
cd worker
Copy-Item wrangler.example.jsonc wrangler.jsonc
npx wrangler login
npx wrangler d1 create timecigar-restock
```

把最后一条命令输出的 `database_id` 写入 `worker/wrangler.jsonc`。初始化数据库：

```powershell
npx wrangler d1 execute timecigar-restock --remote --file schema.sql
```

如果数据库已经存在，在部署本版本前再执行一次 `worker/migrations/0001_add_welcome_sent_at.sql`（Cloudflare D1 控制台或 Wrangler 均可），用于记录订阅成功邮件是否已经发送。

设置两个 Worker Secret：

```powershell
npx wrangler secret put MONITOR_TOKEN
npx wrangler secret put SUBSCRIPTION_CODE
```

- `MONITOR_TOKEN`：长随机字符串；它要与 GitHub Secret 的同名值一致。
- `SUBSCRIPTION_CODE`：发给朋友的邀请码；它只存于 Worker。

部署 Worker：

```powershell
npx wrangler deploy
```

记下生成的 Worker 根地址，例如 `https://timecigar-restock-api.<你的子域>.workers.dev`。

## 3. 设置 GitHub Secrets

在仓库 **Settings → Secrets and variables → Actions** 新建以下 Secrets：

| Secret | 值 |
|---|---|
| `SUBSCRIPTION_ENDPOINT` | `https://...workers.dev/api/subscribe` |
| `MONITOR_ENDPOINT` | `https://...workers.dev` |
| `MONITOR_TOKEN` | 与 Worker 中相同的随机字符串 |
| `QQ_SMTP_USERNAME` | 你的完整 QQ 邮箱地址 |
| `QQ_SMTP_AUTH_CODE` | QQ 生成的 SMTP 授权码 |

然后运行 Actions 中的 **Deploy public site**。网页会启用邮箱和邀请码表单。

## 4. 发送测试邮件

在 GitHub Actions 中打开 **Check TimeCigar stock → Run workflow**，勾选 `test_email`。成功后，QQ 发件邮箱会收到一封测试邮件。

之后无需手动操作。工作流每 5 分钟检查一次；新订阅者会收到一封“恭喜你订阅成功”的确认邮件，任意商品由无货转为有货时，会给每位订阅者单独发送邮件，收件人互相看不到邮箱。

## 限制

- QQ SMTP 适合少量个人提醒。请不要把邀请码公开发布，也不要用于大量群发。
- GitHub Actions 免费计划的最短计划周期是 5 分钟，且定时任务可能延后，不能保证秒级或实时抢购；需要更快响应时应使用常驻服务器或专门的监控服务。
- 补货邮件只是提示；库存、价格和购买资格以 TimeCigar 页面为准。
