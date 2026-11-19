# GroupMate 多人协作网站

这是一个可部署的 GroupMate MVP：账号注册/登录、创建多个项目、邀请码加入项目、项目成员隔离、任务创建/分配/编辑/状态更新/删除、云端数据和任务实时更新。

## v2 本次改动（第二轮用户体验后）

1. 每条任务发布后**可以修改**：任务名称、优先级、截止日期、负责人。
2. 负责人**可单选也可多选**（一条任务可以同时分给几位成员）。
3. 任务列表排序：**截止日期越近越靠前**，同一天按优先级高→低。
4. **已完成的任务自动沉到列表最下面**。
5. 状态变化自动记录**时间戳**：开始时间（转为"进行中"时）、完成时间（转为"已完成"时）。
6. 成员列表标注**组长 / 组员**身份，组长可以把组长转给其他成员。
7. 新增侧边栏**「我的任务」**：汇总所有项目里分配给自己的任务。
8. **截止日期是今天**的任务用红色字体标注（另外逾期任务会显示"已逾期"）。
9. 修掉国内必须挂 VPN 才能加载的问题：移除 Google Fonts 等境外资源、加载超时提示。
   详见 [`docs/国内访问部署指南.md`](docs/国内访问部署指南.md)。

---

## 1. 创建 / 升级 Supabase 数据库

> ⚠️ **重要**：v2 新增了 `assignee_ids`、`started_at`、`completed_at` 三个字段和 `set_project_leader` 函数。
> 无论新库还是旧库，都请重新在 SQL Editor 里运行一遍 SQL，否则任务会保存失败。

- **全新数据库**：进入 SQL Editor，新建查询，把项目根目录的 `supabase.sql` 全部复制进去并运行。
- **已经有数据的旧数据库**：运行 `supabase-upgrade-v2.sql`（只加字段和函数，不删数据）。
  想保持文件统一也可以直接跑 `supabase.sql`，它同样可以重复执行。

运行完进入 Project Settings → API，复制 Project URL 和 Publishable key。

## 2. 配置网站

1. 把 `.env.example` 复制为 `.env`。
2. 填入：
   - `VITE_SUPABASE_URL=你的 Project URL`
   - `VITE_SUPABASE_ANON_KEY=你的 Publishable key`
3. 安装 Node.js 20+，在项目目录运行：

```bash
npm install
npm run dev
```

浏览器打开终端显示的本地地址（已配置 `--host 0.0.0.0`，同一 WiFi 下手机也能打开）。

## 3. 发布为公开网址

1. 把整个项目文件夹上传到自己的 GitHub 仓库（不要上传真实 `.env`）。
2. 在 https://vercel.com/import 导入该仓库，Framework 选择 Vite。
3. 在 Vercel 项目 Settings → Environment Variables 添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
4. 点击 Deploy。Vercel 会生成 `*.vercel.app` 网址。
5. 在 Supabase Authentication → URL Configuration 中，把 Site URL 设置为部署网址。

> **大陆访问提示**：`*.vercel.app` 在国内访问不稳定，建议绑定自己的域名，
> 或把 `dist/` 放到 Cloudflare Pages / 阿里云 OSS 等托管，步骤见
> [`docs/国内访问部署指南.md`](docs/国内访问部署指南.md)。

## 重要说明

- 本项目不会预置陈、王、张等虚构账号或虚假项目数据。每个人注册自己的账号。
- 创建者创建项目后自动成为**组长**，把项目邀请码发给参与者；参与者登录后输入邀请码加入（**组员**）。
- 每个账号只会看到自己加入的项目；数据库通过 Supabase Row Level Security 控制访问。
- 邀请码目前是可重复使用的项目邀请码。拿到邀请码的人可以加入项目，请只发给项目成员。
- 当前为课程项目 MVP：暂不包含文件上传、评论、通知、成员移除、任务操作日志等功能。
- 正式收集真实用户数据前，请先用不同账号测试项目隔离和权限。
