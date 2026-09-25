const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

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


// ---- YouTube -> mp4 / mp3 (yt-dlp + ffmpeg) ----
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const YT_TIMEOUT_MS = 10 * 60 * 1000;
const YT_MAX_JOBS = parseInt(process.env.YT_MAX_JOBS || '2', 10);
const YT_PROXY = process.env.YT_PROXY; // e.g. socks5h://tailscale:1055 (routes yt-dlp through the home exit node)
let ytJobs = 0;

app.post('/youtube', express.json({ limit: '4kb' }), (req, res) => {
  const { url, format } = req.body || {};
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !YT_HOSTS.has(parsed.hostname)) {
    return res.status(400).json({ error: 'Only YouTube links are supported' });
  }
  if (!['mp4', 'mp3'].includes(format)) return res.status(400).json({ error: 'Format must be mp4 or mp3' });
  if (ytJobs >= YT_MAX_JOBS) return res.status(429).json({ error: 'Server is busy, try again in a minute' });

  const id = crypto.randomBytes(6).toString('base64url');
  const args = [
    '--no-playlist', '--no-warnings', '--js-runtimes', 'node',
    ...(YT_PROXY ? ['--proxy', YT_PROXY] : []),
    '--max-filesize', `${MAX_MB}M`,
    '-o', path.join(UPLOAD_DIR, `${id}.%(ext)s`),
    ...(format === 'mp3'
      ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
      : ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4']),
    '--', parsed.href,
  ];

  ytJobs++;
  let stderr = '';
  const child = spawn('yt-dlp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGKILL'), YT_TIMEOUT_MS);
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  const cleanup = () => fs.readdirSync(UPLOAD_DIR).filter((f) => f.startsWith(id + '.')).forEach((f) => fs.rmSync(path.join(UPLOAD_DIR, f), { force: true }));
  child.on('error', () => { if (res.headersSent) return; clearTimeout(timer); ytJobs--; res.status(500).json({ error: 'yt-dlp is not available on the server' }); });
  child.on('close', (code) => {
    if (res.headersSent) return;
    clearTimeout(timer);
    ytJobs--;
    const file = `${id}.${format}`;
    if (code === 0 && fs.existsSync(path.join(UPLOAD_DIR, file))) {
      fs.readdirSync(UPLOAD_DIR).filter((f) => f.startsWith(id + '.') && f !== file).forEach((f) => fs.rmSync(path.join(UPLOAD_DIR, f), { force: true }));
      return res.json({ url: `${SCHEME}://${DOMAIN}/f/${file}` });
    }
    cleanup();
    console.error('yt-dlp failed:', stderr);
    const tooBig = /larger than max-filesize/i.test(stderr);
    res.status(400).json({ error: tooBig ? `Video exceeds ${MAX_MB} MB limit` : 'Could not download that video' });
  });
  res.on('close', () => { if (!res.writableEnded) child.kill('SIGKILL'); });
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
