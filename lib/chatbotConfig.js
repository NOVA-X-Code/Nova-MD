import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_FILE = './data/chatbot_config.json';

// Configuration par défaut
const DEFAULT_CONFIG = {
    enabled: true,
    mode: 'private', // 'public' | 'private'
    provider: 'puter', // 'puter' | 'pollinations' | 'gemini' | 'ngrok' | 'openai' | 'custom' — an apiKey is REQUIRED regardless of provider
    apiKey: '', // MANDATORY — the chatbot won't respond until this is set (.cbc apikey <key>). For 'puter': your Puter auth token, see https://developer.puter.com/tutorials/puter-auth-token/
    puterModel: 'gpt-5.4-nano', // free/unlimited Puter model used when provider is 'puter'
    apiUrl: '',
    customContext: '',
    maxHistory: 15,
    temperature: 0.7,
    maxTokens: 1024,
    responseTimeout: 15000,
    language: 'auto',
    responsePrefix: '🤖 ',
    fallbackResponse: "Désolé, je n'ai pas pu traiter votre demande. Veuillez réessayer. 🥲",
    executeCommands: true,
    autoDetectLanguage: true
};

class ChatbotConfig {
    constructor() {
        this.config = null;
        this.loadConfig();
    }

    loadConfig() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
                this.config = { ...DEFAULT_CONFIG, ...data };
                console.log('🤖 Chatbot config loaded');
            } else {
                this.config = { ...DEFAULT_CONFIG };
                this.saveConfig();
                console.log('🤖 Chatbot config created with defaults');
            }
        } catch (error) {
            console.error('Error loading chatbot config:', error);
            this.config = { ...DEFAULT_CONFIG };
        }
        return this.config;
    }

    saveConfig() {
        try {
            const dir = path.dirname(CONFIG_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving chatbot config:', error);
            return false;
        }
    }

    get(key) {
        return this.config[key];
    }

    set(key, value) {
        this.config[key] = value;
        this.saveConfig();
        return this;
    }

    getStatus() {
        const status = {
            enabled: this.config.enabled ? '✅' : '❌',
            mode: this.config.mode === 'private' ? '🔒 Privé' : '🌍 Public',
            provider: this.config.provider.toUpperCase(),
            apiConfigured: !!(this.config.apiKey || this.config.apiUrl),
            contextLoaded: !!(this.config.customContext),
            historySize: this.config.maxHistory,
            temperature: this.config.temperature
        };
        return status;
    }
}

export default new ChatbotConfig();