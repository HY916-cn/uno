<div align="center">

---

**该版本尚未经过测试，请使用[经过测试的版本](https://github.com/HY916-cn/uno/tree/3767d35354db1b3abf5b24e4dd3db85f94dd511a)**

---

# UNO Online

**基于 Node.js + Express + WebSocket 的实时多人在线 UNO 网页游戏**

![Node](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-ws%208-010101?logo=socketdotio&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

前端采用纯原生 HTML/CSS/JavaScript，无任何第三方框架依赖，<br/>
配合毛玻璃（Glassmorphism）风格 UI，提供跨端游玩体验。

</div>

---

## 游戏特性

**三种游戏版本**

创建房间时可选择版本，全房沿用，规则详见游戏内「游戏说明」的分版本标签页。

- **原版**：经典 UNO 玩法，行动牌为 跳过 / 反转 / +2 / +4 / 万能牌。
- **翻转版（UNO Flip）**：112 张双面牌，浅色面（红黄蓝绿）与深色面（粉青橙紫）。打出 Flip 牌整副牌翻面，深色面行动牌更狠（抽 5、全员跳过、万能指定色抽等）；万能+2 / 万能指定色抽仅在手里没有同色牌时才能打出。
- **毫不留情（Show 'Em No Mercy）**：168 张牌，含四条特殊规则——**加牌叠加**（+2/+4/+6/+10 可用等值或更大的加牌叠上去转嫁罚牌）、**满 25 张淘汰**（淘汰到只剩一人即获胜）、**打 7 换手**、**打 0 全体传手**，另有 清色、全员跳过、万能反转+4、万能+6/+10、万能选色轮盘等超强行动牌。

三种版本共用相同的 QTE 抢答结算、观战、AI、大屏同机等机制。

**房间与对战**
- 支持创建 2–12 人的游戏房间，可设为「隐藏」或在公开大厅展示。
- 通过 3 位数房间号加入，或通过 URL 路由（`/:roomId`）直接分享邀请。

**AI 与断线接管**
- 房间内可添加 0–11 个内置 AI 机器人，机器人拥有独立随机昵称和拟真延迟出牌逻辑。
- 玩家对局中掉线时，系统自动将其转为 AI 托管，保障对局继续。

**观战模式**
- 房间已满或对局已开始时，新加入者自动成为观战者。
- 观战者可切换视角查看不同玩家手牌，并在聊天中发送带 `[观战]` 标识的消息。

**QTE 抢答结算**
- 玩家打出最后一张手牌时不立即结束，而是触发全场 QTE 抢答阶段。
- 系统生成随机码（如 `UNO-123`），手牌清空者需抢先输入正确验证码才能获胜；被他人或 AI 抢先输入则被抓获，罚抽 2 张牌继续。

**互动与彩蛋**
- 内置实时聊天室。
- 催促系统：带冷却时间的催促按钮，触发屏幕震动并调用 Web Audio API 生成提示音。
- 隐藏作弊模式：连点页面底部版权信息 10 次解锁，可打出不合法卡牌，服务端会将其转化为超级 +4 万能牌。

---

## 技术与安全实现

**前端**
- 纯 Vanilla JS 配合 CSS Variables 进行主题与逻辑控制。
- 使用 CSS3 Keyframes 配合 JavaScript 计算 DOM 坐标，实现卡牌飞行、发牌与结算动画。
- 原生媒体查询适配移动端，自动调整卡牌尺寸与布局。

**服务端安全与并发控制**
- WebSocket 限流：单连接最高 40 条/秒，超过自动断开；单条 WS 载荷上限 10 KB。
- HTTP 接口防刷：单 IP 每分钟最多 200 次 HTTP 请求。
- 挂机清理：`AFK_TIMEOUT_MS`（5 分钟）内无操作的连接自动踢出释放资源。
- 安全响应头：中间件自动注入 `X-Content-Type-Options`、`X-Frame-Options`、`X-XSS-Protection`、`Strict-Transport-Security`。
- 全局最多 2000 个 WebSocket 连接，并定时清理僵尸连接。

---

## 项目结构

- `server.js` — Express + WebSocket 服务端，承载全部房间、对局与状态逻辑
- `public/index.html` — 单文件前端应用（原生 HTML/CSS/JavaScript）
- `package.json` — 项目元信息与依赖

---

## 快速开始

### 环境要求

- Node.js ≥ 18

### 安装与启动

```bash
git clone https://github.com/HY916-cn/uno.git
cd uno
npm install
npm start
```

服务默认监听 `3000` 端口，访问 http://localhost:3000 即可。可通过环境变量 `PORT` 自定义端口：

```bash
PORT=8080 npm start
```

---

## 部署建议

### Nginx 反向代理

WebSocket 走 `/ws` 路径，需为其转发 `Upgrade` / `Connection` 头：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### PM2 进程守护

```bash
npm install -g pm2
pm2 start server.js --name uno
pm2 save
```

---

## License

本项目基于 [MIT](LICENSE) 协议开源。

2025~2026 ©HaoyuHuang All rights reserved.
