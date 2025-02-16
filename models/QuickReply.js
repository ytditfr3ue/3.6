const mongoose = require('mongoose');

const quickReplySchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['left', 'right']
    },
    content: {
        type: String,
        required: true
    },
    replyType: {
        type: String,
        required: function() {
            return this.type === 'right';
        },
        enum: ['상품정보', '결제정보', '기타']
    },
    settings: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('QuickReply', quickReplySchema); 