import fetch from 'node-fetch';
import chatbotConfig from '../config/chatbotConfig.js';
import commandHandler from './commandHandler.js';
import config from '../config.js';

class ChatbotService {
    constructor() {
        // Default APIs 
        this.defaultAPIs = [
            {
                name: 'Mistral',
                url: (q) => `https://mistral.stacktoy.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
                parse: (data) => data?.result || data?.response || data?.reply || data?.text
            },
            {
                name: 'Llama',
                url: (q) => `https://llama.gtech-apiz.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
                parse: (data) => data?.result || data?.response || data?.reply || data?.text
            },
            {
                name: 'Mistral2',
                url: (q) => `https://mistral.gtech-apiz.workers.dev/?apikey=Suhail&text=${encodeURIComponent(q)}`,
                parse: (data) => data?.result || data?.response || data?.reply || data?.text
            }
        ];

        this.providers = {
            default: this._callDefaultAPI.bind(this),
            gemini: this._callGemini.bind(this),
            ngrok: this._callNgrok.bind(this),
            openai: this._callOpenAI.bind(this),
            custom: this._callCustom.bind(this)
        };

        this.history = new Map();
        this.contextCache = new Map();
        
        // Base context - Bot identity
        this.baseContext = `You are NOVA, a virtual assistant powered by NOSTRA. 
You are an advanced AI assistant that helps users with various tasks.

KEY TRAITS:
- You are friendly, helpful, and professional
- You ALWAYS respond in the SAME LANGUAGE as the user's question
- You keep responses SHORT, CLEAR, and PRECISE (max 3-4 sentences)
- You use emojis appropriately to make responses engaging
- You can execute commands when appropriate
- You understand natural language requests

COMMANDS AVAILABLE:
${this.getCommandsList()}

HOW TO IDENTIFY COMMANDS:
1. Analyze the user's request carefully
2. If the request matches a command intent, execute it
3. If not, just have a normal conversation
4. NEVER execute commands unless the user clearly asks for an action

EXAMPLES:
- "create a sticker from this image" → EXECUTE sticker command
- "download this music" → EXECUTE download command
- "ban @user" → EXECUTE ban command
- "hello how are you?" → JUST CHAT, no command
- "what can you do?" → JUST CHAT, list capabilities
- "I want to see @user's profile picture" → EXECUTE profilepic command

IMPORTANT: 
- Only execute commands when the user explicitly asks for an action
- For normal conversation, just respond naturally
- Always explain what you're doing when executing a command
- If unsure, just chat normally`;

        // Load configuration
        this.loadConfig();
    }

    getCommandsList() {
        const commands = Array.from(commandHandler.commands.values());
        const grouped = {};
        
        for (const cmd of commands) {
            const category = cmd.category || 'misc';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push({
                name: cmd.command,
                description: cmd.description || 'No description',
                aliases: cmd.aliases || [],
                usage: cmd.usage || `.${cmd.command}`
            });
        }

        let list = '';
        for (const [category, cmds] of Object.entries(grouped)) {
            list += `\n${category.toUpperCase()}:\n`;
            for (const cmd of cmds) {
                list += `- ${cmd.name}: ${cmd.description}`;
                if (cmd.aliases.length) {
                    list += ` (aliases: ${cmd.aliases.join(', ')})`;
                }
                list += '\n';
            }
        }
        return list;
    }

    loadConfig() {
        this.config = chatbotConfig.config || {
            enabled: true,
            mode: 'public',
            provider: 'default',
            apiKey: '',
            apiUrl: '',
            customContext: '',
            maxHistory: 15,
            temperature: 0.7,
            maxTokens: 1024,
            responseTimeout: 15000,
            language: 'auto',
            responsePrefix: '🤖 ',
            fallbackResponse: "Sorry, I couldn't process your request. Please try again. 🥲",
            executeCommands: true,
            autoDetectLanguage: true
        };
    }

    // === MAIN METHOD ===
    async getResponse(userMessage, chatId, senderId, metadata = {}) {
        try {
            if (!this.config.enabled) return null;

            const cleanMessage = this.cleanMessage(userMessage);
            if (!cleanMessage || cleanMessage.length < 1) return null;

            // 🔍 Intelligent command detection
            const commandResult = await this.intelligentCommandDetection(cleanMessage);
            
            if (commandResult) {
                // If it's a command, execute it
                if (commandResult.isCommand && commandResult.command) {
                    const executionResult = await this.executeCommand(
                        commandResult.command,
                        commandResult.args || [],
                        chatId,
                        senderId,
                        metadata
                    );
                    
                    if (executionResult.success) {
                        return executionResult.message;
                    }
                    // If command fails, explain
                    return `❌ I couldn't execute the command \`${commandResult.command}\`. ${executionResult.error || 'Unknown error'}`;
                }
                
                // If it's just a normal conversation
                if (!commandResult.isCommand) {
                    // Generate natural AI response
                    return await this.generateNaturalResponse(cleanMessage, chatId, senderId);
                }
            }

            // Fallback: normal AI response
            return await this.generateNaturalResponse(cleanMessage, chatId, senderId);

        } catch (error) {
            console.error('Chatbot service error:', error);
            return this.config.fallbackResponse;
        }
    }

    // === INTELLIGENT COMMAND DETECTION ===
    async intelligentCommandDetection(userMessage) {
        try {
            // Build the prompt for AI
            const prompt = this.buildCommandDetectionPrompt(userMessage);
            
            // Call AI to analyze
            const provider = this.config.provider || 'default';
            const callProvider = this.providers[provider] || this.providers.default;
            
            const response = await this._callWithTimeout(
                () => callProvider(prompt, { isCommandDetection: true }, {}),
                10000
            );

            // Extract JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    console.log('🔍 Intent detection result:', parsed);
                    
                    // Check if it's a valid command
                    if (parsed.isCommand && parsed.command) {
                        // Check if command exists
                        if (commandHandler.commands.has(parsed.command)) {
                            return parsed;
                        }
                        
                        // Search for suggestion if command doesn't exist
                        const suggestion = commandHandler.findSuggestion(parsed.command);
                        if (suggestion && commandHandler.commands.has(suggestion)) {
                            parsed.command = suggestion;
                            parsed.suggested = true;
                            return parsed;
                        }
                        
                        // If command doesn't exist, consider as conversation
                        return { isCommand: false, reason: 'Command not found' };
                    }
                    
                    return parsed;
                } catch (e) {
                    console.error('JSON parse error:', e);
                }
            }

            // Fallback: simple keyword detection
            return this.simpleKeywordDetection(userMessage);

        } catch (error) {
            console.error('Intent detection error:', error);
            return this.simpleKeywordDetection(userMessage);
        }
    }

    buildCommandDetectionPrompt(userMessage) {
        // Get all commands with their descriptions
        const commands = Array.from(commandHandler.commands.values());
        let commandsList = 'COMMANDS:\n';
        
        for (const cmd of commands) {
            commandsList += `- ${cmd.command}`;
            if (cmd.aliases && cmd.aliases.length) {
                commandsList += ` (alias: ${cmd.aliases.join(', ')})`;
            }
            commandsList += `: ${cmd.description || 'No description'}`;
            if (cmd.usage) {
                commandsList += ` [Usage: ${cmd.usage}]`;
            }
            commandsList += '\n';
        }

        return `You are an AI that detects if a user wants to execute a command or just chat.

${commandsList}

USER MESSAGE: "${userMessage}"

ANALYZE CAREFULLY:
1. Does the user want to perform an action that matches a command?
2. If YES, which EXACT command matches best?
3. Extract any arguments (mentions, text, numbers, etc.)
4. If NO, just respond naturally

RULES:
- ONLY identify a command if the user CLEARLY asks for an action
- If the user is just chatting, DO NOT identify a command
- Be precise and careful

RESPOND WITH JSON ONLY:
{
    "isCommand": true/false,
    "command": "command_name",
    "args": ["arg1", "arg2"],
    "confidence": "high/medium/low",
    "reason": "why you chose this"
}

EXAMPLES:
- "create a sticker from this image" → {"isCommand": true, "command": "sticker", "args": [], "confidence": "high", "reason": "User wants to create sticker"}
- "download this music" → {"isCommand": true, "command": "download", "args": ["music"], "confidence": "high", "reason": "User wants to download"}
- "ban @user" → {"isCommand": true, "command": "ban", "args": ["@user"], "confidence": "high", "reason": "User wants to ban"}
- "hello how are you?" → {"isCommand": false, "reason": "Just greeting"}
- "what can you do?" → {"isCommand": false, "reason": "Just asking about capabilities"}
- "I want to see @user's profile picture" → {"isCommand": true, "command": "profilepic", "args": ["@user"], "confidence": "medium", "reason": "User wants profile picture"}

RESPOND WITH JSON ONLY. NO OTHER TEXT.`;
    }

    simpleKeywordDetection(userMessage) {
        const msg = userMessage.toLowerCase();
        
        // Define keywords for each command with contexts
        const commandKeywords = {
            sticker: ['sticker', 'autocollant', 'create sticker', 'make sticker', 'convert to sticker'],
            ping: ['ping', 'test', 'status', 'check'],
            ban: ['ban', 'bannir', 'exclude', 'remove'],
            kick: ['kick', 'expulser', 'throw out', 'remove'],
            promote: ['promote', 'promouvoir', 'admin', 'administrator'],
            demote: ['demote', 'rétrograder', 'remove admin'],
            profilepic: ['profilepic', 'pp', 'profile picture', 'avatar'],
            viewonce: ['viewonce', 'view once', 'ephemeral message'],
            download: ['download', 'télécharge', 'music', 'audio', 'video', 'song'],
            botmode: ['private mode', 'public mode', 'change mode']
        };

        let bestMatch = null;
        let highestScore = 0;

        for (const [cmd, keywords] of Object.entries(commandKeywords)) {
            let score = 0;
            for (const keyword of keywords) {
                if (msg.includes(keyword)) {
                    // The longer the keyword, the more specific it is
                    score += keyword.length / 5;
                }
            }
            if (score > highestScore && score > 1) {
                highestScore = score;
                bestMatch = cmd;
            }
        }

        if (bestMatch) {
            return {
                isCommand: true,
                command: bestMatch,
                args: this.extractArgs(msg),
                confidence: highestScore > 3 ? 'high' : 'medium',
                reason: `Keyword match: ${bestMatch}`
            };
        }

        return { isCommand: false, reason: 'No command detected' };
    }

    extractArgs(message) {
        const args = [];
        // Extract @mentions
        const mentions = message.match(/@[a-zA-Z0-9_]+/g);
        if (mentions) args.push(...mentions);
        
        // Extract numbers
        const numbers = message.match(/\d+/g);
        if (numbers) args.push(...numbers);
        
        // Extract text in quotes
        const quotes = message.match(/"([^"]*)"/g);
        if (quotes) args.push(...quotes.map(q => q.replace(/"/g, '')));
        
        return args;
    }

    // === NATURAL RESPONSE GENERATION ===
    async generateNaturalResponse(userMessage, chatId, senderId) {
        try {
            // Build context for normal conversation
            const context = this.buildConversationContext(userMessage, chatId);
            
            const provider = this.config.provider || 'default';
            const callProvider = this.providers[provider] || this.providers.default;
            
            const response = await this._callWithTimeout(
                () => callProvider(userMessage, context, { isConversation: true }),
                this.config.responseTimeout || 15000
            );

            // Clean and save
            const cleaned = this.cleanResponse(response);
            this.addToHistory(chatId, userMessage, cleaned);
            
            return cleaned || "I'm here! How can I help you? 😊";

        } catch (error) {
            console.error('Natural response error:', error);
            return this.config.fallbackResponse;
        }
    }

    buildConversationContext(userMessage, chatId) {
        let context = this.baseContext;
        
        // Add custom context
        if (this.config.customContext) {
            context += `\n\n=== ADDITIONAL CONTEXT ===\n${this.config.customContext}`;
        }

        // Add history
        const history = this.getHistory(chatId);
        if (history && history.length > 0) {
            context += `\n\n=== CONVERSATION HISTORY ===\n${history.join('\n')}`;
        }

        // Instructions for conversations
        context += `\n\n=== CURRENT MESSAGE ===\n${userMessage}\n\nIMPORTANT: This is a normal conversation. Respond naturally and helpfully. ONLY execute a command if the user clearly asks for it.`;
        
        return context;
    }

    // === COMMAND EXECUTION ===
    async executeCommand(commandName, args, chatId, senderId, metadata) {
        try {
            const cmd = commandHandler.commands.get(commandName);
            if (!cmd) {
                return { success: false, error: 'Command not found' };
            }

            // Check permissions
            const isOwnerOrSudo = metadata.isOwnerOrSudo || false;
            const isFromMe = metadata.isFromMe || false;
            const isGroup = chatId.endsWith('@g.us');

            // Check command restrictions
            if (cmd.ownerOnly && !isOwnerOrSudo && !isFromMe) {
                return { success: false, error: 'Command reserved for owner' };
            }

            if (cmd.groupOnly && !isGroup) {
                return { success: false, error: 'Command reserved for groups' };
            }

            // Create synthetic message
            const syntheticMessage = {
                key: {
                    remoteJid: chatId,
                    participant: senderId
                },
                message: {
                    extendedTextMessage: {
                        text: `${commandName} ${args.join(' ')}`,
                        contextInfo: {}
                    }
                },
                pushName: metadata.pushName || 'User'
            };

            // Execute the command
            await cmd.handler(metadata.sock, syntheticMessage, args, {
                chatId,
                senderId,
                isGroup,
                channelInfo: {
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true
                    }
                },
                rawText: `${commandName} ${args.join(' ')}`,
                messageText: `${commandName} ${args.join(' ')}`,
                userMessage: `${commandName} ${args.join(' ')}`,
                config
            });

            return { 
                success: true, 
                message: `✅ Command \`${commandName}\` executed successfully!` 
            };

        } catch (error) {
            console.error('Command execution error:', error);
            return { success: false, error: error.message };
        }
    }

    // === DEFAULT APIS ===
    async _callDefaultAPI(userMessage, context, metadata) {
        const fullPrompt = `${context}\n\nUser: ${userMessage}\n\nAssistant:`;
        
        let lastError = null;
        for (const api of this.defaultAPIs) {
            try {
                const url = api.url(fullPrompt);
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { Accept: 'application/json' }
                });

                if (!response.ok) {
                    console.warn(`API ${api.name} returned ${response.status}`);
                    continue;
                }

                const data = await response.json();
                const result = api.parse(data);
                
                if (result && result.length > 5) {
                    console.log(`✅ ${api.name} API responded`);
                    return this.cleanResponse(result);
                }
            } catch (error) {
                lastError = error;
                console.warn(`API ${api.name} error:`, error.message);
                continue;
            }
        }

        console.error('All default APIs failed:', lastError);
        return "I'm sorry, I can't respond at the moment. Please try again later. 🥲";
    }

    async _callGemini(userMessage, context, metadata) {
        const apiKey = this.config.apiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) return this._callDefaultAPI(userMessage, context, metadata);

        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
        const fullPrompt = `${context}\n\nUser: ${userMessage}`;

        const response = await fetch(`${url}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: fullPrompt }]
                }],
                generationConfig: {
                    temperature: this.config.temperature || 0.7,
                    maxOutputTokens: this.config.maxTokens || 1024
                }
            })
        });

        if (!response.ok) {
            console.error('Gemini API error:', await response.text());
            return this._callDefaultAPI(userMessage, context, metadata);
        }

        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return this.cleanResponse(result) || this.config.fallbackResponse;
    }

    async _callNgrok(userMessage, context, metadata) {
        const url = this.config.apiUrl;
        if (!url) return this._callDefaultAPI(userMessage, context, metadata);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.config.apiKey ? `Bearer ${this.config.apiKey}` : ''
            },
            body: JSON.stringify({
                message: userMessage,
                context,
                metadata
            })
        });

        if (!response.ok) {
            console.error('Ngrok API error:', await response.text());
            return this._callDefaultAPI(userMessage, context, metadata);
        }

        const data = await response.json();
        const result = data.response || data.reply || data.text;
        return this.cleanResponse(result) || this.config.fallbackResponse;
    }

    async _callOpenAI(userMessage, context, metadata) {
        const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
        if (!apiKey) return this._callDefaultAPI(userMessage, context, metadata);

        const url = 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: context },
                    { role: 'user', content: userMessage }
                ],
                temperature: this.config.temperature || 0.7,
                max_tokens: this.config.maxTokens || 1024
            })
        });

        if (!response.ok) {
            console.error('OpenAI API error:', await response.text());
            return this._callDefaultAPI(userMessage, context, metadata);
        }

        const data = await response.json();
        const result = data.choices?.[0]?.message?.content;
        return this.cleanResponse(result) || this.config.fallbackResponse;
    }

    async _callCustom(userMessage, context, metadata) {
        const url = this.config.apiUrl;
        if (!url) return this._callDefaultAPI(userMessage, context, metadata);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.config.apiKey ? `Bearer ${this.config.apiKey}` : ''
            },
            body: JSON.stringify({
                message: userMessage,
                context,
                metadata
            })
        });

        if (!response.ok) {
            console.error('Custom API error:', await response.text());
            return this._callDefaultAPI(userMessage, context, metadata);
        }

        const data = await response.json();
        const result = data.response || data.reply || data.text || data.result;
        return this.cleanResponse(result) || this.config.fallbackResponse;
    }

    // === UTILITIES ===
    cleanMessage(message) {
        const botName = global.botname || 'NOVA';
        const patterns = [
            new RegExp(`^${botName}\\s+`, 'i'),
            new RegExp('^@\\w+\\s+', 'i'),
            new RegExp(`^${botName}[:]\\s+`, 'i')
        ];
        
        let cleaned = message;
        for (const pattern of patterns) {
            cleaned = cleaned.replace(pattern, '').trim();
        }
        return cleaned;
    }

    cleanResponse(response) {
        if (!response) return null;
        
        let cleaned = response
            .replace(/^AI:\s*/i, '')
            .replace(/^Assistant:\s*/i, '')
            .replace(/^NOVA:\s*/i, '')
            .trim();
        
        if (cleaned.length > 2000) {
            cleaned = cleaned.slice(0, 2000) + '...';
        }
        
        return cleaned;
    }

    // === HISTORY MANAGEMENT ===
    getHistory(chatId) {
        const history = this.history.get(chatId) || [];
        const maxHistory = this.config.maxHistory || 15;
        return history.slice(-maxHistory);
    }

    addToHistory(chatId, userMessage, response) {
        if (!this.history.has(chatId)) {
            this.history.set(chatId, []);
        }
        const history = this.history.get(chatId);
        history.push(`User: ${userMessage}`);
        history.push(`NOVA: ${response}`);
        
        const maxHistory = this.config.maxHistory || 15;
        if (history.length > maxHistory * 2) {
            this.history.set(chatId, history.slice(-maxHistory * 2));
        }
    }

    clearHistory(chatId) {
        if (chatId) {
            this.history.delete(chatId);
        } else {
            this.history.clear();
        }
    }

    // === CONTEXT MANAGEMENT ===
    setContext(chatId, context) {
        if (chatId) {
            this.contextCache.set(chatId, context);
        } else {
            this.config.customContext = context;
            chatbotConfig.set('customContext', context);
        }
    }

    getContext(chatId) {
        return this.contextCache.get(chatId) || this.config.customContext || '';
    }

    // === TIMEOUT ===
    async _callWithTimeout(fn, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);

            fn()
                .then(result => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }
}

export default new ChatbotService();