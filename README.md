# Chat Application

A real-time chat application with product information card sharing functionality.

## Features

- Real-time messaging using Socket.IO
- Admin and user chat interfaces
- Quick reply functionality for admins
- Product information card sharing
- Image upload and sharing
- Responsive design

## Tech Stack

- Node.js
- Express.js
- Socket.IO
- MongoDB
- HTML/CSS/JavaScript

## Installation

1. Clone the repository:
```bash
git clone [your-repository-url]
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your environment variables:
```env
PORT=3000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
```

4. Start the server:
```bash
npm start
```

## Usage

- Admin interface: Access `/[admin-password]/[room-id]`
- User interface: Access `/[room-id]`

## License

MIT 