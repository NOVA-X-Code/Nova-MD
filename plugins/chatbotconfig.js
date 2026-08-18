import chatbotService from '../lib/chatbotService.js';
import chatbotConfig from '../lib/chatbotConfig.js';
import { isOwnerOnly } from '../lib/isOwner.js';

export default {
    command: 'chatbotconfig',
    aliases: ['cbc', 'chbconfig', 'botconfig'],
    category: 'owner',
    description: 'Configure the chatbot',
    usage: '.chatbotconfig [option] [value]',
    ownerOnly: true,
    handler: async (sock, message, args, context) => {
        const chatId = context.chatId || message.key.remoteJid;
        const isOwner = await isOwnerOnly(message.key.participant || message.key.remoteJid);
        
        if (!isOwner && !message.key.fromMe) {
            return;
        }

        const option = args[0]?.toLowerCase();
        const value = args.slice(1).join(' ');

        // === DISPLAY CONFIGURATION ===
        if (!option || option === 'status' || option === 'info') {
            const config = chatbotConfig.config;
            const status = chatbotConfig.getStatus();
            
            let text = `🤖 *CHATBOT CONFIGURATION*\n\n`;
            text += `┌─────────────────────────\n`;
            text += `│ 📊 Status: ${status.enabled} ${config.enabled ? 'Enabled' : 'Disabled'}\n`;
            text += `│ 🔒 Mode: ${status.mode}\n`;
            text += `│ 🔌 Provider: ${status.provider}\n`;
            text += `│ ${status.apiConfigured ? '✅' : '❌'} API: ${config.apiKey ? 'Key configured' : 'Not configured'}\n`;
            text += `│ ${config.apiUrl ? '✅' : '❌'} URL: ${config.apiUrl || 'Not configured'}\n`;
            text += `│ 📚 Context: ${config.customContext ? '✅ Custom' : '❌ Default'}\n`;
            text += `│ 🔄 History: ${config.maxHistory} messages\n`;
            text += `│ 🌡️ Temperature: ${config.temperature}\n`;
            text += `│ ⚡ Commands: ${config.executeCommands ? '✅ Enabled' : '❌ Disabled'}\n`;
            text += `└─────────────────────────\n\n`;
            
            text += `*📋 Available commands:*\n`;
            text += `• \`.cbc provider <default|gemini|ngrok|openai|custom>\`\n`;
            text += `• \`.cbc apikey <your_api_key>\`\n`;
            text += `• \`.cbc apiurl <your_api_url>\`\n`;
            text += `• \`.cbc mode <public|private>\`\n`;
            text += `• \`.cbc context <your_context>\`\n`;
            text += `• \`.cbc enable|disable\`\n`;
            text += `• \`.cbc clearhistory\`\n`;
            text += `• \`.cbc status\`\n\n`;
            
            text += `💡 *Examples:*\n`;
            text += `• \`.cbc provider gemini\`\n`;
            text += `• \`.cbc mode public\`\n`;
            text += `• \`.cbc context I am a commercial assistant...\``;

            return await sock.sendMessage(chatId, { text }, { quoted: message });
        }

        // === CONFIGURATION ===
        try {
            switch (option) {
                case 'provider': {
                    const providers = ['default', 'gemini', 'ngrok', 'openai', 'custom'];
                    if (!providers.includes(value)) {
                        return await sock.sendMessage(chatId, {
                            text: `❌ Invalid provider. Choose: ${providers.join(', ')}`,
                            quoted: message
                        });
                    }
                    chatbotConfig.set('provider', value);
                    await sock.sendMessage(chatId, {
                        text: `✅ Provider changed: ${value.toUpperCase()}`,
                        quoted: message
                    });
                    break;
                }

                case 'apikey':
                    if (!value) {
                        return await sock.sendMessage(chatId, {
                            text: '❌ Please provide an API key',
                            quoted: message
                        });
                    }
                    chatbotConfig.set('apiKey', value);
                    await sock.sendMessage(chatId, {
                        text: `✅ API key updated (${value.slice(0, 5)}...)`,
                        quoted: message
                    });
                    break;

                case 'apiurl':
                    if (!value) {
                        return await sock.sendMessage(chatId, {
                            text: '❌ Please provide an API URL',
                            quoted: message
                        });
                    }
                    chatbotConfig.set('apiUrl', value);
                    await sock.sendMessage(chatId, {
                        text: `✅ API URL updated: ${value}`,
                        quoted: message
                    });
                    break;

                case 'mode':
                    if (!['public', 'private'].includes(value)) {
                        return await sock.sendMessage(chatId, {
                            text: '❌ Invalid mode. Use: public or private',
                            quoted: message
                        });
                    }
                    chatbotConfig.set('mode', value);
                    await sock.sendMessage(chatId, {
                        text: `🔒 Chatbot mode: ${value === 'private' ? '🔒 Private' : '🌍 Public'}`,
                        quoted: message
                    });
                    break;

                case 'context':
                    if (!value) {
                        return await sock.sendMessage(chatId, {
                            text: '❌ Please provide a context',
                            quoted: message
                        });
                    }
                    chatbotConfig.set('customContext', value);
                    chatbotService.setContext(null, value);
                    await sock.sendMessage(chatId, {
                        text: `✅ Custom context added (${value.length} characters)`,
                        quoted: message
                    });
                    break;

                case 'enable':
                    chatbotConfig.set('enabled', true);
                    await sock.sendMessage(chatId, {
                        text: '✅ Chatbot enabled!',
                        quoted: message
                    });
                    break;

                case 'disable':
                    chatbotConfig.set('enabled', false);
                    await sock.sendMessage(chatId, {
                        text: '❌ Chatbot disabled',
                        quoted: message
                    });
                    break;

                case 'clearhistory':
                    chatbotService.clearHistory();
                    await sock.sendMessage(chatId, {
                        text: '🗑️ History cleared',
                        quoted: message
                    });
                    break;

                case 'reset':
                    chatbotConfig.set('customContext', '');
                    chatbotService.clearHistory();
                    await sock.sendMessage(chatId, {
                        text: '🔄 Chatbot reset to default settings',
                        quoted: message
                    });
                    break;

                default:
                    await sock.sendMessage(chatId, {
                        text: `❌ Unknown option: ${option}\nUse \`.cbc status\` to see options`,
                        quoted: message
                    });
            }
        } catch (error) {
            console.error('Chatbot config error:', error);
            await sock.sendMessage(chatId, {
                text: `❌ Error: ${error.message}`,
                quoted: message
            });
        }
    }
};