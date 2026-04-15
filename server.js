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

// Helper function to parse price - strips Ksh, commas, spaces and returns number
function parsePrice(priceString) {
  if (!priceString) return null;
  // Remove Ksh, ksh, commas, spaces, and any non-numeric characters except decimal point
  const cleaned = priceString.toString().replace(/[Kk]sh|[,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Helper function to format price for display
function formatPrice(num) {
  if (num === null || num === undefined) return '';
  return 'Ksh ' + num.toLocaleString('en-KE');
}

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
        price VARCHAR(50),
        service_fee VARCHAR(50),
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

      CREATE TABLE IF NOT EXISTS background_settings (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL DEFAULT 'image',
        image_url TEXT,
        color VARCHAR(20) DEFAULT '#0a1f3d',
        overlay_opacity INTEGER DEFAULT 85,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: Add service_fee column to products if it doesn't exist
    try {
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS service_fee VARCHAR(50)`);
      console.log('Migration: service_fee column added (or already exists)');
    } catch (err) {
      console.log('Migration note:', err.message);
    }

    // Insert default admin if not exists (username: Diana, password: Deeimports@2026)
    const hashedPassword = await bcrypt.hash('Deeimports@2026', 10);
    await pool.query(`
      INSERT INTO admin (username, password) 
      VALUES ('Diana', $1)
      ON CONFLICT (username) DO UPDATE SET password = $1
    `, [hashedPassword]);

    // Insert default images if not exists (admin can update these)
    await pool.query(`
      INSERT INTO images (key, url) VALUES 
      ('logo', '/images/logo.jpeg'),
      ('hero_bg_shipping', '/images/hero_bg_shipping.jpg'),
      ('background', '/images/hero_shipping_bg.jpg'),
      ('category_machines', ''),
      ('category_electronics', ''),
      ('category_kitchenware', ''),
      ('category_furniture', ''),
      ('category_clothing', ''),
      ('category_bags', ''),
      ('sourcing_factory_line', ''),
      ('quality_inspection', ''),
      ('shipping_truck_road', ''),
      ('service_support_desk', ''),
      ('import_cargo_plane', ''),
      ('sourcing_warehouse_aisle', ''),
      ('testimonial_james', ''),
      ('testimonial_amina', ''),
      ('testimonial_david', ''),
      ('testimonial_sarah', ''),
      ('service_sourcing', ''),
      ('service_verification', ''),
      ('service_quality', ''),
      ('service_shipping', ''),
      ('service_delivery', ''),
      ('service_support', ''),
      ('shop_background', '')
      ON CONFLICT (key) DO NOTHING
    `);

    // Insert default background settings if not exists
    await pool.query(`
      INSERT INTO background_settings (type, image_url, color, overlay_opacity) 
      VALUES ('image', '/images/hero_shipping_bg.jpg', '#0a1f3d', 85)
      ON CONFLICT DO NOTHING
    `);

    console.log('Database initialized - admin can update images via panel');
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

    // If this is the background image, also update background_settings
    if (key === 'background') {
      console.log('Updating background_settings with new image URL');
      const existing = await pool.query('SELECT id FROM background_settings ORDER BY id LIMIT 1');
      if (existing.rows.length > 0) {
        await pool.query(`
          UPDATE background_settings 
          SET type = 'image', image_url = $1, updated_at = NOW()
          WHERE id = $2
        `, [imageUrl, existing.rows[0].id]);
      } else {
        await pool.query(`
          INSERT INTO background_settings (type, image_url, color, overlay_opacity, updated_at)
          VALUES ('image', $1, '#0a1f3d', 85, NOW())
        `, [imageUrl]);
      }
      console.log('Background settings updated');
    }

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
    console.log('Products fetched:', result.rows.length);
    if (result.rows.length > 0) {
      console.log('First product:', result.rows[0].name, 'service_fee:', result.rows[0].service_fee);
    }
    // Transform data to include formatted prices and image for compatibility
    const products = result.rows.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      service_fee: p.service_fee,
      category: p.category,
      image_url: p.image_url,
      public_id: p.public_id,
      image: p.image_url || '/images/category_electronics.jpg',
      price_formatted: formatPrice(p.price),
      service_fee_formatted: formatPrice(p.service_fee),
    }));
    res.json(products);
  } catch (err) {
    console.error('Get products error:', err);
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
  const { name, description, category, price, service_fee } = req.body;
  
  // Parse prices - strip Ksh and commas
  const parsedPrice = parsePrice(price);
  const parsedServiceFee = parsePrice(service_fee);
  
  console.log('Create product request:', { name, category, price: parsedPrice, service_fee: parsedServiceFee });
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
      INSERT INTO products (name, description, category, price, service_fee, image_url, public_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [name, description, category, parsedPrice, parsedServiceFee, imageUrl, publicId]);

    console.log('Product created:', result.rows[0].id);
    // Return with image field and formatted prices for display
    const product = result.rows[0];
    res.json({
      ...product,
      image: product.image_url || '/images/category_electronics.jpg',
      price_formatted: formatPrice(product.price),
      service_fee_formatted: formatPrice(product.service_fee),
    });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: err.message, details: err.toString() });
  }
});

// Update product (admin only)
app.put('/api/products/:id', authMiddleware, upload.single('image'), async (req, res) => {
  const { name, description, category, price, service_fee } = req.body;
  
  // Parse prices - strip Ksh and commas
  const parsedPrice = parsePrice(price);
  const parsedServiceFee = parsePrice(service_fee);
  
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
      SET name = $1, description = $2, category = $3, price = $4, service_fee = $5, image_url = $6, public_id = $7, updated_at = NOW()
      WHERE id = $8 RETURNING *
    `, [name, description, category, parsedPrice, parsedServiceFee, imageUrl, publicId, req.params.id]);

    // Return with image field and formatted prices
    const product = result.rows[0];
    res.json({
      ...product,
      image: product.image_url || '/images/category_electronics.jpg',
      price_formatted: formatPrice(product.price),
      service_fee_formatted: formatPrice(product.service_fee),
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

// ========== BACKGROUND SETTINGS ROUTES ==========

// Get background settings (public)
app.get('/api/background', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM background_settings ORDER BY id LIMIT 1');
    if (result.rows.length === 0) {
      // Return default settings
      return res.json({
        type: 'image',
        imageUrl: '/images/hero_shipping_bg.jpg',
        color: '#0a1f3d',
        overlayOpacity: 85
      });
    }
    const row = result.rows[0];
    res.json({
      type: row.type,
      imageUrl: row.image_url,
      color: row.color,
      overlayOpacity: row.overlay_opacity
    });
  } catch (err) {
    console.error('Get background error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save background settings (admin only)
app.post('/api/background', authMiddleware, async (req, res) => {
  const { type, imageUrl, color, overlayOpacity } = req.body;
  
  try {
    console.log('Saving background settings:', { type, imageUrl, color, overlayOpacity });
    
    // Check if there's an existing record
    const existing = await pool.query('SELECT id FROM background_settings ORDER BY id LIMIT 1');
    
    if (existing.rows.length > 0) {
      // Update existing record
      await pool.query(`
        UPDATE background_settings 
        SET type = $1, image_url = $2, color = $3, overlay_opacity = $4, updated_at = NOW()
        WHERE id = $5
      `, [type, imageUrl, color, overlayOpacity, existing.rows[0].id]);
    } else {
      // Insert new record
      await pool.query(`
        INSERT INTO background_settings (type, image_url, color, overlay_opacity, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [type, imageUrl, color, overlayOpacity]);
    }

    console.log('Background settings saved successfully');
    res.json({ success: true, type, imageUrl, color, overlayOpacity });
  } catch (err) {
    console.error('Save background error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Ping endpoint to keep Render awake
app.get('/api/ping', (req, res) => {
  res.json({ status: 'pong', time: Date.now() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Database URL:', process.env.DATABASE_URL ? 'Configured' : 'Not set');
    console.log('Cloudinary:', process.env.CLOUDINARY_CLOUD_NAME ? 'Configured' : 'Not set');
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
