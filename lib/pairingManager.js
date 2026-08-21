/**
 * Pairing Manager - Gère le cycle de vie du pairing web
 * Intègre QR et Pairing Code dans un flux unifié
 */

import fs from 'fs-extra';
import pino from 'pino';
import QRCode from 'qrcode';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    DisconnectReason,
    delay
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import sessionManager from './sessionManager.js';

const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const MESSAGE = `
*LOGIN SUCCESSFULL* ✅

*Gɪᴠᴇ ᴀ ꜱᴛᴀʀ ᴛᴏ ʀᴇᴘᴏ ꜰᴏʀ ᴄᴏᴜʀᴀɢᴇ* 🌟
https://github.com/NOVA-X-Code/Nova-MD

*Sᴜᴘᴘᴏʀᴛ Gʀᴏᴜᴘ ꜰᴏʀ ϙᴜᴇʀʏ* 💭
https://t.me/Nostra_DigitalCenter
https://t.me/LaboKingFreeSurf
https://whatsapp.com/channel/0029Vb8ZJnsAYlUHo1uA6W0y

*NOSTRA COMMUNITY*
https://chat.whatsapp.com/LUkXjJNfWrT8Fz7akxosH0
*Yᴏᴜ-ᴛᴜʙᴇ ᴛᴜᴛᴏʀɪᴀʟꜱ* 🪄 
https://youtube.com/@LaboKingFreeSurf

*NOVA-MD--WHATSAPP* 🥀
`;

class PairingManager {
    constructor() {
        this.sessions = new Map();
        this.cleanupInterval = setInterval(() => this.cleanupSessions(), 60000);
    }

    // ... (createQRSession, createPairSession, removeSessionDir, cleanupSessions restent inchangés)

    /**
     * Nettoie une session (Version Corrigée)
     */
    async cleanup(sessionId, reason = 'unknown') {
        const data = this.sessions.get(sessionId);
        if (!data) return;
        if (data.isCleaningUp) return;

        console.log(`🧹 Cleanup session ${sessionId} - ${reason}`);

        // ✅ Si la session est complète, on ne détruit PAS le socket
        if (reason === 'session_complete' || data.sessionCompleted) {
            if (data.timeoutHandle) {
                clearTimeout(data.timeoutHandle);
                data.timeoutHandle = null;
            }
            // On retire simplement la session de la mémoire
            this.sessions.delete(sessionId);
            console.log(`✅ Session ${sessionId} marked as complete and removed from memory`);
            return; // ← On garde le socket vivant !
        }

        // ❌ Si ce n'est PAS une réussite, on nettoie tout
        data.isCleaningUp = true;

        if (data.timeoutHandle) {
            clearTimeout(data.timeoutHandle);
            data.timeoutHandle = null;
        }

        if (data.currentSocket) {
            try {
                data.currentSocket.ev.removeAllListeners();
                await data.currentSocket.end();
            } catch (e) {}
            data.currentSocket = null;
        }

        setTimeout(async () => {
            await this.removeSessionDir(data.sessionDir);
            this.sessions.delete(sessionId);
        }, 5000);
    }

    /**
     * Lance la session de pairing QR (Version Corrigée)
     */
    async initiateQRSession(sessionId) {
        const data = this.sessions.get(sessionId);
        if (!data) throw new Error('Session not found');

        return new Promise(async (resolve, reject) => {
            try {
                const { version } = await fetchLatestBaileysVersion();

                if (!await fs.pathExists(data.sessionDir)) {
                    await fs.mkdir(data.sessionDir, { recursive: true });
                }

                const { state, saveCreds } = await useMultiFileAuthState(data.sessionDir);

                data.currentSocket = makeWASocket({
                    version,
                    logger: pino({ level: 'silent' }),
                    browser: Browsers.macOS('Chrome'),
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
                    },
                    printQRInTerminal: false,
                    markOnlineOnConnect: false,
                    generateHighQualityLinkPreview: false,
                    defaultQueryTimeoutMs: 60000,
                    connectTimeoutMs: 60000,
                    keepAliveIntervalMs: 30000,
                    retryRequestDelayMs: 250,
                    maxRetries: 3
                });

                const sock = data.currentSocket;

                const handleQRCode = async (qr) => {
                    if (data.qrGenerated || data.sessionCompleted || data.isCleaningUp) return;
                    data.qrGenerated = true;

                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' });
                        resolve({
                            type: 'qr',
                            qr: qrDataURL,
                            sessionId
                        });
                    } catch (err) {
                        console.error('Error generating QR code:', err);
                        reject(err);
                    }
                };

                sock.ev.on('connection.update', async (update) => {
                    if (data.isCleaningUp) return;

                    const { connection, lastDisconnect, qr, isNewLogin } = update;

                    if (qr && !data.qrGenerated && !data.sessionCompleted) {
                        await handleQRCode(qr);
                    }

                    if (connection === 'open') {
                        if (data.sessionCompleted) return;

                        try {
                            await delay(15000);
                            const tempCredsPath = `${data.sessionDir}/creds.json`;
                            const mainSessionDir = './session';

                            if (!await fs.pathExists(mainSessionDir)) {
                                await fs.mkdir(mainSessionDir, { recursive: true });
                            }

                            // ✅ 1. Attendre que le fichier soit valide
                            let isRegistered = false;
                            let credsData = null;
                            
                            for (let attempt = 0; attempt < 10; attempt++) {
                                if (fs.existsSync(tempCredsPath)) {
                                    try {
                                        const rawData = await fs.readFile(tempCredsPath, 'utf-8');
                                        credsData = JSON.parse(rawData);
                                        
                                        if (credsData.registered === true) {
                                            isRegistered = true;
                                            console.log(`✅ Credentials registered after ${attempt + 1} attempts`);
                                            break;
                                        }
                                    } catch (parseError) {
                                        console.log(`⚠️ Attempt ${attempt + 1}: Invalid JSON, retrying...`);
                                    }
                                }
                                if (attempt < 9) await delay(1000);
                            }

                            // ✅ 2. Marquer comme complété
                            data.sessionCompleted = true;

                            if (!isRegistered || !credsData) {
                                console.log('⚠️ Validation trop longue, copie de sauvegarde lancée par sécurité.');
                                if (await fs.pathExists(tempCredsPath)) {
                                    await fs.copy(data.sessionDir, mainSessionDir);
                                    console.log('📁 Session credentials copied (fallback)');
                                }
                            } else {
                                // ✅ 3. Copie et sauvegarde UNIQUEMENT si enregistré
                                if (await fs.pathExists(tempCredsPath)) {
                                    await fs.copy(data.sessionDir, mainSessionDir);
                                    console.log('✅ Session credentials saved to main session directory');

                                    // ✅ 4. Extraire le numéro
                                    let phoneNumber = data.phoneNumber || null;
                                    
                                    if (!phoneNumber && credsData.me && credsData.me.id) {
                                        phoneNumber = credsData.me.id.split(':')[0];
                                    }
                                    
                                    // ✅ 5. Sauvegarder en DB avec un NOM DIFFÉRENT
                                    const savedId = await sessionManager.saveSession(credsData, phoneNumber);
                                    console.log(`✅ Session saved to database: ${savedId}`);

                                    // ✅ 6. Envoyer le message
                                    const userJid = sock.authState.creds.me?.id 
                                        ? jidNormalizedUser(sock.authState.creds.me.id)
                                        : jidNormalizedUser(data.phoneNumber + '@s.whatsapp.net');

                                    if (userJid) {
                                        const msg = await sock.sendMessage(userJid, { 
                                            text: `✅ *Session ID:* \`${savedId}\`\n\n📌 *SESSION SAVED INSIDE YOUR DATABASE DON'T SHARE IT* ✅` 
                                        });
                                        await sock.sendMessage(userJid, { text: MESSAGE, quoted: msg });
                                    }
                                }
                            }

                            // ✅ 7. Nettoyage APRÈS le try, pas dans le finally
                            setTimeout(async () => {
                                await this.cleanup(sessionId, 'session_complete');
                            }, 10000);

                        } catch (err) {
                            console.error('❌ Error saving session:', err);
                        }
                    }

                    if (isNewLogin) console.log(`🔐 New login via QR code`);

                    if (connection === 'close') {
                        if (data.sessionCompleted || data.isCleaningUp) {
                            await this.cleanup(sessionId, 'already_complete');
                            return;
                        }

                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                            await this.cleanup(sessionId, 'logged_out');
                            reject(new Error('Invalid QR code or session expired'));
                        } else {
                            if (data.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                                data.reconnectAttempts++;
                                await delay(2000);
                                await this.initiateQRSession(sessionId);
                            } else {
                                await this.cleanup(sessionId, 'max_reconnects');
                                reject(new Error('Max reconnection attempts reached'));
                            }
                        }
                    }
                });

                sock.ev.on('creds.update', saveCreds);

                data.timeoutHandle = setTimeout(async () => {
                    if (!data.sessionCompleted && !data.isCleaningUp) {
                        await this.cleanup(sessionId, 'timeout');
                        reject(new Error('Session timeout'));
                    }
                }, SESSION_TIMEOUT);

            } catch (err) {
                console.error('Error initiating QR session:', err);
                reject(err);
            }
        });
    }

    /**
     * Lance la session de pairing avec code (Version Corrigée)
     */
    async initiatePairSession(sessionId) {
        const data = this.sessions.get(sessionId);
        if (!data) throw new Error('Session not found');

        return new Promise(async (resolve, reject) => {
            try {
                const { version } = await fetchLatestBaileysVersion();

                if (!await fs.pathExists(data.sessionDir)) {
                    await fs.mkdir(data.sessionDir, { recursive: true });
                }

                const { state, saveCreds } = await useMultiFileAuthState(data.sessionDir);

                data.currentSocket = makeWASocket({
                    version,
                    logger: pino({ level: 'silent' }),
                    browser: Browsers.macOS('Chrome'),
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
                    },
                    printQRInTerminal: false,
                    markOnlineOnConnect: false,
                    generateHighQualityLinkPreview: false,
                    defaultQueryTimeoutMs: 60000,
                    connectTimeoutMs: 60000,
                    keepAliveIntervalMs: 30000,
                    retryRequestDelayMs: 250,
                    maxRetries: 3
                });

                const sock = data.currentSocket;

                sock.ev.on('connection.update', async (update) => {
                    if (data.isCleaningUp) return;

                    const { connection, lastDisconnect, isNewLogin } = update;

                    if (connection === 'open') {
                        if (data.sessionCompleted) return;

                        try {
                            const tempCredsPath = `${data.sessionDir}/creds.json`;
                            const mainSessionDir = './session';

                            if (!await fs.pathExists(mainSessionDir)) {
                                await fs.mkdir(mainSessionDir, { recursive: true });
                            }

                            let isRegistered = false;
                            let credsData = null;
                            
                            for (let attempt = 0; attempt < 10; attempt++) {
                                if (fs.existsSync(tempCredsPath)) {
                                    try {
                                        const rawData = await fs.readFile(tempCredsPath, 'utf-8');
                                        credsData = JSON.parse(rawData);
                                        
                                        if (credsData.registered === true) {
                                            isRegistered = true;
                                            console.log(`✅ Credentials registered after ${attempt + 1} attempts`);
                                            break;
                                        }
                                    } catch (parseError) {
                                        console.log(`⚠️ Attempt ${attempt + 1}: Invalid JSON, retrying...`);
                                    }
                                }
                                if (attempt < 9) await delay(3000);
                            }

                            data.sessionCompleted = true;

                            if (!isRegistered || !credsData) {
                                console.log('⚠️ Validation trop longue, copie de sauvegarde lancée par sécurité.');
                                if (await fs.pathExists(tempCredsPath)) {
                                    await fs.copy(data.sessionDir, mainSessionDir);
                                    console.log('📁 Session credentials copied (fallback)');
                                }
                            } else {
                                if (await fs.pathExists(tempCredsPath)) {
                                    await fs.copy(data.sessionDir, mainSessionDir);
                                    console.log('✅ Session credentials saved to main session directory');

                                    await delay(3000);

                                    const phoneNumber = data.phoneNumber || credsData.me?.id?.split(':')[0] || null;
                                    const savedId = await sessionManager.saveSession(credsData, phoneNumber);
                                    console.log(`✅ Session saved to database: ${savedId}`);

                                    const userJid = sock.authState.creds.me?.id 
                                        ? jidNormalizedUser(sock.authState.creds.me.id)
                                        : jidNormalizedUser(data.phoneNumber + '@s.whatsapp.net');

                                    if (userJid) {
                                        await delay(1000);
                                        const msg = await sock.sendMessage(userJid, { 
                                            text: `✅ *Session ID:* \`${savedId}\`\n\n📌 *SESSION SAVED INSIDE YOUR DATABASE DON'T SHARE IT* ✅` 
                                        });
                                        await sock.sendMessage(userJid, { text: MESSAGE, quoted: msg });
                                    }
                                }
                            }

                            setTimeout(async () => {
                                await this.cleanup(sessionId, 'session_complete');
                            }, 10000);

                        } catch (err) {
                            console.error('❌ Error saving session:', err);
                        }
                    }

                    if (isNewLogin) console.log(`🔐 New login via pair code for ${data.phoneNumber}`);

                    if (connection === 'close') {
                        if (data.sessionCompleted || data.isCleaningUp) {
                            await this.cleanup(sessionId, 'already_complete');
                            return;
                        }

                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                            await this.cleanup(sessionId, 'logged_out');
                            reject(new Error('Invalid pairing code or session expired'));
                        } else if (data.pairingCodeSent && !data.sessionCompleted) {
                            if (data.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                                data.reconnectAttempts++;
                                await delay(2000);
                                await this.initiatePairSession(sessionId);
                            } else {
                                await this.cleanup(sessionId, 'max_reconnects');
                                reject(new Error('Max reconnection attempts reached'));
                            }
                        }
                    }
                });

                if (!sock.authState.creds.registered && !data.pairingCodeSent && !data.isCleaningUp) {
                    await delay(1500);
                    try {
                        data.pairingCodeSent = true;
                        let code = await sock.requestPairingCode(data.phoneNumber);
                        code = code?.match(/.{1,4}/g)?.join('-') || code;

                        resolve({
                            type: 'pair',
                            code,
                            sessionId,
                            phoneNumber: data.phoneNumber
                        });
                    } catch (error) {
                        data.pairingCodeSent = false;
                        reject(new Error('Failed to get pairing code: ' + error.message));
                    }
                }

                sock.ev.on('creds.update', saveCreds);

                data.timeoutHandle = setTimeout(async () => {
                    if (!data.sessionCompleted && !data.isCleaningUp) {
                        await this.cleanup(sessionId, 'timeout');
                        reject(new Error('Pairing timeout'));
                    }
                }, SESSION_TIMEOUT);

            } catch (err) {
                console.error('Error initiating pair session:', err);
                reject(err);
            }
        });
    }

    /**
     * Vérifie si la session est complétée (Version Corrigée)
     */
    isSessionComplete(sessionId) {
        const data = this.sessions.get(sessionId);
        if (!data) return false;

        if (!data.sessionCompleted) return false;

        try {
            const tempCredsPath = `${data.sessionDir}/creds.json`;
            const mainCredsPath = './session/creds.json';
            
            let filePath = fs.existsSync(mainCredsPath) ? mainCredsPath : (fs.existsSync(tempCredsPath) ? tempCredsPath : null);
            
            if (filePath) {
                const credsData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                return credsData.registered === true;
            }
        } catch (e) {
            console.error("Error verifying physical creds in isSessionComplete:", e);
            return false;
        }

        return false;
    }
}

// Export singleton
export default new PairingManager();