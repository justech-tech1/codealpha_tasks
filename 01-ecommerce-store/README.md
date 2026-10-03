# JUSTECH Market

A marketplace demo built with:

- Node.js
- Express
- MySQL / XAMPP
- Socket.IO
- HTML, CSS and JavaScript

## Project structure

```text
justech-marketplace/
├── public/
│   └── index.html
├── server.js
├── package.json
├── .env
├── .env.example
├── database.sql
├── seed.sql
├── .gitignore
└── README.md
```

## Setup

### 1. Install Node.js

Install Node.js LTS on your PC.

### 2. Start XAMPP

Start:

- MySQL

Apache is not required for this Node/Express version.

### 3. Create the database

Open phpMyAdmin:

```text
http://localhost/phpmyadmin
```

Import:

1. database.sql
2. seed.sql

The database name is:

```text
justech_marketplace
```

### 4. Create .env

Copy:

```text
.env.example
```

to:

```text
.env
```

Then set your MySQL password and a strong JWT secret.

### 5. Install packages

Open the project folder in VS Code terminal:

```bash
npm install
```

### 6. Start the server

```bash
npm start
```

You should see:

```text
JUSTECH Market running at http://localhost:5000
```

### 7. Open the website

Open:

```text
http://localhost:5000
```

Do NOT open public/index.html directly and do NOT use Live Server for this project.

The browser needs the Express API and Socket.IO server.

## Important

This version creates demo orders in MySQL but does not process real payments yet.

Do not commit `.env` or `node_modules` to GitHub.

## Main API areas

- Authentication
- Categories
- Products
- Cart
- Wishlist
- Orders
- Reviews
- Notifications
- Newsletter
- Shopping assistant
