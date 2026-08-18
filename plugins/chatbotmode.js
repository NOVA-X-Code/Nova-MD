// plugins/chatbotmode.js
import store from '../lib/lightweight_store.js';
import { isOwnerOnly } from '../lib/isOwner.js';

export default {
    command: 'chatbotmode',
    aliases: ['cbmode', 'chbmode'],
    category: 'owner',
    description: 'Définir le mode du chatbot (public ou private)',
    usage: '.chatbotmode [public|private|status]',
    ownerOnly: true,
    handler: async (sock, message, args, context) => {
        const chatId = context.chatId || message.key.remoteJid;
        const isOwner = await isOwnerOnly(message.key.participant || message.key.remoteJid);
        
        if (!isOwner && !message.key.fromMe) {
            return; // Silence total
        }

        const subCommand = args[0]?.toLowerCase();
        const currentMode = await store.getChatbotMode() || 'private';
        const botMode = await store.getBotMode();

        if (!subCommand || subCommand === 'status' || subCommand === 'check') {
            const modeEmojis = {
                public: '🌍',
                private: '🔒'
            };
            
            let statusText = `🤖 *CHATBOT MODE STATUS*\n\n`;
            statusText += `Chatbot Mode: ${modeEmojis[currentMode]} *${currentMode.toUpperCase()}*\n`;
            statusText += `Bot Mode: *${botMode.toUpperCase()}*\n\n`;
            statusText += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            statusText += `*How it works:*\n\n`;
            statusText += `🔒 \`private\` - Only owner can use the chatbot\n`;
            statusText += `🌍 \`public\` - Everyone can use the chatbot\n\n`;
            statusText += `*With bot mode ${botMode.toUpperCase()}:*\n`;
            
            if (botMode === 'private' || botMode === 'self') {
                statusText += `• Commands via chatbot: ❌ Blocked (bot is private)\n`;
                statusText += `• Conversations: ${currentMode === 'public' ? '✅ Allowed' : '❌ Blocked'}\n`;
            } else if (botMode === 'public') {
                statusText += `• Commands via chatbot: ✅ Allowed\n`;
                statusText += `• Conversations: ✅ Allowed\n`;
            } else if (botMode === 'groups') {
                statusText += `• Commands via chatbot: ✅ Only in groups\n`;
                statusText += `• Conversations: ✅ Only in groups\n`;
            } else if (botMode === 'inbox') {
                statusText += `• Commands via chatbot: ✅ Only in DMs\n`;
                statusText += `• Conversations: ✅ Only in DMs\n`;
            }
            
            statusText += `\n*Usage:*\n`;
            statusText += `• \`.chatbotmode public\` - Make chatbot public\n`;
            statusText += `• \`.chatbotmode private\` - Make chatbot private\n`;
            statusText += `• \`.chatbotmode status\` - Show current mode`;

            return await sock.sendMessage(chatId, { text: statusText }, { quoted: message });
        }

        if (!['public', 'private'].includes(subCommand)) {
            return await sock.sendMessage(chatId, {
                text: `❌ Invalid mode: *${subCommand}*\n\nValid modes: public, private\n\nUse \`.chatbotmode status\` to see current mode.`
            }, { quoted: message });
        }

        await store.setChatbotMode(subCommand);
        
        const modeEmojis = {
            public: '🌍',
            private: '🔒'
        };
        
        const modeMessages = {
            public: '🤖 *Chatbot is now PUBLIC*\n\n' +
                    'Everyone can use the chatbot for conversations.\n' +
                    '⚠️ Commands via chatbot depend on bot mode.',
            private: '🤖 *Chatbot is now PRIVATE*\n\n' +
                     'Only the bot owner can use the chatbot.'
        };

        await sock.sendMessage(chatId, {
            text: `${modeEmojis[subCommand]} ${modeMessages[subCommand]}\n\n_Use \`.chatbotmode status\` to check current mode._`
        }, { quoted: message });
    }
};