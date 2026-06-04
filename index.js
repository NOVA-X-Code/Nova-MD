import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, isJidGroup, Browsers, makeCacheableSignalKeyStore, delay } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import axios from 'axios';
import pino from 'pino';
import { createLogger } from './utils/logger.js';
import AuthManager from './utils/auth-manager.js';
import DatabaseManager from './core/database-manager.js';
import AIHandler from './core/ai-handler.js';
import TimerManager from './core/timer-manager.js';
import CommandExecutor from './core/command-executor.js';
import handleAILogin from './commands/ai-login.js';
import handleQuiz from './commands/quiz.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger(import.meta.url);

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 3000;
const OWNER_NUMBER = process.env.OWNER_NUMBER || '';
const IS_PRIVATE = process.env.IS_PRIVATE === 'true';
const ENABLE_AI = process.env.ENABLE_AI_ASSISTANT === 'true';
const AI_RESPONSE_DELAY = parseInt(process.env.AI_RESPONSE_DELAY || '120000');

if (!OWNER_NUMBER) {
    log.error('❌ OWNER_NUMBER non défini dans .env');
    process.exit(1);
}

// ============================================
// INITIALISATION
// ============================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let sock = null;
let qrCodeUrl = null;
let isConnected = false;
let authManager = new AuthManager();
let databaseManager = null;
let aiHandler = null;
let timerManager = new TimerManager(AI_RESPONSE_DELAY);
let commandExecutor = null;
let connectionErrorCount = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

// ============================================
// DÉMARRAGE
// ============================================
async function start() {
    try {
        log.info('🚀 Démarrage de NOVA-MD...');

        // Initialiser l'authentification
        await authManager.initializeSessionDir();
        
        // Vérifier si une session existante est corrompue
        const sessionExists = await authManager.sessionExists();
        if (sessionExists) {
            log.info('🔍 Vérification session existante...');
            // Essayer de charger - si ça échoue, nettoyer
            try {
                const existingAuth = await authManager.loadAuthState();
                if (!existingAuth || !existingAuth.creds) {
                    log.warn('⚠️  Session corrompue détectée - nettoyage...');
                    await authManager.clearAuthState();
                }
            } catch (err) {
                log.warn('⚠️  Impossible de charger session - nettoyage...');
                await authManager.clearAuthState();
            }
        }

        // Initialiser la base de données (non-blocking)
        if (process.env.DATABASE_URL) {
            databaseManager = new DatabaseManager(process.env.DATABASE_URL);
            // Don't await - let it initialize in background to not block WhatsApp socket
            databaseManager.initialize().catch(err => {
                log.warn('⚠️  Erreur initialisation DB:', err.message);
            });
        } else {
            log.warn('⚠️  DATABASE_URL non défini - fonctionnalité de messages supprimés désactivée');
        }

        // Initialiser l'IA (Groq - Gratuit)
        if (ENABLE_AI) {
            aiHandler = new AIHandler(
                process.env.GROQ_API_KEY,
                process.env.AI_SYSTEM_PROMPT
            );
            log.info('✅ Assistant IA NOVA (Groq) initialisé - Powered by Nostra');
        } else {
            log.warn('⚠️  ENABLE_AI_ASSISTANT désactivé');
        }

        // Charger les états d'authentification
        const { state, saveCreds } = await useMultiFileAuthState(authManager.sessionPath);

        // Configuration du socket
        sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
            browser: Browsers.macOS('Desktop'),
            mobile: false,
            markOnlineOnConnect: false,
            emitOwnEvents: true,
            connectTimeoutMs: 240000,
            defaultQueryTimeoutMs: 180000,
            syncFullHistory: false,
            retryRequestDelayMs: 5000,
            maxRetries: 3, 
            keepAliveIntervalMs: 60000,
            getMessage: async () => undefined,
            shouldSyncHistoryMessage: () => false,
            shouldIgnoreJid: (jid) => !jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us'),
        });

        // Timeout pour détecter les connexions qui traînent
        const connectionTimeout = setTimeout(async () => {
            if (!isConnected && !qrCodeUrl) {
                log.error('❌ Timeout: Pas de QR code généré après 10s');
                qrCodeUrl = null;
                await authManager.clearAuthState();
                setTimeout(start, 3000);
            }
        }, 10000);

        // ============================================
        // ÉVÉNEMENTS SOCKET
        // ============================================
        sock.ev.on('creds.update', saveCreds);

        let reconnectCount = 0;
        const maxReconnectAttempts = 5;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, isOnline } = update;

            if (qr) {
                // Générer le QR code
                log.info('📱 QR Code reçu');
                clearTimeout(connectionTimeout);
                qrCodeUrl = await QRCode.toDataURL(qr);
                connectionErrorCount = 0;
                reconnectCount = 0;
            }

            if (isOnline === true) {
                log.info('🌐 En ligne');
            }

            if (isOnline === false) {
                log.warn('🌐 Hors ligne');
            }

            if (connection === 'open') {
                isConnected = true;
                reconnectCount = 0;
                connectionErrorCount = 0;
                clearTimeout(connectionTimeout);
                log.info('✅ WhatsApp connecté avec succès');
                log.info(`📞 Numéro: ${sock.user?.id || 'Unknown'}`);
            }

            if (connection === 'close') {
                isConnected = false;
                const reason = lastDisconnect?.error?.output?.statusCode;
                log.warn(`⚠️  Déconnecté: ${reason || 'Connexion fermée'}`);

                // Gérer les erreurs 405 (session expirée)
                if (reason === 405) {
                    connectionErrorCount++;
                    log.warn(`🔄 Stream resumé (${connectionErrorCount}/${MAX_CONSECUTIVE_ERRORS})`);

                    if (connectionErrorCount >= MAX_CONSECUTIVE_ERRORS) {
                        log.error('❌ Session invalide - nettoyage et nouvelle connexion');
                        qrCodeUrl = null;
                        connectionErrorCount = 0;
                        reconnectCount = 0;

                        // Nettoyer la session expirée
                        await authManager.clearAuthState();
                        log.info('🧹 Session nettoyée');

                        // Relancer avec délai long
                        const delay = 5000;
                        log.info(`⏳ Nouvelle tentative dans ${delay}ms...`);
                        setTimeout(start, delay);
                        return;
                    }
                } else if (reason === DisconnectReason.loggedOut) {
                    log.warn('🔄 Session expirée - reconnexion requise');
                    connectionErrorCount = 0;
                    qrCodeUrl = null;
                    await authManager.clearAuthState();
                    process.exit(0);
                } else if (reason === DisconnectReason.connectionClosed) {
                    log.warn('🔄 Connexion fermée - reconnexion...');
                    connectionErrorCount = 0;
                } else {
                    connectionErrorCount++;
                }

                // Reconnecter automatiquement avec délai exponentiel
                const delay = Math.min(1000 * Math.pow(2, reconnectCount), 30000);
                log.info(`⏳ Nouvelle tentative dans ${delay}ms...`);
                setTimeout(start, delay);
                reconnectCount++;
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            for (const msg of m.messages) {
                if (!msg.message) continue;

                try {
                    await handleMessage(msg);
                } catch (error) {
                    log.error('❌ Erreur traitement message:', error);
                }
            }
        });

        // Gérer les messages supprimés
        sock.ev.on('messages.update', async (updates) => {
            for (const { key, update } of updates) {
                if (update.message === null && databaseManager) {
                    // Message supprimé
                    const msgId = key.id;
                    log.info(`🗑️  Message supprimé détecté: ${msgId}`);

                    // Récupérer les informations du message (si disponibles)
                    const sender = key.participant || key.remoteJid;
                    await databaseManager.saveDeletedMessage(
                        msgId,
                        sender,
                        '[Message supprimé]',
                        null,
                        Date.now()
                    );
                }
            }
        });

        global.sock = sock;
    } catch (error) {
        log.error('❌ Erreur démarrage:', error);
        setTimeout(start, 3000);
    }
}

// ============================================
// GESTION DES MESSAGES
// ============================================
async function handleMessage(msg) {
    try {
        const remoteJid = msg.key.remoteJid;
        const isGroupMsg = isJidGroup(remoteJid);
        const sender = msg.key.participant || remoteJid;
        const messageContent = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

        // Ignorer les messages du bot lui-même
        if (msg.key.fromMe) return;

        log.info(`📨 Message de ${sender}: "${messageContent.substring(0, 50)}"`);

        // ============================================
        // MODE PRIVÉ
        // ============================================
        if (IS_PRIVATE && sender !== OWNER_NUMBER) {
            log.warn(`🔒 Utilisateur non autorisé: ${sender}`);
            return;
        }

        // ============================================
        // COMMANDES
        // ============================================
        if (messageContent.startsWith('!')) {
            await handleCommand(messageContent, msg, sender, remoteJid);
            return;
        }

        // ============================================
        // MODE IA ASSISTANT
        // ============================================
        if (ENABLE_AI && aiHandler && sender !== OWNER_NUMBER && !isGroupMsg) {
            // Démarrer un timer pour la réponse IA automatique
            timerManager.startTimer(sender, msg.key.id, messageContent);

            // Ajouter le callback du timer
            timerManager.onTimeout(sender, async (senderNum, messageId, content) => {
                try {
                    log.info(`🤖 Timer expiré - IA répond automatiquement à ${senderNum}`);

                    const aiResponse = await aiHandler.generateResponse(
                        content,
                        senderNum,
                        'Le propriétaire n\'a pas répondu. Réponds maintenant.'
                    );

                    await sock.sendMessage(senderNum, {
                        text: aiResponse,
                    });

                    // Nettoyer l'historique après la réponse
                    aiHandler.clearConversationHistory(senderNum);
                } catch (error) {
                    log.error('❌ Erreur réponse IA automatique:', error);
                }
            });

            // Ajouter le message à l'historique IA
            if (aiHandler) {
                aiHandler.addMessageToHistory(sender, 'user', messageContent);
            }

            // Notifier le propriétaire
            await sock.sendMessage(OWNER_NUMBER, {
                text: `📱 Nouveau message de ${sender}:\n\n${messageContent}`,
            });
        }
    } catch (error) {
        log.error('❌ Erreur traitement message:', error);
    }
}

// ============================================
// GESTION DES COMMANDES
// ============================================
async function handleCommand(messageContent, msg, sender, remoteJid) {
    try {
        const args = messageContent.slice(1).split(' ');
        const command = args[0].toLowerCase();
        const commandArgsStr = args.slice(1).join(' ');

        log.info(`⚙️  Commande: ${command} de ${sender}`);

        // ============================================
        // COMMANDES SPÉCIALES IA
        // ============================================
        if (command === 'ai') {
            if (args[1]?.toLowerCase() === 'login') {
                // !ai login <clé_groq>
                const result = await handleAILogin(messageContent.slice(1), global.sock, sender, aiHandler);
                await global.sock.sendMessage(sender, { text: result });
                return;
            }

            if (commandArgsStr.trim()) {
                // !ai <question>
                if (!aiHandler || !aiHandler.isReady()) {
                    await global.sock.sendMessage(sender, {
                        text: '❌ Erreur: Clé Groq non configurée.\n\nUtilise d\'abord: !ai login <votre_clé_groq>\n\n💡 Obtenir votre clé gratuite:\nhttps://console.groq.com'
                    });
                    return;
                }

                try {
                    log.info(`🤖 Question IA: "${commandArgsStr}"`);
                    const response = await aiHandler.generateResponse(commandArgsStr, sender);
                    await global.sock.sendMessage(sender, { text: response });
                } catch (error) {
                    log.error('❌ Erreur réponse IA:', error);
                    await global.sock.sendMessage(sender, {
                        text: `❌ Erreur: ${error.message}`
                    });
                }
                return;
            } else {
                await global.sock.sendMessage(sender, {
                    text: '🤖 **Assistant IA NOVA - Powered by Nostra**\n\n📝 Utilisation:\n• !ai <question> - Poser une question\n• !ai login <clé> - Configurer votre clé Groq\n\n💡 Exemple:\n!ai Quelle est la capitale de la France?'
                });
                return;
            }
        }

        // ============================================
        // COMMANDE QUIZ
        // ============================================
        if (command === 'quiz') {
            const quizMessage = messageContent.slice(1);
            const result = await handleQuiz(quizMessage, global.sock, sender, aiHandler);
            await global.sock.sendMessage(remoteJid, { text: result });
            return;
        }

        // ============================================
        // COMMANDES CLASSIQUES
        // ============================================

        const context = {
            sock: global.sock,
            msg: msg,
            sender: sender,
            remoteJid: remoteJid,
            args: args.slice(1),
            ownerNumber: OWNER_NUMBER,
            aiHandler: aiHandler,
            databaseManager: databaseManager,
            timerManager: timerManager,
            replyWithTag: async (socket, text, message, jid) => {
                await socket.sendMessage(jid || message.key.remoteJid, {
                    text: text,
                    mentions: message.key.participant ? [message.key.participant] : [],
                });
            },
        };

        // Importer les commandes dynamiquement
        const commandPath = path.join(__dirname, 'commands', `${command}.js`);
        try {
            const cmdModule = await import(`file://${commandPath}`);
            await cmdModule.default.run(context);
        } catch (error) {
            if (error.code === 'MODULE_NOT_FOUND') {
                log.warn(`❌ Commande introuvable: ${command}`);
                await context.replyWithTag(
                    global.sock,
                    `❌ Commande non trouvée: *${command}*\nTapez *!help* pour voir les commandes disponibles.`,
                    msg,
                    sender
                );
            } else {
                throw error;
            }
        }
    } catch (error) {
        log.error('❌ Erreur traitement commande:', error);
        await global.sock.sendMessage(sender, {
            text: '❌ Erreur lors de l\'exécution de la commande.',
        });
    }
}

// ============================================
// ROUTES EXPRESS
// ============================================
app.get('/api/qr-code', (req, res) => {
    log.info(`📋 Demande QR code - isConnected: ${isConnected}, qrCodeUrl: ${!!qrCodeUrl}`);
    
    if (isConnected) {
        res.json({ 
            success: true,
            status: 'connected',
            message: 'Bot connecté avec succès'
        });
    } else if (qrCodeUrl) {
        res.json({ 
            success: true,
            qr: qrCodeUrl,
            message: 'QR code prêt à scanner'
        });
    } else {
        res.status(202).json({ 
            success: false,
            message: 'QR code en attente de génération',
            hint: 'Le serveur initialise la connexion WhatsApp. Patientez...'
        });
    }
});

app.post('/api/pairing-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            return res.status(400).json({ success: false, message: 'Numéro de téléphone requis' });
        }

        // Formater le numéro (supprimer tous les caractères non-numériques)
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');

        if (!formattedNumber || formattedNumber.length < 10) {
            return res.status(400).json({ success: false, message: 'Numéro de téléphone invalide' });
        }

        if (!sock) {
            log.error('❌ Socket non disponible pour pairing code');
            return res.status(503).json({ success: false, message: 'Serveur non prêt - reconnexion en cours' });
        }

        if (!sock.requestPairingCode || typeof sock.requestPairingCode !== 'function') {
            log.error('❌ Méthode requestPairingCode non disponible');
            return res.status(503).json({ success: false, message: 'Pairing code non supporté' });
        }

        log.info(`🔑 Demande pairing code pour: ${formattedNumber}`);

        // Générer le pairing code avec timeout de 30s
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout génération pairing code')), 30000)
        );

        let code;
        try {
            code = await Promise.race([
                sock.requestPairingCode(formattedNumber),
                timeoutPromise
            ]);
        } catch (err) {
            if (err.message.includes('Timeout')) {
                return res.status(408).json({ success: false, message: 'Timeout: serveur non réactif' });
            }
            throw err;
        }

        if (!code) {
            return res.status(500).json({ success: false, message: 'Aucun code généré par le serveur' });
        }

        // Formater le code (ajouter des tirets tous les 4 caractères)
        const formattedCode = code.toString().replace(/(.{4})/g, '$1-').replace(/-$/, '');
        
        log.success(`✅ Pairing code généré: ${formattedCode}`);

        res.json({ 
            success: true,
            code: formattedCode,
            phoneNumber: formattedNumber,
            expiresIn: '5 minutes'
        });
    } catch (error) {
        log.error('❌ Erreur pairing code:', error.message);
        
        // Meilleur messages d'erreur selon le type
        let message = 'Erreur lors de la génération du pairing code';
        if (error.message.includes('too many')) {
            message = 'Trop de tentatives - attendez 10 minutes';
        } else if (error.message.includes('invalid')) {
            message = 'Numéro de téléphone invalide';
        } else if (error.message.includes('network')) {
            message = 'Erreur réseau - vérifiez votre connexion';
        }
        
        res.status(500).json({ success: false, message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        connected: isConnected,
        ownerNumber: OWNER_NUMBER,
        privateMode: IS_PRIVATE,
        aiEnabled: ENABLE_AI,
        botNumber: sock?.user?.id || null,
    });
});

app.get('/api/history/:jid', (req, res) => {
    const { jid } = req.params;

    if (aiHandler) {
        const history = aiHandler.getConversationHistory(jid);
        res.json({ history });
    } else {
        res.status(503).json({ message: 'IA non disponible' });
    }
});

// ============================================
// DÉMARRAGE SERVEUR
// ============================================
app.listen(PORT, () => {
    log.info(`🌐 Serveur Express lancé sur le port ${PORT}`);
    log.info(`📱 Accédez à l'interface web: http://localhost:${PORT}`);
});

// Démarrer le bot
start().catch((error) => {
    log.error('❌ Erreur critique:', error);
    process.exit(1);
});

// ============================================
// GESTION DE L'ARRÊT
// ============================================
process.on('SIGINT', async () => {
    log.info('⛔ Arrêt du bot...');
    if (databaseManager) {
        await databaseManager.close();
    }
    timerManager.clearAll();
    process.exit(0);
});
