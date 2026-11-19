# GroupMate 多人协作网站

这是一个可部署的 GroupMate MVP：账号注册/登录、创建多个项目、邀请码加入项目、项目成员隔离、任务创建/分配/状态更新/删除、云端数据和任务实时更新。

## 1. 创建 Supabase 数据库
1. 打开 https://supabase.com/dashboard 并创建项目。
2. 进入 SQL Editor，新建查询，把本目录 `supabase.sql` 全部复制进去并运行。
3. 进入 Project Settings → API，复制 Project URL 和 Publishable key。

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

浏览器打开终端显示的本地地址。

## 3. 发布为公开网址
1. 把整个项目文件夹上传到自己的 GitHub 仓库（不要上传真实 `.env`）。
2. 在 https://vercel.com/import 导入该仓库，Framework 选择 Vite。
3. 在 Vercel 项目 Settings → Environment Variables 添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
4. 点击 Deploy。Vercel 会生成可复制分享的 `*.vercel.app` 网址。
5. 在 Supabase Authentication → URL Configuration 中，把 Site URL 设置为 Vercel 网址。

## 重要说明
- 本项目不会预置陈、王、张等虚构账号或虚假项目数据。每个人注册自己的账号。
- 创建者创建项目后，把项目邀请码发给参与者。参与者登录后输入邀请码加入。
- 每个账号只会看到自己加入的项目；数据库通过 Supabase Row Level Security 控制访问。
- 邀请码目前是可重复使用的项目邀请码。拿到邀请码的人可以加入项目，请只发给项目成员。
- 当前为课程项目 MVP：暂不包含文件上传、评论、通知、成员移除、任务操作日志等功能。
- 正式收集真实用户数据前，请先用不同账号测试项目隔离和权限。
