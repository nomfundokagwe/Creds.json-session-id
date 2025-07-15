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
const path = require('path');
const fs = require('fs');

const tempDir = path.join(__dirname, 'tmp');

// Ensure temp dir exists
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
            printQRInTerminal: true, // Enabled for debugging
            logger,
            browser: Browsers.macOS("ZUKO-MD"), // Custom name
            syncFullHistory: false,
            getMessage: async () => {}
        });

        // Critical connection handler
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            console.log('Connection Update:', update);
            
            if (qr) {
                console.log('QR Code:', qr);
            }

            if (connection === 'open') {
                console.log('✅ Connected to WhatsApp!');
                // Send credentials to user
                sendCredentials();
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                console.log(`Connection closed, ${shouldReconnect ? 'reconnecting' : 'not reconnecting'}...`);
                if (shouldReconnect) {
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            }
        });

        const sendCredentials = async () => {
            try {
                const credsPath = path.join(sessionDir, 'creds.json');
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename="creds.json"');
                res.sendFile(credsPath);
                
                // Send confirmation message
                await sock.sendMessage(sock.user.id, { 
                    text: '✅ Successfully connected to ZUKO-MD!\n\n' +
                          'Your session credentials are attached.'
                });
                
            } catch (err) {
                logger.error("Credentials error:", err);
                res.status(500).json({ error: "Failed to send credentials" });
            } finally {
                sock.ws.close();
                fs.rmSync(sessionDir, { recursive: true });
            }
        };

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
