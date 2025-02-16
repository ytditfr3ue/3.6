const crypto = require('crypto');
const { securityTokens } = require('../config/security');

// 生成资源访问令牌
const generateResourceToken = (req) => {
    const timestamp = Date.now();
    const data = `${req.ip}-${timestamp}-${securityTokens.resourceToken}`;
    return {
        token: crypto.createHash('sha256').update(data).digest('hex'),
        expires: timestamp + securityTokens.tokenExpiry
    };
};

// 验证资源访问令牌
const validateResourceToken = (token, timestamp) => {
    if (!token || !timestamp || timestamp < Date.now()) {
        return false;
    }
    const data = `${req.ip}-${timestamp}-${securityTokens.resourceToken}`;
    const expectedToken = crypto.createHash('sha256').update(data).digest('hex');
    return token === expectedToken;
};

// 高级目录保护
const advancedDirectoryProtection = (req, res, next) => {
    if (req.path.includes('..') || req.path.includes('./') || req.path.endsWith('/')) {
        console.log(`[${new Date().toISOString()}] Advanced directory traversal attempt: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
        return;
    }

    const blockedFiles = ['.htaccess', '.git', 'web.config', 'robots.txt', 'sitemap.xml'];
    if (blockedFiles.some(file => req.path.toLowerCase().includes(file))) {
        console.log(`[${new Date().toISOString()}] Blocked file access attempt: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
        return;
    }

    next();
};

// 高级资源保护
const advancedResourceProtection = (req, res, next) => {
    if (req.path.match(/\.(js|css|svg|png|jpg|jpeg|gif|woff|ttf)$/)) {
        const referer = req.headers.referer;
        const host = req.headers.host;
        
        if (!referer || !referer.includes(host)) {
            console.log(`[${new Date().toISOString()}] Invalid resource access attempt: ${req.method} ${req.path} from ${req.ip}`);
            req.socket.destroy();
            return;
        }
    }

    if (req.path.startsWith('/uploads/')) {
        if (!securityTokens.validateFileAccess(req.path)) {
            console.log(`[${new Date().toISOString()}] Invalid file access attempt: ${req.method} ${req.path} from ${req.ip}`);
            req.socket.destroy();
            return;
        }
    }

    next();
};

// 高级API保护
const advancedApiProtection = (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        if (!securityTokens.allowedMethods.includes(req.method)) {
            console.log(`[${new Date().toISOString()}] Invalid method attempt: ${req.method} ${req.path} from ${req.ip}`);
            req.socket.destroy();
            return;
        }

        if (req.method !== 'GET' && !req.is('application/json')) {
            console.log(`[${new Date().toISOString()}] Invalid content type: ${req.method} ${req.path} from ${req.ip}`);
            req.socket.destroy();
            return;
        }

        const origin = req.headers.origin;
        if (origin && !securityTokens.allowedDomains.some(domain => origin.includes(domain))) {
            console.log(`[${new Date().toISOString()}] Invalid origin access: ${req.method} ${req.path} from ${req.ip}`);
            req.socket.destroy();
            return;
        }
    }

    next();
};

// 请求清理中间件
const requestSanitizer = (req, res, next) => {
    try {
        if (req.query) {
            Object.keys(req.query).forEach(key => {
                req.query[key] = req.query[key].replace(/[<>]/g, '');
            });
        }

        if (req.body && typeof req.body === 'object') {
            Object.keys(req.body).forEach(key => {
                if (typeof req.body[key] === 'string') {
                    req.body[key] = req.body[key].replace(/[<>]/g, '');
                }
            });
        }
        next();
    } catch (error) {
        console.log(`[${new Date().toISOString()}] Request sanitization error: ${req.method} ${req.path} from ${req.ip}`);
        req.socket.destroy();
        return;
    }
};

// 资源令牌处理器 - 直接丢弃所有请求
const resourceTokenHandler = (req, res) => {
    console.log(`[${new Date().toISOString()}] Resource token request: ${req.method} ${req.path} from ${req.ip}`);
    req.socket.destroy();
};

module.exports = {
    advancedDirectoryProtection,
    advancedResourceProtection,
    advancedApiProtection,
    requestSanitizer,
    resourceTokenHandler
}; 