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

// 1. Session directory setup
const SESSION_DIR = path.join(__dirname, 'wa_sessions');
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// 2. Connection manager
const createConnection = async (sessionPath, res) => {
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
        connectTimeoutMs: 30_000,
        maxRetries: 3, // Added retry limit
        version: [2, 2413, 1] // Specific WhatsApp version
    });

    // 3. Connection handlers
    const handleConnectionUpdate = (update) => {
        const { connection, qr, lastDisconnect } = update;
        
        if (qr) {
            console.log('QR Generated');
            return res.json({ qr });
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp Connected!');
            handleSuccess();
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`Disconnected (${statusCode})`);
            
            if (statusCode !== 401) { // Don't retry if unauthorized
                setTimeout(() => createConnection(sessionPath, res), 3000);
            }
        }
    };

    const handleSuccess = async () => {
        try {
            await delay(2000);
            const credsPath = path.join(sessionPath, 'creds.json');
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="creds.json"');
            res.sendFile(credsPath);
            
            await sock.sendMessage(sock.user.id, {
                text: '✅ Successfully connected to ZUKO-MD!'
            });
        } finally {
            setTimeout(() => sock.ws.close(), 5000);
        }
    };

    sock.ev.on('connection.update', handleConnectionUpdate);
    sock.ev.on('creds.update', saveCreds);

    return sock;
};

router.get('/', async (req, res) => {
    const sessionId = makeid();
    const sessionPath = path.join(SESSION_DIR, sessionId);
    
    try {
        const sock = await createConnection(sessionPath, res);

        if (!sock.authState.creds.registered) {
            const num = req.query.number?.replace(/[^0-9]/g, '');
            if (!num || num.length < 11) {
                return res.status(400).json({ error: "Use full number with country code" });
            }
            
            try {
                const code = await sock.requestPairingCode(num);
                if (!code || code.length < 8) {
                    throw new Error('Invalid pairing code format');
                }
                console.log('8-Digit Pairing Code:', code);
                return res.json({ code });
            } catch (err) {
                console.error('Pairing Error:', err);
                throw new Error(`Couldn't get pairing code. Try again later.`);
            }
        }
    } catch (err) {
        console.error('Fatal Error:', err);
        return res.status(500).json({ 
            error: "Connection failed",
            details: err.message 
        });
    }
});

module.exports = router;
