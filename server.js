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
// Parse DATABASE_URL or use individual env vars
const parseDbUrl = (url) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      user: parsed.username,
      password: parsed.password,
      host: parsed.hostname,
      port: parsed.port || 5432,
      database: parsed.pathname.slice(1),
      ssl: { rejectUnauthorized: false }
    };
  } catch (e) {
    return null;
  }
};

const dbConfig = parseDbUrl(process.env.DATABASE_URL) || {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
};

const pool = new Pool(dbConfig);

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
      ('hero_right', '/images/hero_portrait_business.jpg'),
      ('category_machines', '/images/category_machines.jpg'),
      ('category_electronics', '/images/category_electronics.jpg'),
      ('category_kitchenware', '/images/category_kitchenware.jpg'),
      ('category_furniture', '/images/category_furniture.jpg'),
      ('category_clothing', '/images/category_clothing.jpg'),
      ('category_bags', '/images/category_bags.jpg'),
      ('sourcing_factory_line', '/images/sourcing_factory_line.jpg'),
      ('quality_inspection', '/images/quality_inspection.jpg'),
      ('shipping_truck_road', '/images/shipping_truck_road.jpg'),
      ('service_support_desk', '/images/service_support_desk.jpg'),
      ('import_cargo_plane', '/images/import_cargo_plane.jpg'),
      ('sourcing_warehouse_aisle', '/images/sourcing_warehouse_aisle.jpg'),
      ('testimonial_james', '/images/testimonial_james.jpg'),
      ('testimonial_amina', '/images/testimonial_amina.jpg'),
      ('testimonial_david', '/images/testimonial_david.jpg')
      ON CONFLICT (key) DO NOTHING
    `);

    console.log('Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
  }
}

// Auth middleware
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('Auth header:', authHeader ? 'Present' : 'Missing');
  
  const token = authHeader?.split(' ')[1];
  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ error: 'No token' });
  }
  
  try {
    console.log('Verifying token with JWT_SECRET:', JWT_SECRET.substring(0, 10) + '...');
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Token verified for user:', decoded.username);
    req.admin = decoded;
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    res.status(401).json({ error: 'Invalid token', details: err.message });
  }
};

// ========== AUTH ROUTES ==========

// Admin login
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt for:', username);
  
  try {
    const result = await pool.query('SELECT * FROM admin WHERE username = $1', [username]);
    const admin = result.rows[0];
    
    if (!admin) {
      console.log('User not found:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const passwordMatch = await bcrypt.compare(password, admin.password);
    console.log('Password match:', passwordMatch);
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    console.log('Creating token with JWT_SECRET:', JWT_SECRET.substring(0, 10) + '...');
    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
    console.log('Token created successfully for:', username);
    res.json({ token, username: admin.username });
  } catch (err) {
    console.error('Login error:', err);
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
    console.log('Upload request received for key:', key);
    console.log('File received:', req.file ? 'Yes' : 'No');
    
    let imageUrl = req.body.url; // If URL provided instead of file
    let publicId = null;

    // If file uploaded, upload to Cloudinary
    if (req.file) {
      console.log('Uploading to Cloudinary...');
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'kira_imports' },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              reject(error);
            } else {
              console.log('Cloudinary upload success:', result.secure_url);
              resolve(result);
            }
          }
        ).end(req.file.buffer);
      });
      imageUrl = result.secure_url;
      publicId = result.public_id;
    }

    if (!imageUrl) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Update database
    console.log('Saving to database:', key, imageUrl);
    await pool.query(`
      INSERT INTO images (key, url, public_id, updated_at) 
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) 
      DO UPDATE SET url = $2, public_id = $3, updated_at = NOW()
    `, [key, imageUrl, publicId]);

    console.log('Image saved successfully');
    res.json({ success: true, url: imageUrl });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message, details: err.toString() });
  }
});

// ========== PRODUCTS ROUTES ==========

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE active = true ORDER BY created_at DESC');
    // Transform data to include both image and image_url for compatibility
    const products = result.rows.map(p => ({
      ...p,
      image: p.image_url || '/images/category_electronics.jpg',
    }));
    res.json(products);
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
  
  console.log('Create product request:', { name, category, price });
  console.log('File received:', req.file ? 'Yes' : 'No');
  
  try {
    let imageUrl = req.body.image_url || null;
    let publicId = null;

    if (req.file) {
      console.log('Uploading product image to Cloudinary...');
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'kira_imports/products' },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              reject(error);
            } else {
              console.log('Cloudinary upload success:', result.secure_url);
              resolve(result);
            }
          }
        ).end(req.file.buffer);
      });
      imageUrl = result.secure_url;
      publicId = result.public_id;
    }

    console.log('Saving product to database...');
    const result = await pool.query(`
      INSERT INTO products (name, description, category, price, image_url, public_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [name, description, category, price, imageUrl, publicId]);

    console.log('Product created:', result.rows[0].id);
    // Return with image field for compatibility
    const product = result.rows[0];
    res.json({
      ...product,
      image: product.image_url || '/images/category_electronics.jpg',
    });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: err.message, details: err.toString() });
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

    // Return with image field for compatibility
    const product = result.rows[0];
    res.json({
      ...product,
      image: product.image_url || '/images/category_electronics.jpg',
    });
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
