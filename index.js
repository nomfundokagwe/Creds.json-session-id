const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");
const fs = require('fs');

// Configuration
// In index.js
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
// Increase event listeners limit
require('events').EventEmitter.defaultMaxListeners = 500;

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create temp directory if not exists
const tempDir = path.join(__path, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Routes
app.use('/server', require('./qr'));
app.use('/code', require('./pair'));

// Static file routes
app.use('/pair', (req, res) => {
  res.sendFile(path.join(__path, 'pair.html'));
});

app.use('/qr', (req, res) => {
  res.sendFile(path.join(__path, 'qr.html'));
});

app.use('/', (req, res) => {
  res.sendFile(path.join(__path, 'main.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
app.listen(PORT, () => {
  console.log(`
███████╗██╗░░░██╗██╗░░██╗░█████╗░
╚════██║██║░░░██║██║░██╔╝██╔══██╗
░░███╔═╝██║░░░██║█████═╝░██║░░██║
██╔══╝░░██║░░░██║██╔═██╗░██║░░██║
███████╗╚██████╔╝██║░╚██╗╚█████╔╝
╚══════╝░╚═════╝░╚═╝░░╚═╝░╚════╝░

Server running on http://localhost:${PORT}
Don't forget to star ZUKO-MD repo!
`);
});

module.exports = app;