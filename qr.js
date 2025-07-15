const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pino = require("pino");
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    Browsers, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');

// Configure logger
const logger = pino({ level: "fatal" }).child({ level: "fatal" });

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

function removeFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    try {
        fs.rmSync(filePath, { recursive: true, force: true });
        return true;
    } catch (err) {
        logger.error(`Failed to remove file: ${filePath}`, err);
        return false;
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    const sessionDir = path.join(tempDir, id);
    let num = req.query.number;

    if (!num) {
        return res.status(400).json({ error: "Phone number is required" });
    }

    async function handlePairing() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            
            const browsers = ["Safari", "Chrome", "Firefox", "Edge"];
            const randomBrowser = browsers[Math.floor(Math.random() * browsers.length)];
            
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                generateHighQualityLinkPreview: true,
                logger,
                syncFullHistory: false,
                browser: Browsers.macOS(randomBrowser)
            });

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === "open") {
                    await delay(3000); // Shortened delay for better UX
                    
                    try {
                        const credsPath = path.join(sessionDir, 'creds.json');
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("Credentials file not found");
                        }

                        // Send credentials file directly
                        res.setHeader('Content-Type', 'application/json');
                        res.setHeader('Content-Disposition', `attachment; filename="zuko-creds-${id}.json"`);
                        res.sendFile(credsPath, (err) => {
                            if (err) {
                                logger.error("Failed to send credentials file:", err);
                                if (!res.headersSent) {
                                    res.status(500).json({ error: "Failed to send credentials" });
                                }
                            }
                        });

                        // Send success message to user
                        const successMsg = `*Hello there ZUKO-MD User! 👋🏻*\n\n` +
                            `✅ *Successfully connected!*\n\n` +
                            `🔐 *Your session credentials have been generated.*\n\n` +
                            `📺 *Join our WhatsApp Channel:*\n` +
                            `https://whatsapp.com/channel/0029Vb5iurcFsn0g8SxxBs0p\n\n` +
                            `⭐ *Fork the repo:*\n` +
                            `https://github.com/Neggy5/ZUKO-MD\n\n` +
                            `*© Powered by ZUKO-MD 🖤*`;

                        await sock.sendMessage(sock.user.id, { 
                            text: successMsg,
                            contextInfo: {
                                externalAdReply: {
                                    title: "ZUKO-MD",
                                    thumbnailUrl: "https://files.catbox.moe/y7yry1.jpg",
                                    sourceUrl: "https://whatsapp.com/channel/0029Vb5iurcFsn0g8SxxBs0p",
                                    mediaType: 1,
                                    renderLargerThumbnail: true
                                }  
                            }
                        });

                    } catch (e) {
                        logger.error("Error during session creation:", e);
                        
                        const errorMsg = `*Error Occurred!*\n\n` +
                            `⚠️ *Failed to generate session*\n\n` +
                            `Please try again or contact support if the issue persists.\n\n` +
                            `*Error Details:*\n` +
                            `${e.message}\n\n` +
                            `*GitHub:* https://github.com/Neggy5/ZUKO-MD`;

                        await sock.sendMessage(sock.user.id, { 
                            text: errorMsg,
                            contextInfo: {
                                externalAdReply: {
                                    title: "ZUKO-MD Error",
                                    thumbnailUrl: "https://files.catbox.moe/y7yry1.jpg",
                                    sourceUrl: "https://github.com/Neggy5/ZUKO-MD/issues",
                                    mediaType: 1
                                }  
                            }
                        });

                        if (!res.headersSent) {
                            res.status(500).json({ error: e.message });
                        }
                    } finally {
                        await sock.ws.close();
                        removeFile(sessionDir);
                        logger.info(`Session ${id} completed for ${sock.user?.id || 'unknown'}`);
                        process.exit(0);
                    }
                } 
                else if (connection === "close" && lastDisconnect?.error) {
                    logger.warn("Connection closed, attempting reconnect...");
                    await delay(2000);
                    handlePairing().catch(err => {
                        logger.error("Reconnect failed:", err);
                        if (!res.headersSent) {
                            res.status(500).json({ error: "Connection failed" });
                        }
                    });
                }
            });

            if (!sock.authState.creds.registered) {
                await delay(1000);
                const cleanNum = num.replace(/[^0-9]/g, '');
                
                if (cleanNum.length < 11) {
                    throw new Error("Invalid phone number format");
                }

                const code = await sock.requestPairingCode(cleanNum);
                if (!res.headersSent) {
                    res.json({ code });
                }
            }

        } catch (err) {
            logger.error("Pairing error:", err);
            removeFile(sessionDir);
            
            if (!res.headersSent) {
                res.status(500).json({ 
                    error: "Service unavailable", 
                    details: err.message 
                });
            }
        }
    }

    return handlePairing();
});

module.exports = router;