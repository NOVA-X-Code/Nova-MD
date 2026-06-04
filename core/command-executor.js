import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

/**
 * CommandExecutor - Permet à l'IA d'exécuter les commandes du bot
 * Utilisé pour: Nova affiche moi les commandes → IA exécute !help
 */

class CommandExecutor {
    constructor(sock, sender, databaseManager, aiHandler) {
        this.sock = sock;
        this.sender = sender;
        this.databaseManager = databaseManager;
        this.aiHandler = aiHandler;
        this.commandHandlers = new Map();
    }

    /**
     * Enregistrer un gestionnaire de commande
     */
    registerCommand(name, handler) {
        this.commandHandlers.set(name.toLowerCase(), handler);
    }

    /**
     * Exécuter une commande
     */
    async execute(commandName, sender, options = {}) {
        try {
            const command = commandName.toLowerCase();
            const handler = this.commandHandlers.get(command);

            if (!handler) {
                log.warn(`⚠️  Commande inconnue: ${command}`);
                return `❌ Commande inconnue: ${command}`;
            }

            log.info(`🎯 Exécution commande: ${command} (IA: ${options.isAIGenerated ? 'oui' : 'non'})`);

            // Exécuter la commande
            const result = await handler(sender, options);

            // Limiter la longueur du résultat pour éviter les messages trop longs
            if (typeof result === 'string') {
                return result.substring(0, 2000);
            }

            return result;

        } catch (error) {
            log.error(`❌ Erreur exécution commande ${commandName}:`, error);
            return `❌ Erreur lors de l'exécution de la commande: ${error.message}`;
        }
    }

    /**
     * Exécuter une commande et envoyer le résultat par WhatsApp
     */
    async executeAndSend(commandName, sender, options = {}) {
        try {
            const result = await this.execute(commandName, sender, options);

            if (result && this.sock) {
                await this.sock.sendMessage(sender, {
                    text: result,
                });
            }

            return result;

        } catch (error) {
            log.error(`❌ Erreur executeAndSend:`, error);
            return null;
        }
    }
}

export default CommandExecutor;
