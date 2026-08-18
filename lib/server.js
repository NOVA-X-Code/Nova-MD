import express from 'express';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';
import pairingManager from './pairingManager.js';
import { delay } from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VIEWS_DIR = path.join(__dirname, 'views');

// S'assurer que le dossier views existe
if (!fs.existsSync(VIEWS_DIR)) {
    fs.mkdirSync(VIEWS_DIR, { recursive: true });
}

const packageInfo = {
    name: config.botName || 'NOVA-MD',
    version: config.version || '2.0.0',
    description: config.description || 'WhatsApp Bot',
    author: config.author || 'NOSTRA'
};

const app = express();
const server = createServer(app);
const PORT = config.port || 5000;

// Middleware
app.use(express.json());

// ═══════════════════════════════════════════════════════════
// ROUTES HTML (VUES)
// ═══════════════════════════════════════════════════════════

/**
 * GET /pairing - Page principale
 */
app.get('/pairing', (req, res) => {
    const mainHtml = fs.readFileSync(path.join(VIEWS_DIR, 'main.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(mainHtml);
});

/**
 * GET /api/pairing/qr - Vue QR code
 */
app.get('/api/pairing/qr', (req, res) => {
    const qrHtml = fs.readFileSync(path.join(VIEWS_DIR, 'qr.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(qrHtml);
});

/**
 * GET /api/pairing/pair - Vue Pairing Code
 */
app.get('/api/pairing/pair', (req, res) => {
    const pairHtml = fs.readFileSync(path.join(VIEWS_DIR, 'pair.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(pairHtml);
});

/**
 * GET /api/pairing/session/status - Vérifie si une session existe
 */
app.get('/api/pairing/session/status', (req, res) => {
    const credsPath = path.join(process.cwd(), 'session', 'creds.json');
    const hasSession = fs.existsSync(credsPath);
    res.json({ hasSession });
});

// ═══════════════════════════════════════════════════════════
// PAIRING API ROUTES
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/pairing/qr/init - Initialise une session QR
 */
app.get('/api/pairing/qr/init', async (req, res) => {
    try {
        const sessionId = await pairingManager.createQRSession();
        const result = await pairingManager.initiateQRSession(sessionId);

        if (result.type === 'qr') {
            return res.json({
                sessionId: result.sessionId,
                qr: result.qr,
                message: 'QR Code Generated! Scan with WhatsApp app.',
                instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
            });
        }
    } catch (error) {
        console.error('Error initializing QR session:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/pairing/qr/check/:sessionId - Vérifie si la session QR est complétée
 */
app.get('/api/pairing/qr/check/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const isComplete = pairingManager.isSessionComplete(sessionId);
    
    // Si la session est complétée, attendre un peu que le fichier soit bien enregistré
    if (isComplete) {
        // Vérifier que le fichier creds.json existe et est valide
        const credsPath = path.join(process.cwd(), 'session', 'creds.json');
        if (fs.existsSync(credsPath)) {
            try {
                const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                if (creds.registered === true) {
                    return res.json({ sessionId, completed: true });
                } else {
                    // Session copiée mais pas encore registered
                    console.log('⏳ Session copied but waiting for registration...');
                    return res.json({ sessionId, completed: false });
                }
            } catch (e) {
                return res.json({ sessionId, completed: false });
            }
        }
    }
    
    res.json({ sessionId, completed: isComplete });
});
/**
 * POST /api/pairing/pair/init - Initialise une session de pairing avec code
 */
app.post('/api/pairing/pair/init', async (req, res) => {
    try {
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        const sessionId = await pairingManager.createPairSession(phoneNumber);
        const result = await pairingManager.initiatePairSession(sessionId);

        if (result.type === 'pair') {
            return res.json({
                sessionId: result.sessionId,
                code: result.code,
                phoneNumber: result.phoneNumber,
                message: 'Use this code in WhatsApp'
            });
        }
    } catch (error) {
        console.error('Error initializing pair session:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/pairing/pair/check/:sessionId - Vérifie si la session pair est complétée
 */
app.get('/api/pairing/pair/check/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const isComplete = pairingManager.isSessionComplete(sessionId);

    res.json({
        sessionId,
        completed: isComplete
    });
});

// ═══════════════════════════════════════════════════════════
// MAIN ROUTES
// ═══════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeString = `${hours}h ${minutes}m ${seconds}s`;
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${packageInfo.name.toUpperCase()} Status</title>
        <style>
            :root { --primary: #25d366; --bg: #0f172a; --card-bg: rgba(30, 41, 59, 0.7); }
            body { 
                margin: 0; padding: 0; background: var(--bg); color: white; 
                font-family: 'Inter', system-ui, sans-serif;
                display: flex; justify-content: center; align-items: center; min-height: 100vh;
            }
            .container {
                background: var(--card-bg); backdrop-filter: blur(12px);
                border: 1px solid rgba(255,255,255,0.1); padding: 30px;
                border-radius: 24px; width: 90%; max-width: 400px; text-align: center;
                box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            }
            .status-badge {
                display: inline-flex; align-items: center; background: rgba(37, 211, 102, 0.1);
                color: var(--primary); padding: 5px 15px; border-radius: 50px;
                font-size: 0.8rem; font-weight: bold; margin-bottom: 20px;
            }
            .dot { height: 8px; width: 8px; background: var(--primary); border-radius: 50%; margin-right: 8px; box-shadow: 0 0 10px var(--primary); }
            h1 { margin: 0; font-size: 1.8rem; letter-spacing: 1px; }
            .desc { color: #94a3b8; margin: 10px 0 25px 0; font-size: 0.9rem; }
            .grid { display: grid; gap: 12px; }
            .item { 
                background: rgba(0,0,0,0.2); padding: 12px 18px;
                border-radius: 12px; display: flex; justify-content: space-between;
            }
            .label { color: #64748b; font-size: 0.75rem; text-transform: uppercase; font-weight: 800; }
            .val { font-weight: 600; font-family: monospace; color: #f1f5f9; }
            footer { margin-top: 25px; font-size: 0.7rem; color: #475569; }
            .pairing-link {
                margin-top: 20px;
                padding: 12px;
                background: rgba(37, 211, 102, 0.1);
                border-radius: 12px;
            }
            .pairing-link a {
                color: var(--primary);
                text-decoration: none;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="status-badge"><span class="dot"></span> SYSTEM ONLINE</div>
            <h1>${packageInfo.name.toUpperCase()}</h1>
            <p class="desc">${packageInfo.description}</p>
            
            <div class="grid">
                <div class="item"><span class="label">Version</span><span class="val">${packageInfo.version}</span></div>
                <div class="item"><span class="label">Author</span><span class="val">${packageInfo.author}</span></div>
                <div class="item"><span class="label">Uptime</span><span class="val">${uptimeString}</span></div>
            </div>

            <div class="pairing-link">
                🔗 <a href="/pairing">Click here to connect WhatsApp</a>
            </div>

            <footer>POWERED BY NOSTRA</footer>
        </div>
    </body>
    </html>
    `);
});

app.get('/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        memory: {
            rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`
        },
        version: packageInfo.version,
        bot: packageInfo.name,
        timestamp: new Date().toISOString()
    });
});

export { app, server, PORT };
