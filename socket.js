const ChatRoom = require('./models/ChatRoom');
const Message = require('./models/Message');

module.exports = (io) => {
  const connectedUsers = new Map();

  io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('joinRoom', async ({ roomId, userType }) => {
      try {
        // 验证roomId格式
        if (!roomId || !roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
          socket.emit('roomError', { message: 'Invalid room ID format' });
          socket.disconnect(true);
          return;
        }

        const room = await ChatRoom.findOne({ roomId, isActive: true });
        if (!room) {
          socket.emit('roomError', { message: 'Room not found or inactive' });
          socket.disconnect(true);
          return;
        }

        socket.join(room._id.toString());
        connectedUsers.set(socket.id, {
          roomId: room._id.toString(),
          userType
        });
        
        // Update online count
        room.onlineCount += 1;
        room.lastActive = new Date();
        await room.save();
        
        io.to(room._id.toString()).emit('userJoined', { onlineCount: room.onlineCount });
      } catch (error) {
        console.error('Join room error:', error);
        socket.emit('roomError', { message: 'Failed to join room' });
        socket.disconnect(true);
      }
    });

    socket.on('message', async (data) => {
      try {
        const { content, type } = data;
        const userInfo = connectedUsers.get(socket.id);
        
        if (!userInfo) {
          socket.emit('roomError', { message: 'Not connected to any room' });
          socket.disconnect(true);
          return;
        }

        const room = await ChatRoom.findById(userInfo.roomId);
        if (!room || !room.isActive) {
          socket.emit('roomDeleted');
          socket.disconnect(true);
          return;
        }

        const message = new Message({
          roomId: room._id,
          content,
          type,
          sender: userInfo.userType
        });
        await message.save();

        room.lastActive = new Date();
        await room.save();

        // 向其他用户发送消息
        socket.broadcast.to(userInfo.roomId).emit('message', {
          ...message.toObject(),
          isSelf: false
        });
        
        // 向发送者发送消息
        socket.emit('message', {
          ...message.toObject(),
          isSelf: true
        });
      } catch (error) {
        console.error('Message error:', error);
        socket.emit('roomError', { message: 'Failed to send message' });
      }
    });

    socket.on('orderConfirmation', async (data) => {
      try {
        const userInfo = connectedUsers.get(socket.id);
        if (!userInfo || userInfo.userType !== 'user') {
          return;
        }

        const { messageId, confirmed } = data;
        const room = await ChatRoom.findById(userInfo.roomId);
        if (!room || !room.isActive) {
          socket.emit('roomDeleted');
          socket.disconnect(true);
          return;
        }

        // 广播订单确认状态变更给房间内所有用户
        io.to(userInfo.roomId).emit('orderStatusChanged', {
          messageId,
          confirmed,
          timestamp: new Date()
        });
      } catch (error) {
        console.error('Order confirmation error:', error);
      }
    });

    socket.on('disconnect', async () => {
      const userInfo = connectedUsers.get(socket.id);
      if (userInfo) {
        try {
          const room = await ChatRoom.findById(userInfo.roomId);
          if (room) {
            room.onlineCount = Math.max(0, room.onlineCount - 1);
            await room.save();
            io.to(userInfo.roomId).emit('userLeft', { onlineCount: room.onlineCount });
          }
        } catch (error) {
          console.error('Disconnect error:', error);
        }
        connectedUsers.delete(socket.id);
      }
    });
  });

  // 添加广播删除聊天室的方法
  return {
    broadcastRoomDeletion: async (roomId) => {
      try {
        const room = await ChatRoom.findOne({ roomId });
        if (room) {
          const roomIdStr = room._id.toString();
          // 向房间内所有用户广播删除消息
          io.to(roomIdStr).emit('roomDeleted');
          // 强制所有用户离开房间
          const sockets = await io.in(roomIdStr).fetchSockets();
          sockets.forEach(socket => {
            socket.leave(roomIdStr);
            connectedUsers.delete(socket.id);
          });
        }
      } catch (error) {
        console.error('Broadcast room deletion error:', error);
      }
    }
  };
}; 