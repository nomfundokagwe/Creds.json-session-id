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

// 1. Use consistent session directory
const SESSION_DIR = path.join(__dirname, 'whatsapp_sessions');
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

router.get('/', async (req, res) => {
    const sessionId = makeid();
    const sessionPath = path.join(SESSION_DIR, sessionId);
    
    try {
        // 2. Initialize WhatsApp connection
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            browser: Browsers.macOS("ZUKO-MD"),
            syncFullHistory: false,
            getMessage: async () => ({}),
            // 3. Critical connection settings
            connectTimeoutMs: 30_000,
            keepAliveIntervalMs: 15_000,
            maxIdleTimeMs: 60_000
        });

        // 4. Enhanced connection handling
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, isNewLogin, lastDisconnect } = update;
            
            if (qr) {
                console.log('QR CODE RECEIVED');
                return res.json({ 
                    status: 'qr',
                    qr: qr 
                });
            }

            if (connection === 'open') {
                console.log('WHATSAPP CONNECTED!');
                await handleSuccess();
            }

            if (connection === 'close') {
                console.log('Connection closed:', lastDisconnect?.error);
                if (lastDisconnect?.error?.output?.statusCode !== 401) {
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // 5. Successful connection handler
        const handleSuccess = async () => {
            try {
                await delay(2000); // Wait for full initialization
                
                if (!sock.user?.id) {
                    throw new Error("Connection verification failed");
                }

                // Get credentials
                const credsPath = path.join(sessionPath, 'creds.json');
                if (!fs.existsSync(credsPath)) {
                    throw new Error("Credentials file not generated");
                }

                // Send response
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename="zuko_creds.json"');
                res.sendFile(credsPath);

                // Send welcome message
                await sock.sendMessage(sock.user.id, { 
                    text: '🚀 *ZUKO-MD Connected!*\n\n' +
                          'Your WhatsApp is now linked with ZUKO-MD!\n\n' +
                          'Type /menu to see commands.'
                });

            } catch (e) {
                console.error('CONNECTION HANDLER ERROR:', e);
                res.status(500).json({ error: e.message });
            } finally {
                setTimeout(() => sock.ws.close(), 5000);
            }
        };

        // 6. Pairing code handler
        if (!sock.authState.creds.registered) {
            const num = req.query.number?.replace(/[^0-9]/g, '');
            if (!num || num.length < 11) {
                return res.status(400).json({ 
                    error: "Invalid number format. Use country code (e.g. 15551234567)" 
                });
            }
            
            try {
                const code = await sock.requestPairingCode(num);
                console.log('PAIRING CODE GENERATED:', code);
                
                if (!code || typeof code !== 'string') {
                    throw new Error('Invalid pairing code received');
                }

                return res.json({ 
                    status: 'pairing',
                    code: code 
                });

            } catch (err) {
                console.error('PAIRING ERROR:', err);
                throw new Error(`Pairing failed: ${err.message}`);
            }
        }

    } catch (err) {
        console.error('FATAL ERROR:', err);
        return res.status(500).json({ 
            error: "Connection failed",
            details: err.message 
        });
    }
});

module.exports = router;
