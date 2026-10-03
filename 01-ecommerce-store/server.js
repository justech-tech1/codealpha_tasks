require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const cookie = require("cookie");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 5000);
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET === "replace_this_with_a_long_random_secret") {
    console.warn("WARNING: Set a strong JWT_SECRET in your .env file.");
}

const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "justech_marketplace",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const io = new Server(server, {
    cors: {
        origin: CLIENT_URL,
        credentials: true
    }
});

app.use(
    helmet({
        contentSecurityPolicy: false
    })
);

app.use(
    cors({
        origin: CLIENT_URL,
        credentials: true
    })
);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use(
    "/api",
    rateLimit({
        windowMs: 60 * 1000,
        max: 200,
        standardHeaders: true,
        legacyHeaders: false
    })
);

const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
});

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

function getTokenFromRequest(req) {
    return req.cookies?.tw || "";
}

function requireAuth(req, res, next) {
    try {
        req.user = jwt.verify(getTokenFromRequest(req), JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: "Login required." });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Access denied." });
        }
        next();
    };
}

function setAuthCookie(res, user) {
    const token = jwt.sign(
        {
            id: user.id,
            role: user.role,
            name: user.name
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );

    res.cookie("tw", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000
    });
}

function orderNumber() {
    return "JM-" + Date.now().toString(36).toUpperCase();
}

const PRODUCT_FIELDS = `
    p.id,
    p.title,
    p.slug,
    p.description,
    p.specs,
    p.price,
    p.old_price,
    p.stock,
    p.image_url,
    p.rating,
    p.review_count,
    p.created_at,
    s.id AS seller_id,
    s.store_name,
    s.slug AS store_slug,
    s.verified AS seller_verified,
    c.name AS category_name,
    c.slug AS category_slug
`;

const PRODUCT_FROM = `
    FROM products p
    JOIN sellers s ON s.id = p.seller_id
    JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'active'
`;

function sendServerError(res, error) {
    console.error(error);
    return res.status(500).json({ error: "Server error." });
}

/* =========================
   Authentication
========================= */

app.post(
    "/api/auth/register",
    authLimit,
    asyncRoute(async (req, res) => {
        const name = String(req.body.name || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (!name || name.length > 120) {
            return res.status(400).json({ error: "Enter a valid name." });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: "Enter a valid email." });
        }

        if (password.length < 8) {
            return res.status(400).json({
                error: "Password must be at least 8 characters."
            });
        }

        const [existing] = await db.query(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            [email]
        );

        if (existing.length) {
            return res.status(409).json({
                error: "Email already registered."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await db.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES (?, ?, ?)`,
            [name, email, passwordHash]
        );

        const user = {
            id: result.insertId,
            name,
            email,
            role: "customer"
        };

        setAuthCookie(res, user);
        res.status(201).json(user);
    })
);

app.post(
    "/api/auth/login",
    authLimit,
    asyncRoute(async (req, res) => {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        const [rows] = await db.query(
            "SELECT * FROM users WHERE email = ? LIMIT 1",
            [email]
        );

        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({
                error: "Invalid email or password."
            });
        }

        setAuthCookie(res, user);

        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        });
    })
);

app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("tw", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
    });

    res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
    res.json(req.user);
});

/* =========================
   Categories
========================= */

app.get(
    "/api/categories",
    asyncRoute(async (req, res) => {
        const [rows] = await db.query(`
            SELECT id, name, slug, parent_id
            FROM categories
            ORDER BY name ASC
        `);

        res.json(rows);
    })
);

/* =========================
   Products
========================= */

app.get(
    "/api/products",
    asyncRoute(async (req, res) => {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
        const offset = (page - 1) * limit;

        const params = [];
        let where = PRODUCT_FROM;

        const q = String(req.query.q || "").trim();

        if (q) {
            where += `
                AND (
                    MATCH(p.title, p.description)
                    AGAINST(? IN NATURAL LANGUAGE MODE)
                    OR p.title LIKE ?
                    OR p.description LIKE ?
                )
            `;

            params.push(q, `%${q}%`, `%${q}%`);
        }

        if (req.query.category) {
            where += `
                AND c.slug = ?
            `;
            params.push(String(req.query.category));
        }

        if (req.query.min) {
            const min = Number(req.query.min);

            if (Number.isFinite(min) && min >= 0) {
                where += " AND p.price >= ?";
                params.push(min);
            }
        }

        if (req.query.max) {
            const max = Number(req.query.max);

            if (Number.isFinite(max) && max >= 0) {
                where += " AND p.price <= ?";
                params.push(max);
            }
        }

        const sortMap = {
            newest: "p.created_at DESC",
            price_asc: "p.price ASC",
            price_desc: "p.price DESC",
            rating: "p.rating DESC, p.review_count DESC"
        };

        const sort = sortMap[String(req.query.sort || "newest")]
            || sortMap.newest;

        const [[countRow]] = await db.query(
            `SELECT COUNT(*) AS total ${where}`,
            params
        );

        const [products] = await db.query(
            `SELECT ${PRODUCT_FIELDS}
             ${where}
             ORDER BY ${sort}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const total = Number(countRow.total || 0);

        res.json({
            items: products,
            total,
            page,
            limit,
            pages: Math.max(1, Math.ceil(total / limit))
        });
    })
);

app.get(
    "/api/products/:slug",
    asyncRoute(async (req, res) => {
        const [rows] = await db.query(
            `SELECT ${PRODUCT_FIELDS}
             ${PRODUCT_FROM}
             AND p.slug = ?
             LIMIT 1`,
            [req.params.slug]
        );

        if (!rows.length) {
            return res.status(404).json({
                error: "Product not found."
            });
        }

        const product = rows[0];

        const [images] = await db.query(
            `SELECT id, image_url, sort_order, is_primary
             FROM product_images
             WHERE product_id = ?
             ORDER BY is_primary DESC, sort_order ASC, id ASC`,
            [product.id]
        );

        const [reviews] = await db.query(
            `SELECT
                r.id,
                r.rating,
                r.title,
                r.comment,
                r.created_at,
                u.name
             FROM reviews r
             JOIN users u ON u.id = r.user_id
             WHERE r.product_id = ?
             ORDER BY r.created_at DESC
             LIMIT 20`,
            [product.id]
        );

        res.json({
            ...product,
            images,
            reviews
        });
    })
);

/* =========================
   Cart
========================= */

app.get(
    "/api/cart",
    requireAuth,
    asyncRoute(async (req, res) => {
        const [items] = await db.query(`
            SELECT
                c.product_id,
                c.quantity,
                p.title,
                p.price,
                p.stock,
                p.image_url
            FROM cart_items c
            JOIN products p ON p.id = c.product_id
            WHERE c.user_id = ?
            ORDER BY c.id DESC
        `, [req.user.id]);

        res.json(items);
    })
);

app.post(
    "/api/cart",
    requireAuth,
    asyncRoute(async (req, res) => {
        const productId = Number(req.body.product_id);
        const quantity = Math.min(
            99,
            Math.max(1, Number(req.body.quantity) || 1)
        );

        if (!Number.isInteger(productId) || productId <= 0) {
            return res.status(400).json({
                error: "Invalid product."
            });
        }

        const [products] = await db.query(
            "SELECT id, stock FROM products WHERE id = ? AND status = 'active' LIMIT 1",
            [productId]
        );

        if (!products.length) {
            return res.status(404).json({
                error: "Product not found."
            });
        }

        if (products[0].stock < quantity) {
            return res.status(400).json({
                error: "Not enough stock available."
            });
        }

        await db.query(
            `INSERT INTO cart_items (user_id, product_id, quantity)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
             quantity = LEAST(99, quantity + VALUES(quantity))`,
            [req.user.id, productId, quantity]
        );

        res.json({ ok: true });
    })
);

app.patch(
    "/api/cart/:productId",
    requireAuth,
    asyncRoute(async (req, res) => {
        const productId = Number(req.params.productId);
        const quantity = Number(req.body.quantity);

        if (!Number.isInteger(productId) || !Number.isInteger(quantity)) {
            return res.status(400).json({
                error: "Invalid cart request."
            });
        }

        if (quantity <= 0) {
            await db.query(
                "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?",
                [req.user.id, productId]
            );

            return res.json({ ok: true });
        }

        const [products] = await db.query(
            "SELECT stock FROM products WHERE id = ? AND status = 'active'",
            [productId]
        );

        if (!products.length) {
            return res.status(404).json({
                error: "Product not found."
            });
        }

        if (quantity > products[0].stock) {
            return res.status(400).json({
                error: "Requested quantity exceeds available stock."
            });
        }

        await db.query(
            `UPDATE cart_items
             SET quantity = ?
             WHERE user_id = ? AND product_id = ?`,
            [Math.min(99, quantity), req.user.id, productId]
        );

        res.json({ ok: true });
    })
);

app.delete(
    "/api/cart/:productId",
    requireAuth,
    asyncRoute(async (req, res) => {
        await db.query(
            "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?",
            [req.user.id, Number(req.params.productId)]
        );

        res.json({ ok: true });
    })
);

/* =========================
   Wishlist
========================= */

app.get(
    "/api/wishlist",
    requireAuth,
    asyncRoute(async (req, res) => {
        const [rows] = await db.query(`
            SELECT
                p.id,
                p.title,
                p.slug,
                p.price,
                p.old_price,
                p.stock,
                p.image_url,
                p.rating,
                p.review_count,
                s.store_name
            FROM wishlist_items w
            JOIN products p ON p.id = w.product_id
            JOIN sellers s ON s.id = p.seller_id
            WHERE w.user_id = ?
            ORDER BY w.created_at DESC
        `, [req.user.id]);

        res.json(rows);
    })
);

app.post(
    "/api/wishlist/:productId",
    requireAuth,
    asyncRoute(async (req, res) => {
        const productId = Number(req.params.productId);

        await db.query(
            `INSERT IGNORE INTO wishlist_items (user_id, product_id)
             VALUES (?, ?)`,
            [req.user.id, productId]
        );

        res.json({ ok: true });
    })
);

app.delete(
    "/api/wishlist/:productId",
    requireAuth,
    asyncRoute(async (req, res) => {
        await db.query(
            "DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?",
            [req.user.id, Number(req.params.productId)]
        );

        res.json({ ok: true });
    })
);

/* =========================
   Orders / Checkout
========================= */

app.post(
    "/api/checkout",
    requireAuth,
    asyncRoute(async (req, res) => {
        const address = String(req.body.address || "").trim();

        if (address.length < 8 || address.length > 255) {
            return res.status(400).json({
                error: "Enter a valid delivery address."
            });
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [items] = await connection.query(`
                SELECT
                    c.product_id,
                    c.quantity,
                    p.price,
                    p.stock
                FROM cart_items c
                JOIN products p ON p.id = c.product_id
                WHERE c.user_id = ?
                FOR UPDATE
            `, [req.user.id]);

            if (!items.length) {
                throw new Error("Your cart is empty.");
            }

            for (const item of items) {
                if (item.stock < item.quantity) {
                    throw new Error(
                        "One or more products no longer have enough stock."
                    );
                }
            }

            const total = items.reduce(
                (sum, item) =>
                    sum + Number(item.price) * Number(item.quantity),
                0
            );

            const number = orderNumber();

            const [order] = await connection.query(
                `INSERT INTO orders
                    (order_number, user_id, total, currency, address)
                 VALUES (?, ?, ?, 'NGN', ?)`,
                [number, req.user.id, total, address]
            );

            for (const item of items) {
                await connection.query(
                    `INSERT INTO order_items
                        (order_id, product_id, quantity, unit_price)
                     VALUES (?, ?, ?, ?)`,
                    [
                        order.insertId,
                        item.product_id,
                        item.quantity,
                        item.price
                    ]
                );

                await connection.query(
                    `UPDATE products
                     SET stock = stock - ?
                     WHERE id = ?`,
                    [item.quantity, item.product_id]
                );
            }

            await connection.query(
                "DELETE FROM cart_items WHERE user_id = ?",
                [req.user.id]
            );

            await connection.query(
                `INSERT INTO notifications (user_id, body)
                 VALUES (?, ?)`,
                [req.user.id, `Order ${number} has been placed.`]
            );

            await connection.commit();

            io.to(`user:${req.user.id}`).emit("notification", {
                body: `Order ${number} has been placed.`
            });

            res.status(201).json({
                order_number: number,
                total,
                currency: "NGN"
            });
        } catch (error) {
            await connection.rollback();

            if (
                error.message === "Your cart is empty." ||
                error.message.includes("no longer have enough stock")
            ) {
                return res.status(400).json({
                    error: error.message
                });
            }

            return sendServerError(res, error);
        } finally {
            connection.release();
        }
    })
);

app.get(
    "/api/orders",
    requireAuth,
    asyncRoute(async (req, res) => {
        const [orders] = await db.query(`
            SELECT
                id,
                order_number,
                total,
                currency,
                address,
                status,
                created_at
            FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 100
        `, [req.user.id]);

        res.json(orders);
    })
);

/* =========================
   Reviews
========================= */

app.post(
    "/api/products/:productId/reviews",
    requireAuth,
    asyncRoute(async (req, res) => {
        const productId = Number(req.params.productId);
        const rating = Number(req.body.rating);
        const title = String(req.body.title || "").trim().slice(0, 150);
        const comment = String(req.body.comment || "").trim();

        if (
            !Number.isInteger(productId) ||
            !Number.isInteger(rating) ||
            rating < 1 ||
            rating > 5
        ) {
            return res.status(400).json({
                error: "Rating must be between 1 and 5."
            });
        }

        if (!comment) {
            return res.status(400).json({
                error: "Write a review comment."
            });
        }

        const [existing] = await db.query(
            "SELECT id FROM reviews WHERE user_id = ? AND product_id = ?",
            [req.user.id, productId]
        );

        if (existing.length) {
            return res.status(409).json({
                error: "You already reviewed this product."
            });
        }

        await db.query(
            `INSERT INTO reviews
                (user_id, product_id, rating, title, comment)
             VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, productId, rating, title || null, comment]
        );

        const [[stats]] = await db.query(
            `SELECT
                ROUND(AVG(rating), 1) AS rating,
                COUNT(*) AS review_count
             FROM reviews
             WHERE product_id = ?`,
            [productId]
        );

        await db.query(
            `UPDATE products
             SET rating = ?, review_count = ?
             WHERE id = ?`,
            [
                Number(stats.rating || 0),
                Number(stats.review_count || 0),
                productId
            ]
        );

        res.status(201).json({ ok: true });
    })
);

/* =========================
   Notifications
========================= */

app.get(
    "/api/notifications",
    requireAuth,
    asyncRoute(async (req, res) => {
        const [rows] = await db.query(`
            SELECT id, body, is_read, created_at
            FROM notifications
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.user.id]);

        res.json(rows);
    })
);

app.patch(
    "/api/notifications/:id/read",
    requireAuth,
    asyncRoute(async (req, res) => {
        await db.query(
            `UPDATE notifications
             SET is_read = 1
             WHERE id = ? AND user_id = ?`,
            [Number(req.params.id), req.user.id]
        );

        res.json({ ok: true });
    })
);

/* =========================
   Newsletter
========================= */

app.post(
    "/api/newsletter/subscribe",
    asyncRoute(async (req, res) => {
        const email = String(req.body.email || "").trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                error: "Enter a valid email address."
            });
        }

        await db.query(
            `INSERT INTO newsletter_subscribers (email, status)
             VALUES (?, 'subscribed')
             ON DUPLICATE KEY UPDATE
             status = 'subscribed',
             unsubscribed_at = NULL`,
            [email]
        );

        res.status(201).json({
            message: "You are subscribed."
        });
    })
);

/* =========================
   Shopping Assistant
========================= */

app.post(
    "/api/assistant",
    asyncRoute(async (req, res) => {
        const message = String(req.body.message || "")
            .trim()
            .slice(0, 300);

        if (!message) {
            return res.status(400).json({
                error: "Enter a shopping question."
            });
        }

        const budgetMatch = message
            .replace(/,/g, "")
            .match(/(?:under|below|less than|max|₦)\s*₦?\s*(\d+)\s*(k|m)?/i);

        let maxPrice = null;

        if (budgetMatch) {
            const value = Number(budgetMatch[1]);
            const unit = String(budgetMatch[2] || "").toLowerCase();

            maxPrice = unit === "m"
                ? value * 1000000
                : unit === "k"
                    ? value * 1000
                    : value;
        }

        const stopWords = new Set([
            "find", "under", "below", "less", "than", "with",
            "that", "this", "want", "need", "show", "some",
            "product", "products", "please", "for", "and"
        ]);

        const words = message
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, " ")
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word));

        let sql = `
            SELECT ${PRODUCT_FIELDS}
            ${PRODUCT_FROM}
        `;

        const params = [];
        const conditions = [];

        if (maxPrice !== null) {
            conditions.push("p.price <= ?");
            params.push(maxPrice);
        }

        if (words.length) {
            conditions.push(
                "(" +
                words.map(() =>
                    "(p.title LIKE ? OR p.description LIKE ?)"
                ).join(" OR ") +
                ")"
            );

            for (const word of words) {
                params.push(`%${word}%`, `%${word}%`);
            }
        }

        if (conditions.length) {
            sql += " AND " + conditions.join(" AND ");
        }

        sql += " ORDER BY p.rating DESC, p.review_count DESC LIMIT 5";

        const [products] = await db.query(sql, params);

        res.json({
            reply: products.length
                ? `I found ${products.length} product(s) in the catalogue.`
                : "I couldn't find a matching product. Try different keywords or a higher budget.",
            products
        });
    })
);

/* =========================
   Socket.IO
========================= */

io.use((socket, next) => {
    try {
        const cookies = cookie.parse(
            socket.handshake.headers.cookie || ""
        );

        socket.user = jwt.verify(cookies.tw || "", JWT_SECRET);
        next();
    } catch {
        next(new Error("Unauthorized"));
    }
});

io.on("connection", socket => {
    socket.join(`user:${socket.user.id}`);

    if (socket.user.role === "admin") {
        socket.join("admins");
    }
});

/* =========================
   Static files / errors
========================= */

app.use(express.static(path.join(__dirname, "public")));

app.use("/api", (req, res) => {
    res.status(404).json({
        error: "API endpoint not found."
    });
});

app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({
        error: "Unexpected server error."
    });
});

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
    try {
        const connection = await db.getConnection();
        await connection.ping();
        connection.release();

        server.listen(PORT, () => {
            console.log(`JUSTECH Market running at ${CLIENT_URL}`);
        });
    } catch (error) {
        console.error("Could not connect to MySQL.");
        console.error(error.message);
        process.exit(1);
    }
}

start();
