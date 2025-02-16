const mongoose = require('mongoose');

const paymentInfoSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        default: 'payment'
    },
    settings: {
        paymentImage: {
            type: String,
            default: ''
        },
        paymentName: {
            type: String
        },
        paymentAmount: String,
        paymentMethod: String,
        paymentStatus: String,
        title1: String,
        title2: String,
        title3: String,
        title4: String,
        title5: String,
        lastModified: {
            type: Date,
            default: Date.now
        }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('PaymentInfo', paymentInfoSchema); 