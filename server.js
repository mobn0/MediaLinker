const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DOMAIN = process.env.DOMAIN;
if (!DOMAIN) {
  console.error('DOMAIN environment variable is required (e.g. media.example.com)');
  process.exit(1);
}
const SCHEME = process.env.SCHEME || 'https';
const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '500', 10);
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set([
  // audio
  '.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus', '.weba',
  // video
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.ogv',
  // images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico',
]);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(6).toString('base64url') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.has(ext)) return cb(new Error('Unsupported file type: ' + (ext || 'none')));
    cb(null, true);
  },
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.get('/config', (req, res) => {
  res.json({ maxMb: MAX_MB, extensions: [...ALLOWED] });
});

app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `File exceeds ${MAX_MB} MB limit` : err.message;
      return res.status(code).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    res.json({ url: `${SCHEME}://${DOMAIN}/f/${req.file.filename}` });
  });
});

// Direct file links. Range requests supported (seeking in audio/video).
app.use('/f', express.static(UPLOAD_DIR, {
  index: false,
  dotfiles: 'deny',
  maxAge: '30d',
  immutable: true,
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    // Neutralise scripts inside uploaded SVGs.
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox");
    res.set('Access-Control-Allow-Origin', '*');
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Noecore MediaLinker on ${SCHEME}://${DOMAIN} (port ${PORT})`));
