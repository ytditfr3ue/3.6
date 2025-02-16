const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
            return res.status(401).json({ message: '인증이 필요합니다' });
  }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userData = decoded;
    next();
    } catch (error) {
        return res.status(401).json({ message: '인증이 실패했습니다' });
  }
};