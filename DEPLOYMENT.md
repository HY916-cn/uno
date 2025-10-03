# UNO Online 部署指南

## 项目概述
UNO Online 是一个基于 Node.js 和 Socket.io 的多人在线 UNO 牌游戏。

## 系统要求
- Node.js 16.0 或更高版本
- npm 或 yarn 包管理器
- 支持 WebSocket 的现代浏览器

## 本地开发部署

### 1. 安装依赖
```bash
cd UNO
npm install
```

### 2. 启动开发服务器
```bash
node server.js
```
或者
```bash
npm start
```

### 3. 访问游戏
打开浏览器访问：`http://localhost:3000`
或
映射到服务器 IP 地址：`http://your-server-ip:3000`

## 生产环境部署

### 方式一：传统服务器部署

#### 1. 上传文件
将以下文件上传到服务器：
- `server.js`
- `index.html`
- `styles.css`
- `script.js`
- `package.json`
- `icon.png`
- `sound.ogg`

#### 2. 安装依赖
```bash
npm install --production
```

#### 3. 使用 PM2 管理进程（推荐）
```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start server.js --name "uno-online"

# 设置开机自启
pm2 startup
pm2 save
```

#### 4. 配置反向代理（Nginx）
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 方式二：Docker 部署

#### 1. 创建 Dockerfile
```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

#### 2. 构建和运行
```bash
# 构建镜像
docker build -t uno-online .

# 运行容器
docker run -d -p 3000:3000 --name uno-game uno-online
```

### 方式三：云平台部署

#### Heroku 部署
1. 创建 `Procfile` 文件：
```
web: node server.js
```

2. 部署命令：
```bash
git init
git add .
git commit -m "Initial commit"
heroku create your-app-name
git push heroku main
```

#### Vercel 部署
1. 安装 Vercel CLI：
```bash
npm install -g vercel
```

2. 部署：
```bash
vercel
```

## 环境变量配置

创建 `.env` 文件（可选）：
```env
PORT=3000
NODE_ENV=production
```

## 安全配置

### 1. 防火墙设置
确保只开放必要的端口（80, 443, 3000）

### 2. SSL 证书配置
使用 Let's Encrypt 或其他 SSL 证书提供商

### 3. 管理员密码
默认管理员密码的 SHA256 值已在代码中设置。如需修改：
1. 计算新密码的 SHA256 值
2. 在 `server.js` 中修改 `ADMIN_PASSWORD_HASH` 常量

## 性能优化

### 1. 启用 Gzip 压缩
```javascript
const compression = require('compression');
app.use(compression());
```

### 2. 静态文件缓存
```javascript
app.use(express.static('public', {
    maxAge: '1d'
}));
```

### 3. 数据库集成（可选）
对于大规模部署，建议集成 Redis 或 MongoDB 来存储游戏数据。

## 监控和日志

### 1. 日志配置
```javascript
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});
```

### 2. 健康检查端点
```javascript
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});
```

## 故障排除

### 常见问题

1. **端口被占用**
   ```bash
   lsof -ti:3000
   kill -9 <PID>
   ```

2. **WebSocket 连接失败**
   - 检查防火墙设置
   - 确认代理配置正确

3. **内存不足**
   - 增加服务器内存
   - 优化游戏数据存储

### 日志查看
```bash
# PM2 日志
pm2 logs uno-online

# Docker 日志
docker logs uno-game
```

## 备份和恢复

### 数据备份
游戏历史数据存储在内存中，重启后会丢失。对于生产环境，建议：
1. 集成持久化数据库
2. 定期备份游戏统计数据

### 配置备份
定期备份以下文件：
- `server.js`
- `package.json`
- Nginx 配置文件
- SSL 证书

## 扩展功能

### 1. 数据库集成
```javascript
// MongoDB 示例
const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/uno-online');
```

### 2. Redis 缓存
```javascript
const redis = require('redis');
const client = redis.createClient();
```

### 3. 用户认证
```javascript
const passport = require('passport');
// 添加用户登录系统
```

## 联系支持

如有部署问题，请检查：
1. Node.js 版本兼容性
2. 网络连接和端口配置
3. 服务器资源使用情况

---

**注意：** 本项目仅供个人使用，请确保遵守相关法律法规。

---

2521007819 HaoyuHuang.