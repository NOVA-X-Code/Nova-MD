import fs from 'fs';
import path from 'path';
import { dataFile } from '../lib/paths.js';
import store from '../lib/lightweight_store.js';
import chatbotService from '../lib/chatbotService.js';
import chatbotConfig from '../lib/chatbotConfig.js';
import isOwnerOrSudo from '../lib/isOwner.js';


const MONGO_URL = process.env.MONGO_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const MYSQL_URL = process.env.MYSQL_URL;
const SQLITE_URL = process.env.DB_URL;
const HAS_DB = !!(MONGO_URL || POSTGRES_URL || MYSQL_URL || SQLITE_URL);
const USER_GROUP_DATA = dataFile('userGroupData.json');

// 📂 Charger les données utilisateur/groupe
export async function loadUserGroupData() {
    try {
        if (HAS_DB) {
            const data = await store.getSetting('global', 'userGroupData');
            return data || { groups: [], chatbot: {} };
        }
        if (!fs.existsSync(USER_GROUP_DATA)) {
            return { groups: [], chatbot: {} };
        }
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA, 'utf-8'));
    } catch (error) {
        console.error('Error loading user group data:', error.message);
        return { groups: [], chatbot: {} };
    }
}

// 💾 Sauvegarder les données utilisateur/groupe
export async function saveUserGroupData(data) {
    try {
        if (HAS_DB) {
            await store.saveSetting('global', 'userGroupData', data);
        } else {
            const dataDir = path.dirname(USER_GROUP_DATA);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error('Error saving user group data:', error.message);
    }
}

// 🤖 Fonction principale du chatbot
export async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    // Vérifier si le chatbot est activé
    if (!chatbotConfig.get('enabled')) return;

    const data = await loadUserGroupData();
    if (!data.chatbot[chatId]) return;

    try {
        const botName = global.botname || 'NOVA';
        const botId = sock.user.id;
        const botNumber = botId?.split(':')[0] || '';

        // Vérifier les permissions selon le mode
        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);
        const isFromMe = message.key.fromMe;
        const isOwnerOrSudoCheck = isFromMe || senderIsOwnerOrSudo;

        const botMode = await store.getBotMode();
        const chatbotMode = chatbotConfig.get('mode') || 'private';

        // Mode privé: seul le propriétaire peut utiliser
        if (chatbotMode === 'private' && !isOwnerOrSudoCheck) {
            return;
        }

        // Vérifier le botMode global
        const canUseChatbot = (() => {
            if (isOwnerOrSudoCheck) return true;
            switch (botMode) {
                case 'public': return true;
                case 'private':
                case 'self': return false;
                case 'groups': return chatId.endsWith('@g.us');
                case 'inbox': return !chatId.endsWith('@g.us');
                default: return true;
            }
        })();

        if (!canUseChatbot) return;

        // === VÉRIFIER SI LE MESSAGE EST ADRESSÉ AU BOT ===
        // En DM (chat privé), la conversation est déjà 1-à-1 avec le bot :
        // pas besoin de dire "NOVA" à chaque message.
        const isDM = !chatId.endsWith('@g.us');
        const isAddressed = isDM || new RegExp(`^${botName}\\s+|^@${botNumber}\\s+`, 'i').test(userMessage);
        const isReplyToBot = message.message?.extendedTextMessage?.contextInfo?.participant?.includes(botNumber);

        if (!isAddressed && !isReplyToBot) return;

        // Nettoyer le message
        let cleanMessage = userMessage;
        const patterns = [
            new RegExp(`^${botName}\\s+`, 'i'),
            new RegExp(`^@${botNumber}\\s+`, 'i'),
            new RegExp(`^${botName}[:]\\s+`, 'i'),
            new RegExp(`^@${botNumber}[:]\\s+`, 'i')
        ];
        for (const pattern of patterns) {
            if (pattern.test(cleanMessage)) {
                cleanMessage = cleanMessage.replace(pattern, '').trim();
                break;
            }
        }

        if (isReplyToBot && !isAddressed) {
            cleanMessage = userMessage;
        }

        // Si le message est vide, retourner
        if (!cleanMessage || cleanMessage.length < 1) {
            return;
        }

        // === UTILISER LE SERVICE CHATBOT ===
        // Le chatbotService gère tout :
        // - Détection des commandes
        // - Exécution des commandes
        // - Génération de réponses IA
        // - Historique
        // - Contextes
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1500));

        const response = await chatbotService.getResponse(
            cleanMessage,
            chatId,
            senderId,
            {
                sock,
                senderId,
                chatId,
                isOwnerOrSudo: isOwnerOrSudoCheck,
                isFromMe,
                pushName: message.pushName,
                timestamp: Date.now()
            }
        );

        if (response) {
            const prefix = chatbotConfig.get('responsePrefix') || '🤖 ';
            await sock.sendMessage(chatId, {
                text: `${prefix}${response}`
            }, { quoted: message });
        }

    } catch (error) {
        console.error('Error in chatbot response:', error.message);
    }
}

// 📋 Commande chatbot
export default {
    command: 'chatbot',
    aliases: ['bot', 'ai'],
    category: 'admin',
    description: 'Enable or disable AI chatbot for this chat (group or DM)',
    usage: '.chatbot <on|off>',
    adminOnly: true,
    async handler(sock, message, args, context) {
        const chatId = context.chatId || message.key.remoteJid;
        const match = args.join(' ').toLowerCase();

        if (!match) {
            return sock.sendMessage(chatId, {
                text: '*🤖 CHATBOT SETUP*\n\n' +
                    '*Commands:*\n' +
                    '• `.chatbot on` - Enable chatbot\n' +
                    '• `.chatbot off` - Disable chatbot\n\n' +
                    '*How to use:*\n' +
                    '• Say my name: *NOVA get pp @user*\n' +
                    '• Reply to my messages\n' +
                    '• Just say: *NOVA ping* (case doesn\'t matter — nova, Nova, NOVA all work)\n' +
                    '• In DM (private chat), just talk to me directly, no need to say NOVA',
                quoted: message
            });
        }

        const data = await loadUserGroupData();

        if (match === 'on') {
            if (data.chatbot[chatId]) {
                return sock.sendMessage(chatId, {
                    text: '⚠️ *Chatbot is already enabled*',
                    quoted: message
                });
            }
            data.chatbot[chatId] = true;
            await saveUserGroupData(data);
            return sock.sendMessage(chatId, {
                text: '✅ *Chatbot enabled!*\n\nSay my name: *NOVA get pp @user*',
                quoted: message
            });
        }

        if (match === 'off') {
            if (!data.chatbot[chatId]) {
                return sock.sendMessage(chatId, {
                    text: '⚠️ *Chatbot is already disabled*',
                    quoted: message
                });
            }
            delete data.chatbot[chatId];
            await saveUserGroupData(data);
            return sock.sendMessage(chatId, {
                text: '❌ *Chatbot disabled!*',
                quoted: message
            });
        }

        return sock.sendMessage(chatId, {
            text: '❌ Use: `.chatbot on/off`',
            quoted: message
        });
    },
    handleChatbotResponse,
    loadUserGroupData,
    saveUserGroupData
};