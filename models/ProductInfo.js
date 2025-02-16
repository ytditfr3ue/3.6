const mongoose = require('mongoose');

const productInfoSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    settings: {
        productImage: {
            type: String,
            default: ''
        },
        productName: {
            type: String,
            required: true
        },
        subtitle1: String,
        subtitle2: String,
        subtitle3: String,
        lastModified: {
            type: Date,
            default: Date.now
        }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('ProductInfo', productInfoSchema);