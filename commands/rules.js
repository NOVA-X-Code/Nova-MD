import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

export default {
    name: 'rules',
    description: 'Affiche les règles et termes d\'utilisation du bot',
    category: 'information',
    aliases: ['regles', 'termes', 'terms'],
    
    run: async (context) => {
        try {
            const { sock, sender } = context;

            log.info(`Commande RULES reçue de ${sender}`);

            let rulesText = `╭─────────────────────────────╮\n`;
            rulesText += `│ 📋 *RÈGLES D'UTILISATION* 📋 │\n`;
            rulesText += `╰─────────────────────────────╯\n\n`;

            rulesText += `*Conditions Générales d'Utilisation:*\n\n`;

            rulesText += `1️⃣  *Respect des Politiques WhatsApp*\n`;
            rulesText += `Vous acceptez de respecter les conditions d'utilisation de WhatsApp et de ne pas:\n`;
            rulesText += `❌ Envoyer du spam ou du contenu frauduleux\n`;
            rulesText += `❌ Partager du contenu illégal ou offensant\n`;
            rulesText += `❌ Utiliser le bot pour du harcèlement\n\n`;

            rulesText += `2️⃣  *Utilisation Responsable*\n`;
            rulesText += `✅ Utilisez le bot uniquement à des fins légitimes\n`;
            rulesText += `✅ Respectez la vie privée des autres utilisateurs\n`;
            rulesText += `✅ Signalez tout abus aux administrateurs\n\n`;

            rulesText += `3️⃣  *Données & Confidentialité*\n`;
            rulesText += `📝 Les messages sont stockés de manière sécurisée\n`;
            rulesText += `🔒 Les données sont traitées conformément au RGPD\n`;
            rulesText += `⚠️  Ne partagez pas d'informations sensibles\n\n`;

            rulesText += `4️⃣  *Restrictions*\n`;
            rulesText += `❌ Pas d'automatisation abusive\n`;
            rulesText += `❌ Pas de scraping de données\n`;
            rulesText += `❌ Pas de contournement de restrictions\n\n`;

            rulesText += `5️⃣  *Support & Assistance*\n`;
            rulesText += `📧 Contactez l'administrateur en cas de problème\n`;
            rulesText += `🐛 Signalez les bugs et suggestions d'améliorations\n\n`;

            rulesText += `*⚠️  Violation des Règles:*\n`;
            rulesText += `En cas de non-respect, le bot peut être désactivé pour votre numéro.\n\n`;

            rulesText += `✅ J'accepte ces conditions`;

            await sock.sendMessage(sender, {
                text: rulesText,
            });

            log.info(`📋 Commande rules envoyée à ${sender}`);
        } catch (error) {
            log.error('❌ Erreur commande rules:', error);
            await sock.sendMessage(sender, {
                text: '❌ Erreur lors de l\'exécution de la commande.',
            });
        }
    }
};
