require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const connectDB = require('./config/db');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const adminAuthMiddleware = require('./middleware/adminAuth');
const chatAuthMiddleware = require('./middleware/chatAuth');
const { 
    pathProtection, 
    pathNormalization, 
    fileTypeValidation, 
    createRateLimiter, 
    uploadValidation, 
    accessLog, 
    csp, 
    errorHandler,
    directoryProtection,
    resourceProtection,
    apiProtection,
    pathValidation,
    getRealIP
} = require('./middleware/security');
const { rateLimits, requestLimits } = require('./config/security');
const { 
    requestSanitizer,
    resourceTokenHandler
} = require('./middleware/advancedSecurity');
const mongoose = require('mongoose');
const chatRoutes = require('./routes/chat');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 创建必要的目录
const logsDir = path.join(__dirname, 'logs');
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// 基础中间件
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: requestLimits.json }));
app.use(express.urlencoded({ extended: true, limit: requestLimits.urlencoded }));
app.use(express.raw({ limit: requestLimits.raw }));

// 添加调试日志
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.path}`);
    next();
});

// 静态文件路由（放在最前面，在所有安全中间件之前）
app.get('/loading.html', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'loading.html');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.error('Loading.html not found');
        res.status(404).send('Not found');
    }
});

app.get('/favicon.ico', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'favicon.ico');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.error('Favicon.ico not found');
        res.status(404).send('Not found');
    }
});

// 静态文件服务
app.use(express.static('public', {
    index: false  // 禁用自动服务 index.html
}));
app.use('/uploads', express.static('uploads'));

// 管理员页面路由 - 使用特定路径
app.get('/1101admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 根路径处理 - 返回444
app.get('/', (req, res) => {
    res.status(444).end();
});

// 添加路径验证中间件（移到这里，在管理员路由之后）
app.use(pathValidation);

// CSP和基本安全头
app.use(csp);

// 路径相关的安全中间件
app.use(pathNormalization);  // 路径规范化
app.use(pathProtection);  // 路径保护
app.use(fileTypeValidation);  // 文件类型验证

// Serve chat pages
app.get('/:password/:roomId', adminAuthMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/:roomId', chatAuthMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// 访问控制中间件
app.use(resourceProtection);  // 资源访问控制
app.use(apiProtection);  // API访问控制
app.use(directoryProtection);  // 目录保护

// 请求清理
app.use(requestSanitizer);

// 日志记录
app.use(accessLog);

// 速率限制
app.use(createRateLimiter(rateLimits.general));  // 全局限制
app.use('/api/auth', createRateLimiter(rateLimits.auth));  // 登录限制
app.use('/api/chat/upload', createRateLimiter(rateLimits.upload));  // 上传限制

// Socket.io instance
const socketHandler = require('./socket')(io);

// Routes - 将路由处理移到这里，在dropUndefinedRoutes之前
app.use('/api/auth', require('./routes/auth'));

// 注入socketHandler到路由
app.use('/api/chat', (req, res, next) => {
    req.socketHandler = socketHandler;
    next();
}, chatRoutes);

// 资源访问令牌路由
app.post('/api/resource-token', createRateLimiter(rateLimits.general), resourceTokenHandler);

// 添加路由丢弃中间件
app.use((req, res, next) => {
    const realIP = getRealIP(req);
    
    // 1. 允许所有API请求
    if (req.path.startsWith('/api/')) {
        return next();
    }

    // 2. 允许静态资源和基础页面
    if (req.path === '/' || 
        req.path.startsWith('/css/') || 
        req.path.startsWith('/js/') || 
        req.path.startsWith('/images/') ||
        req.path === '/loading.html' ||
        req.path === '/favicon.ico') {
        return next();
    }

    // 3. 允许Socket.IO和上传
    if (req.path.startsWith('/socket.io/') || 
        req.path.startsWith('/uploads/')) {
        return next();
    }

    // 4. 允许有效的聊天室链接
    const pathParts = req.path.split('/').filter(part => part);
    if (pathParts.length === 1 || pathParts.length === 2) {
        // 验证roomId格式
        const roomId = pathParts[pathParts.length - 1];
        if (roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
            return next();
        }
    }

    // 5. 所有其他请求直接丢弃
    console.log(`[${new Date().toISOString()}] Dropped request: ${req.method} ${req.path} from ${realIP}`);
    res.status(444).end();
});

// 404 handler - 移到最后
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Debug environment variables
console.log('Environment variables:');
console.log('- process.env.PORT:', process.env.PORT);
console.log('- process.env.NODE_ENV:', process.env.NODE_ENV);
console.log('- All env variables:', Object.keys(process.env));

// Ensure PORT is a number and use a fallback if not valid
const PORT = parseInt(process.env.PORT) || 10000;
if (isNaN(PORT)) {
    console.error('Invalid PORT value:', process.env.PORT);
    process.exit(1);
}

console.log('Starting server with configuration:');
console.log(`- PORT: ${PORT}`);
console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`- Platform: ${process.platform}`);

// 修改服务器启动代码
const startServer = async () => {
    try {
        // 首先连接数据库
        await connectDB();
        
        // 然后启动服务器
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server is running on port ${PORT}`);
            console.log(`Server is listening on all network interfaces (0.0.0.0:${PORT})`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

// Socket.IO 连接处理
io.on('connection', socket => {
    console.log('New client connected');

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: '서버 오류가 발생했습니다' });
}); 