const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const ChatRoom = require('../models/ChatRoom');
const Message = require('../models/Message');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const QuickReply = require('../models/QuickReply');
const { uploadLimits } = require('../config/security');
const { uploadValidation } = require('../middleware/security');
const ProductInfo = require('../models/ProductInfo');
const PaymentInfo = require('../models/PaymentInfo');

// 生成带user前缀的5位随机数字ID
function generateRoomId() {
    return 'user' + Math.floor(10000 + Math.random() * 90000).toString();
}

// 配置图片上传
const storage = multer.diskStorage({
    destination: uploadLimits.uploadDir,
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'image-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: uploadLimits.fileSize },
    fileFilter: function(req, file, cb) {
        // 检查MIME类型
        if (!uploadLimits.allowedMimeTypes.includes(file.mimetype)) {
            return cb(new Error('不支持的文件类型'));
        }
        cb(null, true);
    }
}).single('image');

// 创建聊天室
router.post('/rooms', authMiddleware, async (req, res) => {
    try {
        const { name, roomId } = req.body;

        // 验证房间名称
        if (!name || name.length < 2 || name.length > 50) {
            return res.status(400).json({ message: '채팅방 이름은 2~50자 사이여야 합니다' });
        }

        // 验证roomId格式
        if (!roomId || !roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
            return res.status(400).json({ message: '채팅방 ID는 3-7자리의 영문/숫자만 가능합니다' });
        }

        // 检查roomId是否已存在
        const existingRoom = await ChatRoom.findOne({ roomId });
        if (existingRoom) {
            return res.status(400).json({ message: '이미 사용 중인 채팅방 ID입니다' });
        }

        const chatRoom = new ChatRoom({
            name,
            roomId
        });

        await chatRoom.save();
        res.status(201).json(chatRoom);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 获取聊天室列表
router.get('/rooms', authMiddleware, async (req, res) => {
    try {
        const rooms = await ChatRoom.find({ isActive: true }).sort({ createdAt: -1 });
        res.json(rooms);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 获取单个聊天室
router.get('/rooms/:id', async (req, res) => {
    try {
        const room = await ChatRoom.findOne({ roomId: req.params.id });
        if (!room) {
            return res.status(404).json({ message: '채팅방을 찾을 수 없습니다' });
        }
        res.json(room);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 删除聊天室
router.delete('/rooms/:id', authMiddleware, async (req, res) => {
    try {
        const room = await ChatRoom.findById(req.params.id);
        if (!room) {
            return res.status(404).json({ message: '聊天室不存在' });
        }

        // 先广播删除消息
        if (req.socketHandler) {
            await req.socketHandler.broadcastRoomDeletion(room.roomId);
        }
        
        // 等待一小段时间确保消息发送
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 然后删除聊天室和相关消息
        await ChatRoom.findByIdAndDelete(req.params.id);
        await Message.deleteMany({ roomId: req.params.id });
        
        res.json({ message: '聊天室已删除', roomId: room.roomId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 获取聊天记录
router.get('/rooms/:id/messages', async (req, res) => {
    try {
        const room = await ChatRoom.findOne({ roomId: req.params.id });
        if (!room) {
            return res.status(404).json({ message: '채팅방을 찾을 수 없습니다' });
        }
        const messages = await Message.find({ roomId: room._id }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 上传图片
router.post('/upload', (req, res) => {
    upload(req, res, function(err) {
        if (err) {
            return res.status(400).json({ message: err.message });
        }
        
        if (!req.file) {
            return res.status(400).json({ message: '没有上传文件' });
        }

        // 使用sharp处理图片
        const processedImagePath = path.join(
            uploadLimits.uploadDir,
            'processed-' + req.file.filename
        );

        sharp(req.file.path)
            .resize(uploadLimits.maxWidth, uploadLimits.maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 80 })
            .toFile(processedImagePath)
            .then(() => {
                // 删除原始文件
                fs.unlink(req.file.path, () => {});
                const imageUrl = `/uploads/processed-${req.file.filename}`;
                res.json({ imageUrl });
            })
            .catch(error => {
                // 清理任何已上传的文件
                if (req.file) {
                    fs.unlink(req.file.path, () => {});
                }
                console.error('Upload error:', error);
                res.status(500).json({ message: error.message });
            });
    });
});

// 左侧快捷回复 API
router.get('/quick-replies/left', authMiddleware, async (req, res) => {
    try {
        const replies = await QuickReply.find({ type: 'left' }).sort('-createdAt');
        res.json(replies);
    } catch (error) {
        res.status(500).json({ message: '서버 오류가 발생했습니다' });
    }
});

router.post('/quick-replies/left', authMiddleware, async (req, res) => {
    try {
        const { content } = req.body;
        const newReply = new QuickReply({
            type: 'left',
            content
        });
        await newReply.save();
        res.json(newReply);
    } catch (error) {
        res.status(500).json({ message: '저장에 실패했습니다' });
    }
});

router.delete('/quick-replies/left/:id', authMiddleware, async (req, res) => {
    try {
        const reply = await QuickReply.findOneAndDelete({
            _id: req.params.id,
            type: 'left'
        });
        if (!reply) {
            return res.status(404).json({ message: '항목을 찾을 수 없습니다' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: '삭제에 실패했습니다' });
    }
});

// 右侧快捷回复 API
router.get('/quick-replies/right', authMiddleware, async (req, res) => {
    try {
        const replies = await QuickReply.find({ type: 'right' }).sort('-createdAt');
        res.json(replies);
    } catch (error) {
        res.status(500).json({ message: '서버 오류가 발생했습니다' });
    }
});

router.post('/quick-replies/right/:type', authMiddleware, async (req, res) => {
    try {
        const { type } = req.params;
        const data = req.body;
        
        const newReply = new QuickReply({
            type: 'right',
            replyType: type,
            content: data.name,
            settings: data.settings
        });
        
        await newReply.save();
        res.json(newReply);
    } catch (error) {
        res.status(500).json({ message: '저장에 실패했습니다' });
    }
});

router.delete('/quick-replies/right/:type/:id', authMiddleware, async (req, res) => {
    try {
        const reply = await QuickReply.findOneAndDelete({
            _id: req.params.id,
            type: 'right',
            replyType: req.params.type
        });
        if (!reply) {
            return res.status(404).json({ message: '항목을 찾을 수 없습니다' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: '삭제에 실패했습니다' });
        }
});

// 商品信息 API
router.get('/product-info/all', authMiddleware, async (req, res) => {
    try {
        const products = await ProductInfo.find().sort('-createdAt');
        const productsMap = {};
        // 只返回有效的商品信息
        products.forEach(product => {
            if (product && product.settings && product.settings.productName) {
                productsMap[product._id] = product;
            }
        });
        res.json(productsMap);
    } catch (error) {
        res.status(500).json({ message: '서버 오류가 발생했습니다' });
    }
});

router.get('/product-info/:id', authMiddleware, async (req, res) => {
    try {
        const product = await ProductInfo.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: '상품을 찾을 수 없습니다' });
        }
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: '서버 오류가 발생했습니다' });
    }
});

router.post('/product-info', authMiddleware, async (req, res) => {
    try {
        const { name, settings } = req.body;
        
        // 验证必要字段
        if (!name || !settings || !settings.productName) {
            return res.status(400).json({ message: '필수 입력 항목이 누락되었습니다' });
        }

        // 检查是否已存在相同名称的商品
        const existingProduct = await ProductInfo.findOne({ 'settings.productName': settings.productName });
        if (existingProduct) {
            return res.status(400).json({ message: '이미 존재하는 상품명입니다' });
        }

        const newProduct = new ProductInfo({
            name,
            settings: {
                ...settings,
                lastModified: new Date()
            }
        });
        
        await newProduct.save();
        res.json(newProduct);
    } catch (error) {
        console.error('Product info save error:', error);
        res.status(500).json({ message: '저장에 실패했습니다' });
    }
});

router.put('/product-info/:id', authMiddleware, async (req, res) => {
    try {
        const { settings, name } = req.body;
        
        // 验证请求数据
        if (!settings || !settings.productName) {
            return res.status(400).json({ message: '상품명은 필수 입력 항목입니다' });
        }

        // 检查ID格式
        if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ message: '잘못된 상품 ID입니다' });
        }

        // 检查是否存在相同名称的其他商品
        const existingProduct = await ProductInfo.findOne({
            'settings.productName': settings.productName,
            _id: { $ne: req.params.id }
        });
        
        if (existingProduct) {
            return res.status(400).json({ message: '이미 존재하는 상품명입니다' });
        }

        // 获取现有产品
        const currentProduct = await ProductInfo.findById(req.params.id);
        if (!currentProduct) {
            return res.status(404).json({ message: '상품을 찾을 수 없습니다' });
        }

        // 更新产品信息
        currentProduct.name = name || settings.productName;
        currentProduct.settings = {
            ...settings,
            lastModified: new Date()
        };

        // 保存更新
        await currentProduct.save();
        res.json(currentProduct);
    } catch (error) {
        console.error('Update product info error:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: '입력값이 올바르지 않습니다', details: error.message });
        }
        res.status(500).json({ message: '수정에 실패했습니다', details: error.message });
    }
});

router.delete('/product-info/:id', authMiddleware, async (req, res) => {
    try {
        const product = await ProductInfo.findByIdAndDelete(req.params.id);
        if (!product) {
            return res.status(404).json({ message: '상품을 찾을 수 없습니다' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: '삭제에 실패했습니다' });
    }
});

// 支付信息 API
router.get('/payment-info/all', authMiddleware, async (req, res) => {
    try {
        const payments = await PaymentInfo.find().sort('-createdAt');
        const paymentsMap = {};
        payments.forEach(payment => {
            if (payment && payment.settings && payment.settings.paymentName) {
                paymentsMap[payment._id] = payment;
            }
        });
        res.json(paymentsMap);
    } catch (error) {
        res.status(500).json({ message: '서버 오류가 발생했습니다' });
    }
});

router.post('/payment-info', authMiddleware, async (req, res) => {
    try {
        const { name, settings } = req.body;
        if (!name || !settings || !settings.paymentName) {
            return res.status(400).json({ message: '필수 입력 항목이 누락되었습니다' });
        }
        const newPayment = new PaymentInfo({
            name,
            settings: {
                ...settings,
                lastModified: new Date()
            }
        });
        await newPayment.save();
        res.json(newPayment);
    } catch (error) {
        res.status(500).json({ message: '저장에 실패했습니다' });
    }
});

router.put('/payment-info/:id', authMiddleware, async (req, res) => {
    try {
        const { settings } = req.body;
        const payment = await PaymentInfo.findById(req.params.id);
        if (!payment) {
            return res.status(404).json({ message: '결제 정보를 찾을 수 없습니다' });
        }
        payment.settings = {
            ...settings,
            lastModified: new Date()
        };
        await payment.save();
        res.json(payment);
    } catch (error) {
        res.status(500).json({ message: '수정에 실패했습니다' });
    }
});

router.delete('/payment-info/:id', authMiddleware, async (req, res) => {
    try {
        const payment = await PaymentInfo.findByIdAndDelete(req.params.id);
        if (!payment) {
            return res.status(404).json({ message: '결제 정보를 찾을 수 없습니다' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: '삭제에 실패했습니다' });
    }
});

// 支付标题 API
router.get('/payment/titles', authMiddleware, async (req, res) => {
    try {
        const titles = await PaymentInfo.findOne({ type: 'titles' });
        res.json(titles || {});
    } catch (error) {
        res.status(500).json({ message: '서버 오류가 발생했습니다' });
    }
});

router.post('/payment/titles', authMiddleware, async (req, res) => {
    try {
        const { title1, title2, title3, title4, title5 } = req.body;
        let titles = await PaymentInfo.findOne({ type: 'titles' });
        
        if (titles) {
            titles.settings = { title1, title2, title3, title4, title5 };
            await titles.save();
        } else {
            titles = new PaymentInfo({
                name: 'Payment Titles',
                type: 'titles',
                settings: { title1, title2, title3, title4, title5 }
            });
            await titles.save();
        }
        
        res.json(titles.settings);
    } catch (error) {
        res.status(500).json({ message: '저장에 실패했습니다' });
    }
});

module.exports = router; 