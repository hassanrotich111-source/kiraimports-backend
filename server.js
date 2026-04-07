const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection (Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Cloudinary config (free account)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'kira_imports_secret_2024';

// Initialize database tables
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS images (
        id SERIAL PRIMARY KEY,
        key VARCHAR(50) UNIQUE NOT NULL,
        url TEXT NOT NULL,
        public_id VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        price DECIMAL(10,2),
        image_url TEXT,
        public_id VARCHAR(255),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image_url TEXT,
        public_id VARCHAR(255),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default admin if not exists (username: Diana, password: Deeimports@2026)
    const hashedPassword = await bcrypt.hash('Deeimports@2026', 10);
    await pool.query(`
      INSERT INTO admin (username, password) 
      VALUES ('Diana', $1)
      ON CONFLICT (username) DO UPDATE SET password = $1
    `, [hashedPassword]);

    // Insert default images if not exists
    await pool.query(`
      INSERT INTO images (key, url) VALUES 
      ('logo', '/images/logo.jpeg'),
      ('hero_left', '/images/hero_container_yard.jpg'),
      ('hero_right', '/images/hero_portrait_business.jpg')
      ON CONFLICT (key) DO NOTHING
    `);

    console.log('Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
  }
}

// Auth middleware
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ========== AUTH ROUTES ==========

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query('SELECT * FROM admin WHERE username = $1', [username]);
    const admin = result.rows[0];
    
    if (!admin || !await bcrypt.compare(password, admin.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: admin.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== IMAGES ROUTES ==========

// Get all images
app.get('/api/images', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM images');
    const images = {};
    result.rows.forEach(row => {
      images[row.key] = row.url;
    });
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload image (admin only)
app.post('/api/images/:key', authMiddleware, upload.single('image'), async (req, res) => {
  const { key } = req.params;
  
  try {
    let imageUrl = req.body.url; // If URL provided instead of file
    let publicId = null;

    // If file uploaded, upload to Cloudinary
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'kira_imports' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        ).end(req.file.buffer);
      });
      imageUrl = result.secure_url;
      publicId = result.public_id;
    }

    // Update database
    await pool.query(`
      INSERT INTO images (key, url, public_id, updated_at) 
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) 
      DO UPDATE SET url = $2, public_id = $3, updated_at = NOW()
    `, [key, imageUrl, publicId]);

    res.json({ success: true, url: imageUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== PRODUCTS ROUTES ==========

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE active = true ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create product (admin only)
app.post('/api/products', authMiddleware, upload.single('image'), async (req, res) => {
  const { name, description, category, price } = req.body;
  
  try {
    let imageUrl = null;
    let publicId = null;

    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'kira_imports/products' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        ).end(req.file.buffer);
      });
      imageUrl = result.secure_url;
      publicId = result.public_id;
    }

    const result = await pool.query(`
      INSERT INTO products (name, description, category, price, image_url, public_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [name, description, category, price, imageUrl, publicId]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update product (admin only)
app.put('/api/products/:id', authMiddleware, upload.single('image'), async (req, res) => {
  const { name, description, category, price } = req.body;
  
  try {
    let imageUrl = req.body.image_url;
    let publicId = req.body.public_id;

    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'kira_imports/products' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        ).end(req.file.buffer);
      });
      imageUrl = result.secure_url;
      publicId = result.public_id;
    }

    const result = await pool.query(`
      UPDATE products 
      SET name = $1, description = $2, category = $3, price = $4, image_url = $5, public_id = $6, updated_at = NOW()
      WHERE id = $7 RETURNING *
    `, [name, description, category, price, imageUrl, publicId, req.params.id]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete product (admin only)
app.delete('/api/products/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE products SET active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== CATEGORIES ROUTES ==========

// Get all categories
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories WHERE active = true');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
