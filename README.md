# 小程序后台（开封查对管理系统）

零第三方依赖的小程序后台：基于 Node.js 内置 `http` 与 `node:sqlite`，包含小程序 REST API、照片上传、开封查对记录审核和浏览器管理后台。

## 功能

- 管理后台：仪表盘、开封查对记录审核、用户管理、物品管理、订单管理、轮播图、系统设置
- 人员管理：维护查对人员信息（姓名、科室、岗位、手机号、在职状态）
- 药品管理：药品增删改（名称、规格、批号、厂家、有效期、数量、存放位置、状态）
- 权限管理：新增管理员账号、分配操作权限、停用账号；超级管理员拥有全部权限
- 开封查对记录：两人查对照片、车内药品物品摆放照片、一次性密码锁锁号照片，后台可预览、审核、驳回
- 照片上传：支持小程序相册选择或直接拍照，通过 `multipart/form-data` 上传，单张默认最大 8MB，支持 JPG/PNG/WebP/GIF
- 小程序端 API：微信登录（code2session）、首页、物品、查对记录、订单
- 数据存储：SQLite 单文件 `data/app.db`，首次启动自动建表并写入演示数据

## 环境要求

- Node.js 22.5 及以上（使用内置 `node:sqlite`）

## 启动

```bash
npm start
```

或者直接运行：

```bash
node server.js
```

Windows 下也可以双击 `start.bat`。默认地址：

- 管理后台：http://localhost:3000/admin
- 默认账号：`admin`
- 默认密码：`admin123`
- 演示审核员：`reviewer` / `reviewer123`（仅可查看仪表盘和查对记录，可审核）

端口和数据库可通过环境变量修改：

```bash
PORT=3000 HOST=0.0.0.0 DB_FILE=./data/app.db node server.js
```

## 微信登录配置

在后台“系统设置”中填写小程序 AppID 和 AppSecret，保存后小程序端 `POST /api/v1/auth/login` 会调用微信 `jscode2session` 换取 openid。

也可以使用环境变量 `WX_APPID`、`WX_SECRET`。未配置时进入开发模式：任意 `code` 会生成 `dev_` 开头的本地 openid，方便本地联调。

## 小程序端 API

基础地址：`http://<服务器地址>:3000/api/v1`

```text
POST   /auth/login          { code, nickname?, avatar? } -> { token, user }
GET    /config              上传开关、站点名称
GET    /home                轮播图 + 热销物品 + 分类
GET    /products            物品列表
GET    /products/:id        物品详情
GET    /personnel           查对人员列表（含科室、岗位）
POST   /uploads             上传单张照片（multipart，字段名 file）
POST   /records             提交开封查对记录（见下方字段）
GET    /records             我的查对记录
GET    /records/:id         查对记录详情
POST   /orders              创建订单
GET    /orders              我的订单
POST   /orders/:id/pay      模拟支付
```

除登录、首页等公开接口外，其余接口需要在请求头带 `Authorization: Bearer <token>`。

## 开封查对记录上传

小程序提交记录时，使用 `wx.uploadFile` 一次上传三张照片和表单字段：

```text
字段         说明
checkers     查对人员，如：王晨、李敏
vehicle_no   车牌号
lock_no      一次性密码锁锁号
remark       备注（可选）
check_photo  两人查对照片
cargo_photo  车内药品物品摆放照片
lock_photo   一次性密码锁锁号照片
```

也可以先分别调用 `POST /uploads` 得到照片地址，再用 JSON 提交 `POST /records`，字段为 `check_photo`、`cargo_photo`、`lock_photo`。三张照片和锁号均为必填。

照片保存在 `uploads/photos/` 目录，通过 `/uploads/...` 直接访问，后台查对记录页面会展示并支持点击放大。

## 后台管理 API

管理接口前缀为 `/api/admin`，登录后通过 Cookie 或 `Authorization: Bearer <token>` 鉴权：

```text
POST   /login               管理员登录
POST   /logout
GET    /me
POST   /password            修改密码
GET    /dashboard           仪表盘统计
GET    /users               用户列表
GET    /users/:id           用户详情
PATCH  /users/:id           修改用户
GET    /personnel           人员列表（支持 q/department/status 筛选）
POST   /personnel           新增人员
GET    /personnel/:id
PUT    /personnel/:id
DELETE /personnel/:id
GET    /medicines           药品列表（支持 q/status 筛选）
POST   /medicines           新增药品
GET    /medicines/:id
PUT    /medicines/:id
DELETE /medicines/:id
GET    /products            物品列表
POST   /products            新增物品
GET    /products/:id
PUT    /products/:id
DELETE /products/:id
GET    /records             查对记录列表（支持 status/q/start/end 筛选）
GET    /records/:id
PATCH  /records/:id         { status: submitted|verified|rejected, review_remark }
DELETE /records/:id
GET    /orders              订单列表
GET    /orders/:id
PATCH  /orders/:id/status
GET    /banners             轮播图
POST   /banners
PUT    /banners/:id
DELETE /banners/:id
GET    /settings            系统设置
PUT    /settings            保存设置
GET    /admins              管理员列表
POST   /admins              新增管理员（含权限）
PUT    /admins/:id          修改管理员/权限/状态/密码
DELETE /admins/:id          删除管理员
```

普通管理员通过权限列表控制模块访问：`records:view`、`records:review`、`users:manage`、`personnel:manage`、`medicines:manage`、`products:manage`、`orders:manage`、`banners:manage`、`settings:manage`、`admins:manage`。

## 目录结构

```text
server.js                HTTP 服务与静态资源
src/config.js            配置
src/db.js                SQLite 建表、种子数据
src/auth.js              密码哈希与令牌
src/session.js           登录态校验
src/wechat.js            微信 code2session
src/upload.js            multipart 解析与照片保存
src/admin-api.js         后台管理 API
src/miniapp-api.js       小程序 API
public/admin/            管理后台页面
scripts/smoke.mjs        接口冒烟测试
data/                    SQLite 数据文件（自动生成）
uploads/                 上传照片（自动生成）
```

## 冒烟测试

服务启动后运行：

```bash
node scripts/smoke.mjs
```

会依次验证管理员登录、仪表盘、微信登录、查对记录照片上传、订单创建与支付。
