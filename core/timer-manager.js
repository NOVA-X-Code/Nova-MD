import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

class TimerManager {
    constructor(delay = 120000) {
        this.delay = delay;
        this.timers = new Map(); // Map of sender -> { timerId, messageId, messageContent }
        this.callbacks = new Map(); // Map of sender -> callback function
    }

    /**
     * Enregistrer une fonction de rappel à exécuter après le délai
     */
    onTimeout(sender, callback) {
        this.callbacks.set(sender, callback);
    }

    /**
     * Démarrer un timer pour un expéditeur
     */
    startTimer(sender, messageId, messageContent) {
        // Annuler le timer existant s'il y en a un
        this.cancelTimer(sender);

        log.info(`⏱️  Timer démarré pour ${sender} (délai: ${this.delay}ms)`);

        const timerId = setTimeout(async () => {
            log.info(`⏱️  Timer expiré pour ${sender}`);

            const callback = this.callbacks.get(sender);
            if (callback) {
                try {
                    await callback(sender, messageId, messageContent);
                } catch (error) {
                    log.error(`❌ Erreur exécution callback timer pour ${sender}:`, error);
                }
            }

            this.timers.delete(sender);
        }, this.delay);

        this.timers.set(sender, {
            timerId,
            messageId,
            messageContent,
        });
    }

    /**
     * Annuler un timer pour un expéditeur
     */
    cancelTimer(sender) {
        const timerData = this.timers.get(sender);
        if (timerData) {
            clearTimeout(timerData.timerId);
            this.timers.delete(sender);
            log.info(`✅ Timer annulé pour ${sender}`);
            return true;
        }
        return false;
    }

    /**
     * Vérifier si un timer est actif pour un expéditeur
     */
    hasActiveTimer(sender) {
        return this.timers.has(sender);
    }

    /**
     * Obtenir les données du timer
     */
    getTimerData(sender) {
        return this.timers.get(sender) || null;
    }

    /**
     * Nettoyer tous les timers
     */
    clearAll() {
        for (const [sender, timerData] of this.timers.entries()) {
            clearTimeout(timerData.timerId);
        }
        this.timers.clear();
        log.info('✅ Tous les timers nettoyés');
    }

    /**
     * Définir le délai (en ms)
     */
    setDelay(delayMs) {
        this.delay = delayMs;
        log.info(`✅ Délai du timer mis à jour à ${delayMs}ms`);
    }
}

export default TimerManager;
