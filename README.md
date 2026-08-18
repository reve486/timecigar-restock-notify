# TimeCigar 美纽杜补货提醒

公开订阅页 + 私有订阅服务 + GitHub Actions 库存检查。

目标商品：关达拉美拉 美纽杜 雪茄管（`TC-2100004299`）。库存检查直接访问商品详情组件；2026-08-18 验证结果为“已售罄”。

## 架构

| 部分 | 用途 | 是否公开 |
|---|---|---|
| GitHub Pages | 商品页和订阅表单 | 是 |
| Cloudflare Worker + D1 | 保存确认后的订阅邮箱、去重和退订 | 否，数据私有 |
| Resend | 确认订阅和补货邮件 | 否，API 密钥私有 |
| GitHub Actions | 每 10 分钟检查一次库存 | 工作流公开，密钥私有 |

订阅使用双确认：用户填邮箱后必须点击确认链接，才会收到补货提醒。邮箱地址、Resend 密钥和监控口令都不提交到此公开仓库。

## 先部署网页

1. 在仓库 **Settings → Pages** 中将 Source 设为 **GitHub Actions**。
2. 推送到 `main` 后，`Deploy public site` 工作流会发布网页。
3. 默认地址为 `https://reve486.github.io/timecigar-restock-notify/`。

若未配置私有订阅服务，网页会显示“订阅服务正在配置中”，不会收集邮箱。

## 配置邮件服务

推荐使用 [Resend](https://resend.com/)，因为它为程序化邮件提供 API、域名验证和退订能力。需要一个能作为发件人的已验证邮箱，例如：

```text
美纽杜补货提醒 <notify@你的域名.com>
```

不建议把个人 QQ/Gmail 登录密码放入自动化。QQ/163/Gmail 的 SMTP 授权码适合仅给自己发邮件；对公开订阅者，使用独立的发件域名和事务邮件服务更稳妥。

在 Resend 中完成：

1. 注册账户并验证一个自己控制的域名。
2. 添加 DNS 记录，验证发件域名。
3. 创建 API key。该 key 只放入 Cloudflare Worker Secret。

## 部署私有订阅服务

需要 Cloudflare 账户（免费套餐即可）和 Node.js 20+。

```powershell
cd worker
Copy-Item wrangler.example.jsonc wrangler.jsonc
npx wrangler login
npx wrangler d1 create timecigar-restock
```

将最后一条命令输出的 `database_id` 写入 `worker/wrangler.jsonc`。同时把 `APP_ORIGIN` 改为 GitHub Pages 的完整来源：

```text
https://reve486.github.io
```

初始化数据库：

```powershell
npx wrangler d1 execute timecigar-restock --remote --file schema.sql
```

依次设置 2 个机密值；输入时它们不会写入仓库：

```powershell
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MONITOR_TOKEN
```

`MONITOR_TOKEN` 应是长随机字符串，例如在 PowerShell 运行：

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

部署：

```powershell
npx wrangler deploy
```

记下 Worker 的公开 URL，例如 `https://timecigar-restock-api.<你的子域>.workers.dev`。

## 连接 GitHub Pages 和监控任务

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中新增这些 secrets：

| Secret | 值 |
|---|---|
| `SUBSCRIPTION_ENDPOINT` | `https://...workers.dev/api/subscribe` |
| `MONITOR_ENDPOINT` | Worker 根地址，例如 `https://...workers.dev` |
| `MONITOR_TOKEN` | 与 Worker 中相同的随机口令 |

然后在 Actions 页面运行两次：

1. **Deploy public site**，将订阅 API 地址写入网页配置。
2. **Check TimeCigar stock**，检查一次库存并把当前“无货”状态同步到 Worker。

之后 GitHub Actions 每 10 分钟检查一次。只有库存从非“有货”转变为“有货”时，Worker 才会向已确认订阅者发送一封邮件。

## 本地检查

库存脚本没有第三方 Python 依赖：

```powershell
python monitor/monitor.py
```

若未设置 `MONITOR_ENDPOINT` 和 `MONITOR_TOKEN`，它只输出库存状态，不会发送通知。

## 重要限制

- GitHub Actions 的定时任务不是严格实时服务；GitHub 负载较高时可能延后。10 分钟是对网站压力和提醒及时性的折中。
- 补货邮件只是提示，最终库存、价格和配送资格以 TimeCigar 商品页为准。
- 发送商业或大量邮件前，应遵守收件人所在地的反垃圾邮件规则；双确认和退订链接不应删除。
