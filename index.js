const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

// Constants
const PORT = process.env.PORT || 8000;
const PROJECT_ROOT = __dirname;
const TEMP_DIR = path.join(PROJECT_ROOT, 'temp');

// Configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
require('events').EventEmitter.defaultMaxListeners = 50; // Reduced from 500

// Temp directory setup
const ensureTempDir = () => {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log(`[INIT] Created temp directory at ${TEMP_DIR}`);
  }
};

// Routes
const setupRoutes = () => {
  app.use('/server', require('./qr'));
  app.use('/code', require('./pair'));
  
  // Static files with error handling
  const serveStatic = (route, file) => {
    app.get(route, (req, res) => {
      const filePath = path.join(PROJECT_ROOT, file);
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send('File not found');
      }
    });
  };

  serveStatic('/pair', 'pair.html');
  serveStatic('/qr', 'qr.html');
  serveStatic('/', 'main.html');
};

// Error handling
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Startup
const startServer = () => {
  ensureTempDir();
  setupRoutes();
  
  app.listen(PORT, () => {
    console.log(`
███████╗██╗░░░██╗██╗░░██╗░█████╗░
╚════██║██║░░░██║██║░██╔╝██╔══██╗
░░███╔═╝██║░░░██║█████═╝░██║░░██║
██╔══╝░░██║░░░██║██╔═██╗░██║░░██║
███████╗╚██████╔╝██║░╚██╗╚█████╔╝
╚══════╝░╚═════╝░╚═╝░░╚═╝░╚════╝░

Server running on port ${PORT}
• Temp Directory: ${TEMP_DIR}
• Project Root: ${PROJECT_ROOT}
`);
  });
};

// Clean exit handler
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] Cleaning up...');
  try {
    fs.rmSync(TEMP_DIR, { recursive: true });
    console.log('[SHUTDOWN] Temp directory removed');
  } catch (err) {
    console.error('[SHUTDOWN ERROR]', err);
  }
  process.exit(0);
});

startServer();
