const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  // 验证管理员账号密码
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign(
      { isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token });
  } else {
    res.status(401).json({ message: '用户名或密码错误' });
  }
});

router.get('/verify', (req, res) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ isValid: false });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    res.json({ isValid: true });
  } catch (err) {
    res.json({ isValid: false });
  }
});

// 修改账号密码
router.post('/change-credentials', authMiddleware, async (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;

  // 验证当前密码
  if (currentPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: '当前密码错误' });
  }

  try {
    // 读取.env文件
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    // 更新环境变量
    envContent = envContent.replace(
      /ADMIN_USERNAME=.*/,
      `ADMIN_USERNAME=${newUsername}`
    );
    envContent = envContent.replace(
      /ADMIN_PASSWORD=.*/,
      `ADMIN_PASSWORD=${newPassword}`
    );

    // 写入.env文件
    fs.writeFileSync(envPath, envContent);

    // 更新进程中的环境变量
    process.env.ADMIN_USERNAME = newUsername;
    process.env.ADMIN_PASSWORD = newPassword;

    res.json({ message: '账号密码修改成功' });
  } catch (error) {
    console.error('Change credentials error:', error);
    res.status(500).json({ message: '修改失败，请重试' });
  }
});

// 获取安全日志
router.get('/security-logs', authMiddleware, async (req, res) => {
    try {
        const logPath = path.join(__dirname, '../logs/access.log');
        const { type = 'all', limit = 100 } = req.query;
        
        if (!fs.existsSync(logPath)) {
            return res.json({ logs: [] });
        }

        const logs = fs.readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .reverse()
            .filter(line => {
                if (type === 'all') return true;
                if (type === 'blocked') return line.includes('Blocked malicious') || line.includes('Blocked banned');
                if (type === 'banned') return line.includes('IP banned');
                return true;
            })
            .slice(0, limit)
            .map(line => {
                const timestamp = line.match(/\[(.*?)\]/)?.[1] || '';
                const message = line.replace(/\[.*?\]\s*/, '');
                return { timestamp, message };
            });

        res.json({ logs });
    } catch (error) {
        console.error('Get security logs error:', error);
        res.status(500).json({ message: '로그를 불러올 수 없습니다' });
    }
});

// 获取被封禁的IP列表
router.get('/banned-ips', authMiddleware, (req, res) => {
    try {
        const security = require('../middleware/security');
        if (!security.bannedIPs) {
            return res.json({ bannedIPs: [] });
        }
        
        const bannedList = Array.from(security.bannedIPs.entries()).map(([ip, info]) => ({
            ip,
            expiry: info.expiry,
            reason: info.reason
        }));
        res.json({ bannedIPs: bannedList });
    } catch (error) {
        console.error('Get banned IPs error:', error);
        res.status(500).json({ message: '차단된 IP 목록을 불러올 수 없습니다' });
    }
});

module.exports = router; 