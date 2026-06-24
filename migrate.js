const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || ''
});

async function migrate() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cms_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cms_profile (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) DEFAULT 'Seu Nome',
        tagline VARCHAR(300) DEFAULT 'Desenvolvedor & Criador',
        bio TEXT DEFAULT 'Ola! Sou um profissional apaixonado por tecnologia.',
        avatar VARCHAR(500) DEFAULT '',
        location VARCHAR(200) DEFAULT 'Sao Paulo, Brasil',
        theme VARCHAR(20) DEFAULT 'dark',
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cms_links (
        id SERIAL PRIMARY KEY,
        label VARCHAR(100) NOT NULL,
        url VARCHAR(500) NOT NULL,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Tabelas criadas');

    const { rows: users } = await pool.query('SELECT id FROM cms_users LIMIT 1');
    if (users.length === 0) {
      const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || crypto.randomBytes(8).toString('hex');
      const hash = await bcrypt.hash(defaultPassword, 10);
      await pool.query('INSERT INTO cms_users (username, password_hash) VALUES ($1, $2)', ['admin', hash]);
      console.log(`Usuario admin criado (senha: ${defaultPassword})`);
    }

    const { rows: profiles } = await pool.query('SELECT id FROM cms_profile LIMIT 1');
    if (profiles.length === 0) {
      await pool.query('INSERT INTO cms_profile (name, tagline, bio, avatar, location, theme) VALUES ($1,$2,$3,$4,$5,$6)',
        ['Tobias Rocha', 'Desenvolvedor & Criador', 'Sou uma pessoa fascinada pela inventividade do ser humano, sobretudo coisas grandiosas relacionadas a tecnologia.', '', 'Sao Paulo, Brasil', 'dark']);
      console.log('Perfil inicial criado');
    }

    console.log('Migracao concluida');
  } catch (err) {
    console.error('Erro na migracao:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
