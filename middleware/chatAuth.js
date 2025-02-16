const ChatRoom = require('../models/ChatRoom');

const chatAuthMiddleware = async (req, res, next) => {
    const { roomId } = req.params;
    
    // 验证房间ID格式
    if (!roomId || !roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
        console.log(`[${new Date().toISOString()}] Invalid room ID format: ${roomId}`);
        res.status(444).end();
        return;
    }

    try {
        // 验证房间是否存在且处于活跃状态
        const room = await ChatRoom.findOne({ roomId, isActive: true });
        if (!room) {
            console.log(`[${new Date().toISOString()}] Room not found or inactive: ${roomId}`);
            res.status(444).end();
            return;
        }

        // 将房间信息添加到请求对象
        req.room = room;
        next();
    } catch (error) {
        console.error('Chat auth error:', error);
        res.status(444).end();
        return;
    }
};

module.exports = chatAuthMiddleware; 