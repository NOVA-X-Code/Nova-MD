import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, isJidGroup } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import axios from 'axios';
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

// ============================================
// DÉMARRAGE
// ============================================
async function start() {
    try {
        log.info('🚀 Démarrage de NOVA-MD...');

        // Initialiser l'authentification
        await authManager.initializeSessionDir();

        // Initialiser la base de données
        if (process.env.DATABASE_URL) {
            databaseManager = new DatabaseManager(process.env.DATABASE_URL);
            await databaseManager.initialize();
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
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
        });

        // ============================================
        // ÉVÉNEMENTS SOCKET
        // ============================================
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // Générer le QR code
                log.info('📱 QR Code reçu');
                qrCodeUrl = await QRCode.toDataURL(qr);
            }

            if (connection === 'open') {
                isConnected = true;
                log.info('✅ WhatsApp connecté avec succès');
                log.info(`📞 Numéro: ${sock.user.id}`);
            }

            if (connection === 'close') {
                isConnected = false;
                const reason = lastDisconnect?.error?.output?.statusCode || 'Déconnexion';
                log.warn(`⚠️  Déconnecté: ${reason}`);

                if (reason === DisconnectReason.loggedOut) {
                    log.warn('🔄 Reconnexion requise...');
                } else {
                    // Reconnecter automatiquement
                    setTimeout(start, 3000);
                }
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
    if (isConnected) {
        res.json({ status: 'connected' });
    } else if (qrCodeUrl) {
        res.json({ qr: qrCodeUrl });
    } else {
        res.json({ message: 'En attente du QR code...' });
    }
});

app.post('/api/pairing-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            return res.status(400).json({ message: 'Numéro de téléphone requis' });
        }

        // Formater le numéro
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');

        if (!sock) {
            return res.status(503).json({ message: 'Socket non disponible' });
        }

        // Générer le pairing code
        const code = await sock.requestPairingCode(formattedNumber);

        res.json({ code: code });
    } catch (error) {
        log.error('❌ Erreur pairing code:', error);
        res.status(500).json({ message: 'Erreur lors de la génération du pairing code' });
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
