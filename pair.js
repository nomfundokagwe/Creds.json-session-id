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

// 1. Use consistent temp directory
const tempDir = path.join(__dirname, 'wa_sessions');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

router.get('/', async (req, res) => {
    const sessionId = makeid();
    const sessionDir = path.join(tempDir, sessionId);
    
    try {
        // 2. Initialize WhatsApp connection
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: true,
            logger,
            browser: Browsers.macOS("ZUKO-MD"),
            syncFullHistory: false,
            getMessage: async () => ({}) // Required dummy function
        });

        // 3. Proper connection handling
        sock.ev.on('connection.update', (update) => {
            const { connection, qr, isNewLogin } = update;
            
            if (qr) {
                console.log('QR RECEIVED:', qr);
                res.json({ qr }); // Send QR to client
            }

            if (connection === 'open') {
                console.log('WHATSAPP CONNECTED!');
                handleSuccessfulConnection();
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // 4. Handle successful connection
        const handleSuccessfulConnection = async () => {
            try {
                await delay(2000); // Wait for full initialization
                
                // Verify connection
                if (!sock.user?.id) {
                    throw new Error("Connection failed - no user ID");
                }

                // Send credentials
                const credsPath = path.join(sessionDir, 'creds.json');
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename="zuko_creds.json"');
                res.sendFile(credsPath, () => {
                    // Send confirmation message
                    sock.sendMessage(sock.user.id, { 
                        text: '✅ *ZUKO-MD Connected!*\n\n' +
                              'Your session is now active!\n\n' +
                              'Type /help for commands.'
                    });
                    sock.ws.close();
                });

            } catch (e) {
                console.error('CONNECTION ERROR:', e);
                res.status(500).json({ error: e.message });
            }
        };

        // 5. Handle pairing code request
        if (!sock.authState.creds.registered) {
            const num = req.query.number?.replace(/[^0-9]/g, '');
            if (!num || num.length < 11) {
                return res.status(400).json({ error: "Invalid number. Use country code format (e.g. 15551234567)" });
            }
            
            const code = await sock.requestPairingCode(num);
            console.log('PAIRING CODE:', code);
            res.json({ code });
        }

    } catch (err) {
        console.error('FATAL ERROR:', err);
        res.status(500).json({ 
            error: "Connection failed",
            details: err.message 
        });
    }
});

module.exports = router;
