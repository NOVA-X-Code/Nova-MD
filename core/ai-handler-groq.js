import Groq from 'groq-sdk';
import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

class AIHandler {
    constructor(apiKey, systemPrompt) {
        this.apiKey = apiKey || process.env.GROQ_API_KEY;
        this.currentUser = process.env.GROQ_API_USER || 'default';
        
        if (!this.apiKey) {
            log.warn('⚠️  Groq API Key non configurée. Utilise: ai login <clé>');
        }
        
        this.client = this.apiKey ? new Groq({ apiKey: this.apiKey }) : null;
        this.systemPrompt = systemPrompt || process.env.AI_SYSTEM_PROMPT || 
            'Tu es l\'Assistant IA NOVA - Powered by Nostra. Tu es intelligent, rapide et serviable.';
        this.conversationHistory = new Map();
        this.commandExecutor = null; // Sera défini par index.js
    }

    /**
     * Définir l'exécuteur de commandes
     */
    setCommandExecutor(executor) {
        this.commandExecutor = executor;
        log.info('✅ Command executor attaché à AIHandler');
    }

    /**
     * Mettre à jour la clé API Groq
     */
    updateAPIKey(newApiKey, userName = 'default') {
        try {
            this.apiKey = newApiKey;
            this.currentUser = userName;
            this.client = new Groq({ apiKey: this.apiKey });
            log.info(`✅ Clé Groq mise à jour pour l'utilisateur: ${userName}`);
            return true;
        } catch (error) {
            log.error('❌ Erreur mise à jour clé Groq:', error.message);
            return false;
        }
    }

    /**
     * Vérifier si l'IA est prête
     */
    isReady() {
        return this.client !== null && this.apiKey !== null;
    }

    /**
     * Mettre à jour le prompt système
     */
    setSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
        log.info('✅ Prompt système mis à jour');
    }

    /**
     * Ajouter un message à l'historique de conversation
     */
    addMessageToHistory(sender, role, content) {
        if (!this.conversationHistory.has(sender)) {
            this.conversationHistory.set(sender, []);
        }
        this.conversationHistory.get(sender).push({
            role,
            content,
        });

        // Garder seulement les 20 derniers messages par conversation
        if (this.conversationHistory.get(sender).length > 20) {
            this.conversationHistory.get(sender).shift();
        }
    }

    /**
     * Obtenir l'historique de conversation
     */
    getConversationHistory(sender) {
        return this.conversationHistory.get(sender) || [];
    }

    /**
     * Nettoyer l'historique de conversation
     */
    clearConversationHistory(sender) {
        if (sender) {
            this.conversationHistory.delete(sender);
            log.info(`🗑️  Historique conversation supprimé pour ${sender}`);
        } else {
            this.conversationHistory.clear();
            log.info('🗑️  Tout l\'historique conversation supprimé');
        }
    }

    /**
     * Déterminer si le message est une instruction de commande
     */
    isCommandInstruction(message) {
        const patterns = [
            /^(nova|affiche|lance|exécute|organise|fais|dis|gère)/i,
            /\b(commande|help|info|commands|cmd)\b/i,
            /\b(quiz|jeu|game|organise)\b/i,
        ];
        return patterns.some(pattern => pattern.test(message));
    }

    /**
     * Extraire la commande à exécuter du message
     */
    extractCommand(message) {
        // Exemples:
        // "nova affiche moi les commandes" → "help"
        // "IA lance moi !help" → "help"
        // "organise un quiz" → "quiz"
        
        if (/help|commandes?|commands?|info/i.test(message)) {
            return 'help';
        }
        if (/quiz|quizz/i.test(message)) {
            return 'quiz';
        }
        if (/restore|supprimé/i.test(message)) {
            return 'restore';
        }
        if (/rules|règles|conditions/i.test(message)) {
            return 'rules';
        }
        
        return null;
    }

    /**
     * Générer une réponse IA avec capacité d'exécution de commandes
     */
    async generateResponse(userMessage, sender, additionalContext = '') {
        try {
            if (!this.isReady()) {
                return '❌ Erreur: Clé Groq non configurée. Utilise: ai login <votre_clé_groq>';
            }

            // Vérifier si c'est une instruction de commande
            const isCommand = this.isCommandInstruction(userMessage);
            let commandResult = null;

            if (isCommand && this.commandExecutor) {
                const command = this.extractCommand(userMessage);
                if (command) {
                    try {
                        log.info(`🤖 Exécution commande IA: ${command}`);
                        commandResult = await this.commandExecutor.execute(command, sender, {
                            isAIGenerated: true,
                            originalMessage: userMessage,
                        });
                    } catch (error) {
                        log.warn(`⚠️  Erreur exécution commande: ${error.message}`);
                    }
                }
            }

            // Ajouter le message utilisateur à l'historique
            this.addMessageToHistory(sender, 'user', userMessage);

            // Construire le contexte
            let contextMessage = additionalContext;
            if (commandResult) {
                contextMessage += `\n\nRésultat de la commande exécutée:\n${commandResult}`;
            }

            // Construire les messages pour Groq
            const messages = [
                {
                    role: 'system',
                    content: `${this.systemPrompt}${contextMessage ? `\n\nContexte supplémentaire: ${contextMessage}` : ''}`,
                },
                ...this.getConversationHistory(sender),
            ];

            log.debug(`🤖 Envoi à Groq pour ${sender}: "${userMessage.substring(0, 50)}..."`);

            const response = await this.client.chat.completions.create({
                model: 'mixtral-8x7b-32768', // Modèle gratuit Groq
                messages: messages,
                temperature: 0.7,
                max_tokens: 1024,
                top_p: 1,
            });

            const assistantMessage = response.choices[0].message.content;

            // Ajouter la réponse à l'historique
            this.addMessageToHistory(sender, 'assistant', assistantMessage);

            log.info(`✅ Réponse IA générée pour ${sender}`);
            return assistantMessage;
        } catch (error) {
            log.error('❌ Erreur génération réponse IA:', error.message);
            
            // Gestion des erreurs spécifiques Groq
            if (error.message.includes('API key')) {
                return '❌ Erreur: Clé API Groq invalide. Utilise: ai login <clé_valide>';
            }
            if (error.message.includes('rate limit')) {
                return '⏳ Le service est temporairement surchargé. Réessaye dans quelques secondes.';
            }
            
            return '❌ Erreur IA: Impossible de générer une réponse.';
        }
    }

    /**
     * Générer une réponse basée sur un historique de messages
     */
    async generateResponseFromHistory(messageHistory, sender) {
        try {
            if (!this.isReady()) {
                return '❌ Erreur: Clé Groq non configurée.';
            }

            const historyContext = messageHistory
                .map((msg) => `${msg.sender || 'Client'}: ${msg.content}`)
                .join('\n');

            log.debug(`🤖 Génération de réponse basée sur l'historique pour ${sender}`);

            const response = await this.client.chat.completions.create({
                model: 'mixtral-8x7b-32768',
                messages: [
                    {
                        role: 'system',
                        content: this.systemPrompt,
                    },
                    {
                        role: 'user',
                        content: `Historique de conversation:\n${historyContext}\n\nGénère une réponse appropriée.`,
                    },
                ],
                temperature: 0.7,
                max_tokens: 1024,
            });

            const assistantMessage = response.choices[0].message.content;
            log.info(`✅ Réponse IA générée à partir de l'historique pour ${sender}`);
            return assistantMessage;
        } catch (error) {
            log.error('❌ Erreur génération réponse IA:', error.message);
            return '❌ Erreur lors de la génération de la réponse.';
        }
    }
}

export default AIHandler;
