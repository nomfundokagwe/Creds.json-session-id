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
const QRCode = require('qrcode');

const tempDir = path.join(__dirname, 'wa_sessions');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

router.get('/', async (req, res) => {
    const sessionId = makeid();
    const sessionDir = path.join(tempDir, sessionId);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            browser: Browsers.macOS("ZUKO-MD"),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            emitOwnEvents: true,
            getMessage: async () => ({})
        });

        // Error handling
        sock.ws.on('CB:error', (error) => {
            console.log('Socket Error:', error);
            if (error.status === 428) {
                console.log('Reconnecting after error...');
                setTimeout(() => sock.end(), 3000);
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;
            
            if (qr) {
                console.log('QR Generated');
                const qrImage = await QRCode.toDataURL(qr);
                res.json({ qr: qrImage });
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp Connected!');
                await handleSuccess();
            }
        });

        sock.ev.on('creds.update', saveCreds);

        const handleSuccess = async () => {
            try {
                await delay(2000);
                if (!sock.user?.id) throw new Error("No user ID");
                
                const credsPath = path.join(sessionDir, 'creds.json');
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename="creds.json"');
                res.sendFile(credsPath);
                
                await sock.sendMessage(sock.user.id, { 
                    text: '✅ Successfully connected to ZUKO-MD!'
                });
                
            } catch (e) {
                console.error('Finalization Error:', e);
                res.status(500).json({ error: e.message });
            } finally {
                sock.ws.close();
            }
        };

        if (!sock.authState.creds.registered) {
            const num = req.query.number?.replace(/[^0-9]/g, '');
            if (!num || num.length < 11) {
                return res.status(400).json({ error: "Use full number with country code" });
            }
            
            try {
                const code = await sock.requestPairingCode(num);
                if (!code || code.length !== 8) {
                    throw new Error('Invalid pairing code');
                }
                console.log('Valid Pairing Code:', code);
                res.json({ code });
            } catch (err) {
                console.log('Pairing Failed:', err);
                throw new Error(`Failed to pair: ${err.message}`);
            }
        }

    } catch (err) {
        console.error('Fatal Error:', err);
        res.status(500).json({ 
            error: "Connection failed",
            details: err.message 
        });
    }
});

module.exports = router;
