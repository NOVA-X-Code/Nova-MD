import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

/**
 * Commande: !ai login <clé_groq>
 * Description: Configure la clé API Groq pour l'assistant IA
 * Usage: !ai login gsk_xxxxxxxxxxxxxxxxxxxx
 * Auteur: NOVA-MD v3.0 (Powered by Nostra)
 */

export default async function handleAILogin(message, sock, sender, aiHandler) {
    try {
        // Format: !ai login <clé>
        const args = message.trim().split(/\s+/);
        
        if (args.length < 3) {
            return '❌ Usage: !ai login <votre_clé_groq>\n\n📝 Exemple:\n!ai login gsk_xxxxxxxxxxxxxxxxxxxx\n\n💡 Obtenir votre clé gratuite:\nhttps://console.groq.com';
        }

        const apiKey = args[2];
        const senderName = sender.split('@')[0]; // Nom du contact

        // Valider que c'est une clé Groq (commence par gsk_)
        if (!apiKey.startsWith('gsk_')) {
            return '❌ Erreur: La clé doit commencer par "gsk_"\n\n💡 Obtenir votre clé gratuite:\nhttps://console.groq.com';
        }

        // Mettre à jour la clé dans AIHandler
        const success = aiHandler.updateAPIKey(apiKey, senderName);

        if (!success) {
            return '❌ Erreur: Impossible de mettre à jour la clé API.\n\nVérifiez que la clé est valide.';
        }

        log.info(`✅ Clé Groq configurée pour ${senderName}`);

        return `✅ **Configuration réussie!**\n\n🤖 Assistant IA NOVA est maintenant actif (Powered by Nostra)\n\nℹ️ Utilise:\n• !ai <question> - Poser une question\n• Nova affiche moi les commandes - IA lance !help\n• Organise un quiz - IA organise un quiz\n\n💡 Modèle: Groq Mixtral 8x7B (gratuit + rapide)`;

    } catch (error) {
        log.error('❌ Erreur commande ai login:', error);
        return `❌ Erreur: ${error.message}`;
    }
}
