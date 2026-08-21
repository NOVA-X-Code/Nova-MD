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

    /**
     * Crée une nouvelle session de pairing avec QR Code
     */
    async createQRSession() {
        const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
        const sessionDir = `./temp_session_${sessionId}`;

        const sessionData = {
            sessionId,
            sessionDir,
            qrGenerated: false,
            sessionCompleted: false,
            responseSent: false,
            reconnectAttempts: 0,
            currentSocket: null,
            timeoutHandle: null,
            isCleaningUp: false,
            createdAt: Date.now(),
            mode: 'qr'
        };

        this.sessions.set(sessionId, sessionData);
        return sessionId;
    }

    /**
     * Crée une nouvelle session de pairing avec Pairing Code
     */
    async createPairSession(phoneNumber) {
        if (!phoneNumber) throw new Error('Phone number is required');

        // Valider le numéro de téléphone
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        const phone = pn('+' + phoneNumber);
        if (!phone.isValid()) throw new Error('Invalid phone number');

        phoneNumber = phone.getNumber('e164').replace('+', '');

        const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
        const sessionDir = `./temp_session_${sessionId}`;

        const sessionData = {
            sessionId,
            sessionDir,
            phoneNumber,
            pairingCodeSent: false,
            sessionCompleted: false,
            responseSent: false,
            reconnectAttempts: 0,
            currentSocket: null,
            timeoutHandle: null,
            isCleaningUp: false,
            createdAt: Date.now(),
            mode: 'pair'
        };

        this.sessions.set(sessionId, sessionData);
        return sessionId;
    }

    /**
     * Supprime les fichiers de session temporaires
     */
    async removeSessionDir(dirPath) {
        try {
            if (await fs.pathExists(dirPath)) {
                await fs.remove(dirPath);
                return true;
            }
        } catch (e) {
            console.error('Error removing session dir:', e);
        }
        return false;
    }

    /**
     * Nettoie les sessions expirées
     */
    async cleanupSessions() {
        const now = Date.now();
        const expiredSessions = [];

        for (const [sessionId, data] of this.sessions.entries()) {
            if (now - data.createdAt > SESSION_TIMEOUT) {
                expiredSessions.push(sessionId);
            }
        }

        for (const sessionId of expiredSessions) {
            const data = this.sessions.get(sessionId);
            await this.cleanup(sessionId, 'session_expired');
        }
    }

        /**
     * Nettoie une session (Version Corrigée)
     */
    async cleanup(sessionId, reason = 'unknown') {
        const data = this.sessions.get(sessionId);
        if (!data) return;

        if (data.isCleaningUp) return;

        console.log(`🧹 Cleanup session ${sessionId} - ${reason}`);

        // 🔄 CORRECTION CRITIQUE : Si la session est réussie, on ne détruit PAS le socket !
        if (reason === 'session_complete' || data.sessionCompleted) {
            if (data.timeoutHandle) {
                clearTimeout(data.timeoutHandle);
                data.timeoutHandle = null;
            }
            // On retire simplement la session de la liste d'attente de l'interface Web
            this.sessions.delete(sessionId);
            console.log(`✅ Socket handed over to index.js successfully.`);
            return; // On s'arrête ici pour laisser la connexion vivante
        }

        // Si ce n'est PAS une réussite (Ex: timeout, expiration), on nettoie tout normalement
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
     * Lance la session de pairing QR
     */
    async initiateQRSession(sessionId) {
        const data = this.sessions.get(sessionId);
        if (!data) throw new Error('Session not found');

        return new Promise(async (resolve, reject) => {
            try {
                const { version } = await fetchLatestBaileysVersion();

                // Créer le répertoire de session
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
                    defaultQueryTimeoutMs: 120000,
                    connectTimeoutMs: 60000,
                    keepAliveIntervalMs: 30000,
                    retryRequestDelayMs: 250,
                    maxRetries: 3
                });

                const sock = data.currentSocket;

                // Gestion du QR Code
                const handleQRCode = async (qr) => {
                    if (data.qrGenerated || data.sessionCompleted || data.isCleaningUp) return;
                    data.qrGenerated = true;

                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' });
                        resolve({
                            type: 'qr',
                            qr: qrDataURL,
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
                            await delay(15000); // Attendre un peu pour s'assurer que les credentials sont écrits
                            const tempCredsPath = `${data.sessionDir}/creds.json`;
                            const mainSessionDir = './session';

                            if (!await fs.pathExists(mainSessionDir)) {
                                await fs.mkdir(mainSessionDir, { recursive: true });
                            }

                            let isRegistered = false;
                            for (let attempt = 0; attempt < 10; attempt++) { // Limite à 10 tentatives) { 
                                if (fs.existsSync(tempCredsPath)) {
                                    const credsData = JSON.parse(await fs.readFile(tempCredsPath, 'utf-8'));
                                    
                                    // Si WhatsApp a enfin écrit "registered: true", on passe la variable à true
                                    if (credsData.registered === true) {
                                        isRegistered = true; 
                                        break; // On sort immédiatement de la boucle d'attente
                                    }
                                }
                                // Si ce n'est pas encore écrit, on attend 2 secondes avant de relire le fichier
                                await delay(1000); 
                            }

                            if (!isRegistered) {
                                console.log('⚠️ Validation trop longue, copie de sauvegarde lancée par sécurité.');
                            }

                            // Une fois validé, on bascule le statut et on copie
                            data.sessionCompleted = true;
                            
                            if (await fs.pathExists(tempCredsPath)) {
                                await fs.copy(data.sessionDir, mainSessionDir);
                                console.log('✅ Session credentials saved to main session directory');
                            }

                            if (fs.existsSync(tempCredsPath)) {
                                // Lire les credentials
                                const credsData = JSON.parse(await fs.readFile(tempCredsPath, 'utf-8'));
    
                                // Sauvegarder en base de données (MongoDB, PostgreSQL, MySQL)
                                let phoneNumber = data.phoneNumber || null;
                                
                                // Si on utilise le QR code, data.phoneNumber est vide. On extrait le numéro depuis l'objet me.id
                                if (!phoneNumber && credsData.me && credsData.me.id) {
                                    // credsData.me.id ressemble à "237676250509:2@s.whatsapp.net"
                                    // split(':')[0] va proprement isoler le numéro "237676250509"
                                    phoneNumber = credsData.me.id.split(':')[0];
                                }
                                
                                const sessionId = await sessionManager.saveSession(credsData, phoneNumber);
    
                                console.log(`✅ Session saved to database: ${sessionId}`);
    
                                // Envoyer l'ID de session à l'utilisateur
                                const userJid = Object.keys(sock.authState.creds.me || {}).length > 0
                                 ? jidNormalizedUser(sock.authState.creds.me.id)
                                : jidNormalizedUser(data.phoneNumber + '@s.whatsapp.net');
    
                                if (userJid) {
                                    const msg = await sock.sendMessage(userJid, { 
                                        text: `✅ *Session ID:* \`${sessionId}\`\n\n📌 *SESSION SAVED INSIDE YOUR DATABASE DON'T SHARE IT* ✅` 
                                    });
                                    await sock.sendMessage(userJid, { text: MESSAGE, quoted: msg });
                                }
                            }
                        } catch (err) {
                            console.error('Error saving session:', err);
                        } finally {
                                setTimeout(async () => { // ✅ MODIFIÉ
                                    await this.cleanup(sessionId, 'session_complete');
                                }, 10000);
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

                // Timeout de session
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
     * Lance la session de pairing avec code
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
                            for (let attempt = 0; attempt < 10; attempt++) { // Limite à 10 tentatives) {
                                if (fs.existsSync(tempCredsPath)) {
                                    const credsData = JSON.parse(await fs.readFile(tempCredsPath, 'utf-8'));
                                    
                                    // Si WhatsApp a enfin écrit "registered: true", on passe la variable à true
                                    if (credsData.registered === true) {
                                        isRegistered = true; 
                                        break; // On sort immédiatement de la boucle d'attente
                                    }
                                }
                                // Si ce n'est pas encore écrit, on attend 2 secondes avant de relire le fichier
                                await delay(3000); 
                            }

                            if (!isRegistered) {
                                console.log('⚠️ Validation trop longue, copie de sauvegarde lancée par sécurité.');
                            }

                            // Une fois validé, on bascule le statut et on copie
                            data.sessionCompleted = true;
                            
                            if (await fs.pathExists(tempCredsPath)) {
                                await fs.copy(data.sessionDir, mainSessionDir);
                                console.log('✅ Session credentials saved to main session directory');
                            }

                            await delay(3000);

                            if (fs.existsSync(tempCredsPath)) {
                                // Lire les credentials
                                const credsData = JSON.parse(await fs.readFile(tempCredsPath, 'utf-8'));
    
                                // Sauvegarder en base de données (MongoDB, PostgreSQL, MySQL)
                                const phoneNumber = data.phoneNumber || Object.keys(credsData.me || {})[0]?.split('@')[0] || null;
                                const sessionId = await sessionManager.saveSession(credsData, phoneNumber);
    
                                console.log(`✅ Session saved to database: ${sessionId}`);
    
                                // Envoyer l'ID de session à l'utilisateur
                                const userJid = Object.keys(sock.authState.creds.me || {}).length > 0
                                 ? jidNormalizedUser(sock.authState.creds.me.id)
                                : jidNormalizedUser(data.phoneNumber + '@s.whatsapp.net');
    
                                if (userJid) {
                                    await delay(1000);
                                    const msg = await sock.sendMessage(userJid, { 
                                        text: `✅ *Session ID:* \`${sessionId}\`\n\n📌 *SESSION SAVED INSIDE YOUR DATABASE DON'T SHARE IT* ✅` 
                                    });
                                    await sock.sendMessage(userJid, { text: MESSAGE, quoted: msg });
                                }
                            }
                        } catch (err) {
                            console.error('Error saving session:', err);
                        } finally {
                                setTimeout(async () => { // ✅ MODIFIÉ
                                    await this.cleanup(sessionId, 'session_complete');
                                }, 10000);
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

                // Attendre un peu avant de demander le code
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

                // Timeout
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
     * Vérifie si la session est complétée
     */
    isSessionComplete(sessionId) {
        const data = this.sessions.get(sessionId);
        if (!data) return false;

        // 1. On vérifie le drapeau de base
        if (!data.sessionCompleted) return false;

        try {
            // 2. CORRECTION CRITIQUE : On va lire le vrai fichier creds.json sur le disque
            const tempCredsPath = `${data.sessionDir}/creds.json`;
            const mainCredsPath = './session/creds.json';
            
            // On regarde d'abord dans le dossier principal, sinon dans le dossier temporaire
            let filePath = fs.existsSync(mainCredsPath) ? mainCredsPath : (fs.existsSync(tempCredsPath) ? tempCredsPath : null);
            
            if (filePath) {
                const credsData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                // La session n'est VRAIMENT complète que si WhatsApp a écrit "registered: true"
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
