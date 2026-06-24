const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ---- Database ----
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

// ---- Security headers (Helmet) ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ---- Body parser ----
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ---- Session ----
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// ---- CSRF protection ----
function generateCsrfToken(req) {
  const token = crypto.randomBytes(32).toString('hex');
  req.session.csrfToken = token;
  return token;
}

function csrfProtection(req, res, next) {
  const token = req.body._csrf;
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('CSRF token invalido - recarregue a pagina e tente novamente.');
  }
  next();
}

// ---- Rate limiting (login) ----
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Muitas tentativas de login. Aguarde 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

// ---- Rate limiting (general post) ----
const postLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Muitas requisicoes. Aguarde um minuto.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

// ---- View engine & static files ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Audit log ----
const LOG_FILE = path.join(__dirname, 'audit.log');
function audit(action, req) {
  const entry = `${new Date().toISOString()} | IP: ${req.ip} | User: ${req.session.userId || '-'} | ${action}\n`;
  fs.appendFileSync(LOG_FILE, entry);
}

// ---- Helpers ----
const VALID_THEMES = ['dark', 'light'];
const MAX_FIELD_LENGTH = 500;
const MAX_BIO_LENGTH = 5000;
const MAX_URL_LENGTH = 2000;

// Contact form config
const EVO_API = process.env.EVOLUTION_API_URL || '';
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE || '';
const WHATSAPP_DEST = process.env.WHATSAPP_DEST || '';
const EMAIL_DEST = process.env.EMAIL_DEST || '';

// Nodemailer transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

// Anti-flood: 1 msg per IP per 3 min
const contactLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  max: 1,
  message: { error: 'Muitas mensagens. Aguarde 3 minutos para enviar novamente.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

function sanitize(str, maxLen) {
  if (!str) return '';
  return String(str).substring(0, maxLen).trim();
}

function isValidUrl(str) {
  if (!str) return true;
  return /^(https?:\/\/|mailto:|tel:|\+|\/|#)/i.test(str) || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(str);
}

async function loadProfile() {
  const { rows } = await pool.query('SELECT * FROM cms_profile ORDER BY id LIMIT 1');
  if (rows.length === 0) return { name: '', name_en: '', tagline: '', tagline_en: '', bio: '', bio_en: '', avatar: '', location: '', theme: 'dark', links: [] };
  const profile = rows[0];
  profile.name_en = profile.name_en || profile.name;
  profile.tagline_en = profile.tagline_en || profile.tagline;
  profile.bio_en = profile.bio_en || profile.bio;
  const { rows: links } = await pool.query('SELECT * FROM cms_links ORDER BY sort_order, id');
  profile.links = links;
  return profile;
}

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/admin/login');
}

// ---- CSRF token for views ----
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.locals.csrfToken = generateCsrfToken(req);
  }
  next();
});

// ---- Public ----
app.get('/', async (req, res) => {
  try {
    const profile = await loadProfile();
    res.render('index', { profile, lang: 'pt', whatsapp: WHATSAPP_DEST, email: EMAIL_DEST });
  } catch (err) {
    console.error('Erro ao carregar pagina:', err.message);
    res.status(500).send('Erro ao carregar pagina');
  }
});

app.get('/en', async (req, res) => {
  try {
    const profile = await loadProfile();
    res.render('index', { profile, lang: 'en', whatsapp: WHATSAPP_DEST, email: EMAIL_DEST });
  } catch (err) {
    console.error('Erro ao carregar pagina:', err.message);
    res.status(500).send('Erro ao carregar pagina');
  }
});

// ---- Auth ----
app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

app.post('/admin/login', loginLimiter, csrfProtection, async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM cms_users WHERE username = $1', [username]);
    if (rows.length === 0) {
      audit('LOGIN_FAIL: usuario nao encontrado', req);
      return res.render('admin/login', { error: 'Usuario ou senha incorretos.', csrfToken: generateCsrfToken(req) });
    }
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) {
      audit('LOGIN_FAIL: senha incorreta', req);
      return res.render('admin/login', { error: 'Usuario ou senha incorretos.', csrfToken: generateCsrfToken(req) });
    }
    req.session.authenticated = true;
    req.session.userId = rows[0].id;
    audit('LOGIN_OK', req);
    res.redirect('/admin');
  } catch (err) {
    console.error('Erro no login:', err.message);
    res.render('admin/login', { error: 'Erro ao autenticar.', csrfToken: generateCsrfToken(req) });
  }
});

app.get('/admin/logout', (req, res) => {
  audit('LOGOUT', req);
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ---- Dashboard ----
app.get('/admin', requireAuth, async (req, res) => {
  try {
    const profile = await loadProfile();
    const success = req.query.saved ? 'Perfil salvo com sucesso!' : (req.query.pw ? 'Senha alterada com sucesso!' : null);
    res.render('admin/dashboard', { profile, success });
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err.message);
    res.status(500).send('Erro ao carregar dashboard');
  }
});

// ---- Save profile ----
app.post('/admin/save', requireAuth, postLimiter, csrfProtection, async (req, res) => {
  try {
    const name = sanitize(req.body.name, MAX_FIELD_LENGTH);
    const tagline = sanitize(req.body.tagline, MAX_FIELD_LENGTH);
    const bio = sanitize(req.body.bio, MAX_BIO_LENGTH);
    const nameEn = sanitize(req.body.name_en, MAX_FIELD_LENGTH);
    const taglineEn = sanitize(req.body.tagline_en, MAX_FIELD_LENGTH);
    const bioEn = sanitize(req.body.bio_en, MAX_BIO_LENGTH);
    const avatar = sanitize(req.body.avatar, MAX_URL_LENGTH);
    const location = sanitize(req.body.location, MAX_FIELD_LENGTH);
    const theme = VALID_THEMES.includes(req.body.theme) ? req.body.theme : 'dark';

    if (!name) {
      return res.status(400).send('Nome e obrigatorio.');
    }

    await pool.query(
      `UPDATE cms_profile SET name=$1, tagline=$2, bio=$3, name_en=$4, tagline_en=$5, bio_en=$6, avatar=$7, location=$8, theme=$9, updated_at=NOW()
       WHERE id = (SELECT id FROM cms_profile ORDER BY id LIMIT 1)`,
      [name, tagline, bio, nameEn, taglineEn, bioEn, avatar, location, theme]
    );

    await pool.query('DELETE FROM cms_links');
    for (let i = 0; req.body['link_label_' + i]; i++) {
      const label = sanitize(req.body['link_label_' + i], MAX_FIELD_LENGTH);
      const url = sanitize(req.body['link_url_' + i], MAX_URL_LENGTH);
      if (label && url) {
        await pool.query('INSERT INTO cms_links (label, url, sort_order) VALUES ($1, $2, $3)', [label, url, i]);
      }
    }

    audit('PROFILE_SAVED', req);
    res.redirect('/admin?saved=1');
  } catch (err) {
    console.error('Erro ao salvar perfil:', err.message);
    res.status(500).send('Erro ao salvar perfil');
  }
});

app.post('/admin/add-link', requireAuth, postLimiter, csrfProtection, async (req, res) => {
  try {
    await pool.query('INSERT INTO cms_links (label, url, sort_order) VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order),-1)+1 FROM cms_links))', ['', '']);
    audit('LINK_ADDED', req);
    res.redirect('/admin');
  } catch (err) {
    console.error('Erro ao adicionar link:', err.message);
    res.status(500).send('Erro ao adicionar link');
  }
});

app.post('/admin/remove-link', requireAuth, postLimiter, csrfProtection, async (req, res) => {
  try {
    const idx = parseInt(req.body.index);
    if (isNaN(idx) || idx < 0) return res.redirect('/admin');
    const { rows } = await pool.query('SELECT id FROM cms_links ORDER BY sort_order, id');
    if (idx < rows.length) {
      await pool.query('DELETE FROM cms_links WHERE id = $1', [rows[idx].id]);
      audit('LINK_REMOVED', req);
    }
    res.redirect('/admin');
  } catch (err) {
    console.error('Erro ao remover link:', err.message);
    res.status(500).send('Erro ao remover link');
  }
});

// ---- Change password ----
app.get('/admin/password', requireAuth, (req, res) => {
  res.render('admin/password', { error: null, success: null });
});

app.post('/admin/password', requireAuth, postLimiter, csrfProtection, async (req, res) => {
  try {
    const { current, newPassword, confirm } = req.body;
    const ctx = (e, s) => ({ error: e, success: s, csrfToken: generateCsrfToken(req) });

    if (newPassword !== confirm) {
      return res.render('admin/password', ctx('Senhas nao conferem.', null));
    }
    if (!newPassword || newPassword.length < 8) {
      return res.render('admin/password', ctx('A nova senha deve ter pelo menos 8 caracteres.', null));
    }

    const { rows } = await pool.query('SELECT password_hash FROM cms_users WHERE id = $1', [req.session.userId]);
    const valid = await bcrypt.compare(current, rows[0].password_hash);
    if (!valid) {
      audit('PASSWORD_CHANGE_FAIL: senha atual incorreta', req);
      return res.render('admin/password', ctx('Senha atual incorreta.', null));
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE cms_users SET password_hash = $1 WHERE id = $2', [hash, req.session.userId]);
    audit('PASSWORD_CHANGED', req);
    res.render('admin/password', ctx(null, 'Senha alterada com sucesso!'));
  } catch (err) {
    console.error('Erro ao alterar senha:', err.message);
    res.render('admin/password', { error: 'Erro ao alterar senha.', success: null, csrfToken: generateCsrfToken(req) });
  }
});

// ---- Contact endpoint (WhatsApp via Evolution API) ----
app.post('/contact', contactLimiter, csrfProtection, async (req, res) => {
  try {
    const name = sanitize(req.body.name, 100);
    const reply = sanitize(req.body.reply, 200);
    const msg = sanitize(req.body.msg, 1000);

    if (!name || name.length < 2) return res.status(400).json({ error: 'Nome invalido (minimo 2 caracteres).' });
    if (!msg || msg.length < 5) return res.status(400).json({ error: 'Mensagem muito curta (minimo 5 caracteres).' });

    const ip = req.ip;
    const messageBody = `*Nova mensagem do site!*\n\n*Nome:* ${name}\n*E-mail:* ${reply || '-'}\n*IP:* ${ip}\n\n*Mensagem:*\n${msg}`;

    const response = await fetch(`${EVO_API}/message/sendText/${EVO_INSTANCE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVO_KEY
      },
      body: JSON.stringify({
        number: WHATSAPP_DEST,
        text: messageBody
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Evolution API error:', response.status, errBody);
      audit('CONTACT_FAIL: Evolution API error', req);
      return res.status(502).json({ error: 'Erro ao enviar mensagem. Tente novamente mais tarde.' });
    }

    audit('CONTACT_SENT: ' + name + ' <' + (reply || '-') + '>', req);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro no endpoint /contact:', err.message);
    audit('CONTACT_ERROR: ' + err.message, req);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

// ---- Email endpoint ----
app.post('/email', contactLimiter, csrfProtection, async (req, res) => {
  try {
    const name = sanitize(req.body.name, 100);
    const reply = sanitize(req.body.reply, 200);
    const msg = sanitize(req.body.msg, 1000);

    if (!name || name.length < 2) return res.status(400).json({ error: 'Nome invalido (minimo 2 caracteres).' });
    if (!reply || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply)) return res.status(400).json({ error: 'E-mail para resposta invalido.' });
    if (!msg || msg.length < 5) return res.status(400).json({ error: 'Mensagem muito curta (minimo 5 caracteres).' });

    const ip = req.ip;
    await transporter.sendMail({
      from: `"${name} (via site)" <${process.env.SMTP_USER}>`,
      replyTo: reply,
      to: EMAIL_DEST,
      subject: `Contato do site: ${name}`,
      text: `Nome: ${name}\nE-mail: ${reply}\nIP: ${ip}\n\nMensagem:\n${msg}`,
      html: `<p><strong>Nome:</strong> ${name}</p><p><strong>E-mail:</strong> ${reply}</p><p><strong>IP:</strong> ${ip}</p><hr><p>${msg.replace(/\n/g, '<br>')}</p>`
    });

    audit('EMAIL_SENT: ' + name + ' <' + reply + '>', req);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro no endpoint /email:', err.message);
    audit('EMAIL_ERROR: ' + err.message, req);
    res.status(500).json({ error: 'Erro ao enviar e-mail. Tente novamente.' });
  }
});

app.listen(PORT, () => {
  console.log(`CMS About.me rodando em http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
