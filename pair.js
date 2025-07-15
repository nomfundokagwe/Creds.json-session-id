const { makeid } = require('./gen-id');
const express = require('express');
const router = express.Router();
const pino = require("pino");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');

const logger = pino({ level: "fatal" }).child({ level: "fatal" });

// Render-compatible temp dir (uses ephemeral storage)
const tempDir = './tmp'; // Render allows `/tmp` but we'll use local `./tmp`
const fs = require('fs');
const path = require('path');

// Ensure temp dir exists (works on Render)
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    const sessionDir = path.join(tempDir, id);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS("Safari")
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on("connection.update", async (update) => {
            if (update.connection === "open") {
                await delay(3000);
                const credsPath = path.join(sessionDir, 'creds.json');
                
                // Send creds.json directly (no MEGA)
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename="creds.json"');
                res.sendFile(credsPath, (err) => {
                    if (err) {
                        logger.error("Failed to send creds:", err);
                        res.status(500).json({ error: "Failed to generate session" });
                    }
                    // Cleanup (important for Render)
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    sock.ws.close();
                });
            }
        });

        if (!sock.authState.creds.registered) {
            const num = req.query.number?.replace(/[^0-9]/g, '');
            if (!num || num.length < 11) {
                return res.status(400).json({ error: "Invalid phone number" });
            }
            const code = await sock.requestPairingCode(num);
            res.json({ code });
        }
    } catch (err) {
        logger.error("Pairing error:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;