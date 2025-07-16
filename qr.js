const { makeid } = require('./gen-id');
const express = require('express');
const router = express.Router();
const pino = require("pino");
const QRCode = require('qrcode');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay,
    Browsers
} = require('@whiskeysockets/baileys');

const logger = pino({ level: "fatal" }).child({ level: "fatal" });
const path = require('path');
const fs = require('fs');

// Session configuration
const SESSION_DIR = path.join(__dirname, 'wa_sessions');
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

router.get('/', async (req, res) => {
    const sessionId = makeid();
    const sessionPath = path.join(SESSION_DIR, sessionId);
    let qrGenerated = false;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            browser: Browsers.macOS("ZUKO-MD"),
            version: [2, 2413, 1], // Specific WhatsApp version
            printQRInTerminal: false,
            syncFullHistory: false
        });

        // QR Code Generation
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;
            
            if (qr && !qrGenerated) {
                qrGenerated = true;
                try {
                    const qrImage = await QRCode.toDataURL(qr);
                    res.json({
                        status: 'qr',
                        qr: qrImage,
                        timeout: 30000 // 30 seconds timeout
                    });
                } catch (err) {
                    console.error('QR Generation Error:', err);
                    res.status(500).json({ error: 'Failed to generate QR' });
                }
            }

            if (connection === 'open') {
                console.log('WhatsApp Connected!');
                // Handle successful connection
                await handleSuccess();
            }
        });

        sock.ev.on('creds.update', saveCreds);

        const handleSuccess = async () => {
            try {
                await delay(2000); // Wait for full initialization
                const credsPath = path.join(sessionPath, 'creds.json');
                
                if (fs.existsSync(credsPath)) {
                    res.json({ 
                        status: 'connected',
                        file: credsPath 
                    });
                } else {
                    throw new Error('Credentials not generated');
                }
            } catch (err) {
                console.error('Connection Error:', err);
                res.status(500).json({ error: err.message });
            } finally {
                setTimeout(() => sock.ws.close(), 5000);
            }
        };

        // Timeout handler
        setTimeout(() => {
            if (!qrGenerated) {
                res.status(408).json({ error: 'QR generation timeout' });
                sock.ws.close();
            }
        }, 30000);

    } catch (err) {
        console.error('Fatal Error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
