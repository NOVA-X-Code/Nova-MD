import fs from 'fs';
import path from 'path';
import { dataFile } from '../lib/paths.js';
import store from '../lib/lightweight_store.js';
import commandHandler from '../lib/commandHandler.js';
import config from '../config.js';

const MONGO_URL = process.env.MONGO_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const MYSQL_URL = process.env.MYSQL_URL;
const SQLITE_URL = process.env.DB_URL;
const HAS_DB = !!(MONGO_URL || POSTGRES_URL || MYSQL_URL || SQLITE_URL);
const USER_GROUP_DATA = dataFile('userGroupData.json');

// 📚 Mémoire de conversation
const chatMemory = {
    messages: new Map(), // userId -> [messages]
    userInfo: new Map() // userId -> { name, location, etc }
};

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

// 📸 Gérer les vues uniques
async function handleViewOnce(sock, message) {
    try {
        const msg = message.message;
        let viewOnceMsg = null;
        let type = '';
        let caption = '';

        if (msg?.viewOnceMessageV2?.message?.imageMessage) {
            viewOnceMsg = msg.viewOnceMessageV2.message.imageMessage;
            type = 'Image';
            caption = viewOnceMsg.caption || '';
        } else if (msg?.viewOnceMessageV2?.message?.videoMessage) {
            viewOnceMsg = msg.viewOnceMessageV2.message.videoMessage;
            type = 'Video';
            caption = viewOnceMsg.caption || '';
        } else if (msg?.viewOnceMessageV2?.message?.audioMessage) {
            viewOnceMsg = msg.viewOnceMessageV2.message.audioMessage;
            type = 'Audio';
            caption = '';
        } else if (msg?.viewOnceMessage?.message?.imageMessage) {
            viewOnceMsg = msg.viewOnceMessage.message.imageMessage;
            type = 'Image';
            caption = viewOnceMsg.caption || '';
        } else if (msg?.viewOnceMessage?.message?.videoMessage) {
            viewOnceMsg = msg.viewOnceMessage.message.videoMessage;
            type = 'Video';
            caption = viewOnceMsg.caption || '';
        }

        if (!viewOnceMsg) return null;

        const mediaBuffer = await sock.downloadMediaMessage(message);
        if (!mediaBuffer) return null;

        return {
            buffer: mediaBuffer,
            type,
            caption,
            mimeType: viewOnceMsg.mimetype,
            fileLength: viewOnceMsg.fileLength
        };
    } catch (error) {
        console.error('Error handling view once:', error);
        return null;
    }
}

// 🧠 Utiliser l'IA pour comprendre l'intention
async function getIntentFromAI(userMessage, senderId) {
    const allCommands = Array.from(commandHandler.commands.values());

    // Récupérer l'historique de la conversation
    const history = chatMemory.messages.get(senderId) || [];
    const historyText = history.slice(-5).join('\n'); // Derniers 5 messages

    let commandsContext = '=== COMMANDS AVAILABLE ===\n\n';
    for (const cmd of allCommands) {
        commandsContext += `- ${cmd.command}`;
        if (cmd.aliases?.length) {
            commandsContext += ` (aliases: ${cmd.aliases.join(', ')})`;
        }
        commandsContext += `: ${cmd.description || 'No description'}`;
        commandsContext += ` [Usage: ${cmd.usage || `.${cmd.command}`}]`;
        if (cmd.adminOnly) commandsContext += ' [Admin Only]';
        if (cmd.ownerOnly) commandsContext += ' [Owner Only]';
        if (cmd.groupOnly) commandsContext += ' [Group Only]';
        commandsContext += '\n';
    }

    const prompt = `You are NOVA, a WhatsApp bot. Your task is to understand what the user wants and map it to the EXACT command from the list.

${commandsContext}

CONVERSATION HISTORY:
${historyText || 'No previous messages'}

USER MESSAGE: "${userMessage}"

Based on the user's message and conversation history, determine:
1. If the user wants to execute a command or just chat
2. If it's a command, which EXACT command from the list above matches
3. Extract any arguments from the message (mentions, text, etc.)

RULES:
- Match the user's intent to the MOST RELEVANT command
- Extract arguments like @mentions, text, numbers, etc.
- Use the command's aliases if applicable
- The command MUST exist in the list above

EXAMPLES:
- "je veux sa pp" → {"isCommand": true, "command": "profilepic", "args": ["@user"], "reason": "User wants profile picture"}
- "donne moi la photo de profil de @user" → {"isCommand": true, "command": "profilepic", "args": ["@user"], "reason": "User wants profile picture"}
- "récupère cette vue unique" → {"isCommand": true, "command": "viewonce", "args": [], "reason": "User wants view once"}
- "crée un sticker" → {"isCommand": true, "command": "sticker", "args": [], "reason": "User wants sticker"}
- "ping" → {"isCommand": true, "command": "ping", "args": [], "reason": "User wants ping"}
- "ban @user" → {"isCommand": true, "command": "ban", "args": ["@user"], "reason": "User wants to ban someone"}
- "salut ça va" → {"isCommand": false, "reason": "Just chatting"}

Respond in JSON format ONLY:
{
    "isCommand": true/false,
    "command": "command_name",
    "args": ["arg1", "arg2"],
    "reason": "explanation"
}

IMPORTANT: Only respond with valid JSON. No other text.`;

    const API_ENDPOINTS = [
        {
            name: 'ZellAPI',
            url: (text) => `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(text)}`,
            parse: (data) => data?.result
        },
        {
            name: 'Hercai',
            url: (text) => `https://hercai.onrender.com/gemini/hercai?question=${encodeURIComponent(text)}`,
            parse: (data) => data?.reply
        },
        {
            name: 'SparkAPI',
            url: (text) => `https://discardapi.dpdns.org/api/chat/spark?apikey=guru&text=${encodeURIComponent(text)}`,
            parse: (data) => data?.result?.answer
        }
    ];

    for (const api of API_ENDPOINTS) {
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), 15000);
            });
            const fetchPromise = fetch(api.url(prompt), { method: 'GET' });
            const response = await Promise.race([fetchPromise, timeoutPromise]);

            if (!response.ok) continue;

            const data = await response.json();
            const result = api.parse(data);
            if (!result) continue;

            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.isCommand && parsed.command) {
                        if (commandHandler.commands.has(parsed.command)) {
                            console.log(`✅ ${api.name} → ${parsed.command} with args: ${parsed.args || []}`);
                            return parsed;
                        }
                        console.log(`⚠️ ${api.name} suggested invalid command: ${parsed.command}`);
                        const suggestion = commandHandler.findSuggestion(parsed.command);
                        if (suggestion && commandHandler.commands.has(suggestion)) {
                            parsed.command = suggestion;
                            return parsed;
                        }
                    }
                    return parsed;
                } catch {
                    continue;
                }
            }
        } catch (error) {
            console.log(`${api.name} error:`, error.message);
        }
    }

    return { isCommand: false, reason: 'No command detected' };
}

// 🔧 Exécuter une commande
async function executeCommand(sock, message, commandName, args, chatId, senderId) {
    try {
        const prefixes = config.prefixes || ['.'];
        const usedPrefix = prefixes[0];
        const fullCommand = usedPrefix + commandName;

        const command = commandHandler.getCommand(fullCommand, prefixes);
        if (!command) {
            const directCommand = commandHandler.commands.get(commandName);
            if (!directCommand) {
                return { success: false, reason: 'command_not_found' };
            }
            return await executeCommandDirect(sock, message, directCommand, args, chatId, senderId);
        }

        return await executeCommandDirect(sock, message, command, args, chatId, senderId);
    } catch (error) {
        console.error('Error executing command:', error);
        return { success: false, reason: 'error', error: error.message };
    }
}

async function executeCommandDirect(sock, message, command, args, chatId, senderId) {
    try {
        const syntheticMessage = {
            ...message,
            message: {
                extendedTextMessage: {
                    text: command.command + (args.length > 0 ? ` ${args.join(' ')}` : ''),
                    contextInfo: message.message?.extendedTextMessage?.contextInfo || {}
                }
            }
        };

        const context = {
            chatId,
            senderId,
            isGroup: chatId.endsWith('@g.us'),
            channelInfo: {
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true
                }
            },
            rawText: command.command,
            messageText: command.command,
            userMessage: command.command.toLowerCase()
        };

        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(resolve => setTimeout(resolve, 500));

        await command.handler(sock, syntheticMessage, args, context);
        return { success: true, command: command.command };
    } catch (error) {
        console.error('Error in executeCommandDirect:', error);
        return { success: false, reason: 'error', error: error.message };
    }
}

// 💬 Conversation IA avec mémoire
async function getAIResponse(userMessage, senderId) {
    // Récupérer l'historique
    const history = chatMemory.messages.get(senderId) || [];
    const historyText = history.slice(-10).join('\n');

    const prompt = `You are NOVA, a virtual assistant powered  NOSTRA. Reply in the same language as the user. Keep responses short and natural. Be casual and use emojis.

CONVERSATION HISTORY:
${historyText || 'No previous messages'}

User: ${userMessage}
NOVA:`;

    const API_ENDPOINTS = [
        {
            name: 'ZellAPI',
            url: (text) => `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(text)}`,
            parse: (data) => data?.result
        },
        {
            name: 'Hercai',
            url: (text) => `https://hercai.onrender.com/gemini/hercai?question=${encodeURIComponent(text)}`,
            parse: (data) => data?.reply
        }
    ];

    for (const api of API_ENDPOINTS) {
        try {
            const timeoutPromise = new Promise((_, reject) => {
             setTimeout(() => reject(new Error('Request timeout')), 15000);
            });
            const fetchPromise = fetch(api.url(prompt), { method: 'GET' });
            const response = await Promise.race([fetchPromise, timeoutPromise]);

            if (!response.ok) continue;

            const data = await response.json();
            const result = api.parse(data);
            if (!result) continue;

            return result.trim();
        } catch {
            continue;
        }
    }

    return "I'm here! 😊 How can I help you?";
}

// 🤖 Fonction principale du chatbot
export async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = await loadUserGroupData();
    if (!data.chatbot[chatId]) return;

    try {
        const botName = global.botname || 'NOVA';
        const botId = sock.user.id;
        const botNumber = botId.split(':')[0];

        // 📸 VÉRIFIER LES VUES UNIQUES
        const viewOnceData = await handleViewOnce(sock, message);
        if (viewOnceData) {
            await sock.sendMessage(chatId, {
                text: `✅ View Once Media Recovered\n\n📊 Type: ${viewOnceData.type}\n📏 Size: ${(viewOnceData.fileLength / 1024).toFixed(2)} KB`
            }, { quoted: message });

            if (viewOnceData.type === 'Image') {
                await sock.sendMessage(chatId, {
                    image: viewOnceData.buffer,
                    caption: `📸 ${viewOnceData.caption || 'View once image'}`
                });
            } else if (viewOnceData.type === 'Video') {
                await sock.sendMessage(chatId, {
                    video: viewOnceData.buffer,
                    caption: `📹 ${viewOnceData.caption || 'View once video'}`
                });
            } else if (viewOnceData.type === 'Audio') {
                await sock.sendMessage(chatId, {
                    audio: viewOnceData.buffer,
                    mimetype: 'audio/mpeg'
                });
            }
            return;
        }

        // 🎯 Vérifier si le message est adressé au bot
        const isAddressed = new RegExp(`^${botName}\\s+|^@${botNumber}\\s+`, 'i').test(userMessage);
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

        // 🔥 UTILISER L'IA POUR COMPRENDRE L'INTENTION
        const intent = await getIntentFromAI(cleanMessage, senderId);

        if (intent.isCommand && intent.command) {
            console.log(`🧠 Intent: ${intent.command} → ${intent.reason}`);

            const result = await executeCommand(
                sock,
                message,
                intent.command,
                intent.args || [],
                chatId,
                senderId
            );

            if (result.success) {
                console.log(`✅ Command executed: ${intent.command}`);
                return;
            }
        }

        // 💬 Si c'est une conversation normale
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));

        const response = await getAIResponse(cleanMessage, senderId);
        if (response) {
            // Sauvegarder dans la mémoire
            if (!chatMemory.messages.has(senderId)) {
                chatMemory.messages.set(senderId, []);
            }
            const messages = chatMemory.messages.get(senderId);
            messages.push(`User: ${cleanMessage}`);
            messages.push(`NOVA: ${response}`);
            if (messages.length > 20) {
                messages.splice(0, 2);
            }

            await sock.sendMessage(chatId, { text: response }, { quoted: message });
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
    description: 'Enable or disable AI chatbot for the group',
    usage: '.chatbot <on|off>',
    groupOnly: true,
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
                    '• Mention me: *@NOVA get pp @user*\n' +
                    '• Reply to my messages\n' +
                    '• Just say: *NOVA ping*',
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
                text: '✅ *Chatbot enabled!*\n\nMention me: *@NOVA get pp @user*',
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