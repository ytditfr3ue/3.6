const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { allowedPaths, rateLimits, uploadLimits, cspConfig } = require('../config/security');

// 用于存储被封禁的IP
const bannedIPs = new Map();
const suspiciousAttempts = new Map();
const BAN_THRESHOLD = 3; // 降低到3次可疑请求就封禁
const BAN_DURATION = 7 * 24 * 60 * 60 * 1000; // 延长到7天
const SUSPICIOUS_ATTEMPT_EXPIRY = 60 * 60 * 1000; // 可疑记录1小时后过期

// 获取真实IP地址
const getRealIP = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress;
};

// 检查IP是否被封禁
const isIPBanned = (ip) => {
    if (bannedIPs.has(ip)) {
        const banInfo = bannedIPs.get(ip);
        if (Date.now() < banInfo.expiry) {
            return true;
        } else {
            bannedIPs.delete(ip);
        }
    }
    return false;
};

// 记录可疑请求
const recordSuspiciousAttempt = (ip) => {
    const now = Date.now();
    const attempts = suspiciousAttempts.get(ip) || { count: 0, firstAttempt: now };
    attempts.count++;
    attempts.lastAttempt = now;
    suspiciousAttempts.set(ip, attempts);

    // 如果达到阈值，封禁IP
    if (attempts.count >= BAN_THRESHOLD) {
        bannedIPs.set(ip, {
            expiry: now + BAN_DURATION,
            reason: 'Multiple suspicious requests'
        });
        suspiciousAttempts.delete(ip);
        console.log(`[${new Date().toISOString()}] IP banned: ${ip} for multiple suspicious requests`);
    }
};

// 清理过期的可疑记录
setInterval(() => {
    const now = Date.now();
    for (const [ip, attempts] of suspiciousAttempts.entries()) {
        if (now - attempts.firstAttempt > SUSPICIOUS_ATTEMPT_EXPIRY) {
            suspiciousAttempts.delete(ip);
        }
    }
}, 60 * 60 * 1000); // 每小时清理一次

// 恶意路径黑名单
const blacklistedPaths = [
    // WordPress
    '/wp-admin',
    '/wp-login',
    '/wp-content',
    '/wp-includes',
    '/xmlrpc.php',
    '/wp-config',
    '/setup-config.php',
    // PHPMyAdmin
    '/phpmyadmin',
    '/pma',
    '/myadmin',
    '/mysql',
    // 常见后门
    '/shell',
    '/admin.php',
    '/mysql',
    '/sql',
    '/database',
    '/db',
    '/jenkins',
    '/solr',
    // 其他常见扫描路径
    '/.env',
    '/config',
    '/install',
    '/setup',
    '/admin',
    '/login',
    '/temp',
    '/tmp',
    '/.git',
    '/.svn',
    '/actuator',
    '/api-docs',
    '/swagger',
    // PHP文件
    '.php',
    // ASP文件
    '.asp',
    '.aspx',
    // JSP文件
    '.jsp',
    '.jspx',
    // 配置文件
    '.config',
    '.conf',
    '.cfg',
    '.ini',
    // 数据库文件
    '.sql',
    '.db',
    '.sqlite',
    // 日志文件
    '.log',
    // 备份文件
    '.bak',
    '.backup',
    '.old',
    '.temp',
    '~',
    // 系统文件
    '/etc/passwd',
    '/windows/win.ini',
    // 特定应用
    '/laravel',
    '/symfony',
    '/drupal',
    '/joomla',
    '/magento',
    '/shopify',
    '/prestashop',
    '/opencart',
    '/moodle'
];

// 合法路径白名单
const whitelist = [
    // 静态资源
    /^\/css\//,
    /^\/js\//,
    /^\/images\//,
    /^\/uploads\//,
    /^\/socket\.io\//,
    /^\/api\//,
    // 管理员路径
    /^\/1101admin$/,
    // 页面
    /^\/loading\.html$/,
    /^\/favicon\.ico$/,
    // 聊天室路径 - 新格式
    /^\/[^/]+\/[a-zA-Z0-9]{3,7}$/,  // /:password/:roomId
    /^\/[a-zA-Z0-9]{3,7}$/          // /:roomId
];

// 路径验证中间件
const pathValidation = (req, res, next) => {
    const realIP = getRealIP(req);

    // 检查IP是否被封禁
    if (isIPBanned(realIP)) {
        console.log(`[${new Date().toISOString()}] Blocked banned IP: ${realIP}`);
        res.status(403).end();
        return;
    }

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
    if (pathParts.length === 2) {
        // Format: /:password/:roomId
        const roomId = pathParts[1];
        if (roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
            return next();
        }
    } else if (pathParts.length === 1) {
        // Format: /:roomId
        const roomId = pathParts[0];
        if (roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
            return next();
        }
    }

    // 5. 检查黑名单
    if (blacklistedPaths.some(badPath => 
        req.path.toLowerCase().includes(badPath.toLowerCase())
    )) {
        console.log(`[${new Date().toISOString()}] Blocked malicious path: ${req.method} ${req.path} from ${realIP}`);
        recordSuspiciousAttempt(realIP);
        res.status(444).end();
        return;
    }

    // 6. 不在白名单中的请求
    console.log(`[${new Date().toISOString()}] Unauthorized path: ${req.method} ${req.path} from ${realIP}`);
    res.status(444).end();
    return;
};

// 路径保护中间件
const pathProtection = (req, res, next) => {
    const realIP = getRealIP(req);
    if (req.path.includes('../') || req.path.includes('..\\')) {
        console.log(`[${new Date().toISOString()}] Path traversal attempt: ${req.method} ${req.path} from ${realIP}`);
        res.status(444).end();
        return;
    }
    next();
};

// 路径规范化中间件
const pathNormalization = (req, res, next) => {
    const realIP = getRealIP(req);
    req.url = req.url.replace(/\/+/g, '/');
    if (req.url.includes('../')) {
        console.log(`[${new Date().toISOString()}] Path normalization violation: ${req.method} ${req.path} from ${realIP}`);
        req.socket.destroy();
        return;
    }
    next();
};

// 文件类型验证中间件
const fileTypeValidation = (req, res, next) => {
    if (req.path.startsWith('/uploads/')) {
        const ext = path.extname(req.path).toLowerCase();
        if (!uploadLimits.allowedTypes.includes(ext)) {
            console.log(`[${new Date().toISOString()}] Invalid file type attempt: ${req.method} ${req.path} from ${req.ip}`);
            req.socket.destroy();
            return;
        }
    }
    next();
};

// 创建速率限制器
const createRateLimiter = (config) => rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    handler: (req, res) => {
        console.log(`[${new Date().toISOString()}] Rate limit exceeded: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
    }
});

// 文件上传验证中间件
const uploadValidation = (req, res, next) => {
    if (!req.file) return next();

    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (!uploadLimits.allowedTypes.includes(ext)) {
        fs.unlink(file.path, () => {});
        console.log(`[${new Date().toISOString()}] Invalid upload file type: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
        return;
    }

    if (file.size > uploadLimits.fileSize) {
        fs.unlink(file.path, () => {});
        console.log(`[${new Date().toISOString()}] Upload file size exceeded: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
        return;
    }

    next();
};

// 访问日志中间件
const accessLog = (req, res, next) => {
    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] ${req.method} ${req.url} ${req.ip}\n`;
    
    fs.appendFile(
        path.join(__dirname, '../logs/access.log'),
        log,
        (err) => {
            if (err) console.error('Error writing to access log:', err);
        }
    );
    
    next();
};

// 基本安全中间件
const csp = (req, res, next) => {
    // 首先进行路径验证
    if (!whitelist.some(pattern => pattern.test(req.path))) {
        console.log(`[${new Date().toISOString()}] Unauthorized access attempt: ${req.method} ${req.path} from ${req.ip}`);
        res.status(444).end();
        return;
    }
    next();
};

// 目录列表保护
const directoryProtection = (req, res, next) => {
    if (req.path.endsWith('/') && !req.path.startsWith('/api/')) {
        console.log(`[${new Date().toISOString()}] Directory listing attempt: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
        return;
    }
    next();
};

// 资源访问控制
const resourceProtection = (req, res, next) => {
    if (req.path.startsWith('/uploads/')) {
        const referer = req.headers.referer;
        if (!referer || (!referer.includes('/chat') && !referer.includes('/admin'))) {
            console.log(`[${new Date().toISOString()}] Unauthorized resource access: ${req.method} ${req.path} from ${req.ip}`);
            req.socket.destroy();
            return;
        }
    }
    next();
};

// API访问控制
const apiProtection = (req, res, next) => {
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    if (req.method === 'OPTIONS' || req.method === 'GET' || req.method === 'DELETE') {
        return next();
    }

    if (req.path === '/api/chat/upload' && req.method === 'POST') {
        if (!req.is('multipart/form-data') && !req.is('application/octet-stream')) {
            console.log(`[${new Date().toISOString()}] Invalid upload content type: ${req.method} ${req.path} from ${req.ip}`);
            req.socket.destroy();
            return;
        }
        return next();
    }

    if (req.method === 'POST' && !req.is('application/json')) {
        console.log(`[${new Date().toISOString()}] Invalid API content type: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
        return;
    }

    const origin = req.headers.origin;
    if (origin && !origin.includes(req.headers.host)) {
        console.log(`[${new Date().toISOString()}] Invalid origin: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
        return;
    }

    next();
};

// 错误处理中间件
const errorHandler = (err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Error:`, err);
    console.log(`[${new Date().toISOString()}] Error request: ${req.method} ${req.path} from ${req.ip}`);
    req.socket.destroy();
};

module.exports = {
    pathValidation,
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
    getRealIP,
    bannedIPs,
    isIPBanned
}; 