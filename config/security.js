const path = require('path');
const crypto = require('crypto');

// 生成随机token
const generateRandomToken = () => crypto.randomBytes(32).toString('hex');

// 允许的路径配置
const allowedPaths = {
    pages: [
        '^/$',  // 根路径-管理员登录
        '^/admin/[^/]+/user\\d{5}$',  // 管理员聊天室
        '^/help/user\\d{5}$',  // 用户聊天室
        '^/favicon\\.ico$'  // favicon
    ],
    api: [
        '^/api/auth/',
        '^/api/chat/',
        '^/api/resource-token',
        '^/socket\\.io/',
        '^/css/',
        '^/js/',
        '^/images/',
        '^/uploads/'
    ]
};

// 速率限制配置
const rateLimits = {
    general: {
        windowMs: 15 * 60 * 1000,
        max: 1000,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false
    },
    auth: {
        windowMs: 60 * 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false
    },
    upload: {
        windowMs: 60 * 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false
    }
};

// 文件上传配置
const uploadLimits = {
    fileSize: 5 * 1024 * 1024,
    allowedTypes: ['.jpg', '.jpeg', '.png', '.gif', '.svg'],
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml'],
    uploadDir: path.join(__dirname, '../uploads'),
    maxWidth: 1920,
    maxHeight: 1080,
    // 添加文件名随机化
    getFileName: (originalname) => {
        const ext = path.extname(originalname);
        return `${generateRandomToken()}${ext}`;
    }
};

// CSP配置
const cspConfig = {
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://www.gstatic.com", "https://translate.googleapis.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://www.gstatic.com", "https://translate.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://www.gstatic.com", "https://translate.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://www.gstatic.com"],
        connectSrc: ["'self'", "ws:", "wss:", "https://www.gstatic.com", "https://translate.googleapis.com"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: []
    }
};

// 请求大小限制
const requestLimits = {
    json: '1mb',
    urlencoded: '1mb',
    raw: '5mb'
};

// 安全令牌配置
const securityTokens = {
    // 用于验证静态资源访问的token
    resourceToken: generateRandomToken(),
    // token过期时间（1小时）
    tokenExpiry: 3600000,
    // 允许的域名
    allowedDomains: ['localhost', '127.0.0.1'],
    // 允许的HTTP方法
    allowedMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    // 文件访问验证
    validateFileAccess: (filename) => {
        // 检查文件扩展名
        const ext = path.extname(filename).toLowerCase();
        return uploadLimits.allowedTypes.includes(ext);
    }
};

// 路径验证正则表达式
const pathRegex = {
    adminChatRoom: /^\/admin\/[^/]+\/user\d{5}$/,
    userChatRoom: /^\/help\/user\d{5}$/,
    roomId: /^user\d{5}$/
};

module.exports = {
    allowedPaths,
    rateLimits,
    uploadLimits,
    cspConfig,
    requestLimits,
    securityTokens,
    pathRegex
}; 