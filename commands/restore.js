import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

export default {
    name: 'restore',
    description: 'Restaure et affiche tous les messages supprimés (Propriétaire uniquement)',
    category: 'admin',
    aliases: ['r', 'recover'],

    run: async (context) => {
        try {
            const { sock, msg, replyWithTag, sender, ownerNumber, databaseManager } = context;

            // Vérifier que seul le propriétaire peut utiliser cette commande
            if (sender !== ownerNumber) {
                log.warn(`⚠️  Tentative d'utilisation de !restore par ${sender}`);
                await replyWithTag(
                    sock,
                    '❌ Cette commande est réservée au propriétaire.',
                    msg,
                    sender
                );
                return;
            }

            if (!databaseManager) {
                await replyWithTag(
                    sock,
                    '❌ Base de données non disponible.',
                    msg,
                    sender
                );
                return;
            }

            log.info(`🔍 Récupération des messages supprimés pour ${sender}`);

            // Récupérer tous les messages supprimés
            const deletedMessages = await databaseManager.getDeletedMessages();

            if (!deletedMessages || deletedMessages.length === 0) {
                await replyWithTag(
                    sock,
                    '✅ Aucun message supprimé à restaurer.',
                    msg,
                    sender
                );
                return;
            }

            // Préparer le message pour le propriétaire
            let restoreText = `📋 *MESSAGES SUPPRIMÉS RESTAURÉS* (${deletedMessages.length})\n`;
            restoreText += `${'='.repeat(50)}\n\n`;

            for (const delMsg of deletedMessages) {
                const date = new Date(delMsg.timestamp).toLocaleString('fr-FR');
                restoreText += `👤 **De:** ${delMsg.sender_number}\n`;
                restoreText += `⏰ **Date:** ${date}\n`;
                restoreText += `📝 **Contenu:**\n${delMsg.message_content || '(Média: ' + delMsg.media_type + ')'}\n`;
                restoreText += `${'─'.repeat(50)}\n\n`;
            }

            // Envoyer les messages restaurés par chunks si c'est trop long
            const chunkSize = 3;
            for (let i = 0; i < deletedMessages.length; i += chunkSize) {
                const chunk = deletedMessages.slice(i, i + chunkSize);
                let chunkText = `📋 *MESSAGES SUPPRIMÉS* (${i + 1} à ${Math.min(i + chunkSize, deletedMessages.length)} / ${deletedMessages.length})\n`;
                chunkText += `${'='.repeat(50)}\n\n`;

                for (const delMsg of chunk) {
                    const date = new Date(delMsg.timestamp).toLocaleString('fr-FR');
                    chunkText += `👤 **De:** ${delMsg.sender_number}\n`;
                    chunkText += `⏰ **Date:** ${date}\n`;
                    chunkText += `📝 **Contenu:**\n${delMsg.message_content || '(Média: ' + delMsg.media_type + ')'}\n`;
                    chunkText += `${'─'.repeat(50)}\n\n`;
                }

                await replyWithTag(sock, chunkText, msg, sender);

                // Petit délai entre les chunks
                await new Promise((resolve) => setTimeout(resolve, 500));
            }

            // Supprimer les messages de la base de données
            const deletedCount = await databaseManager.clearDeletedMessages();

            await replyWithTag(
                sock,
                `✅ ${deletedCount} message(s) supprimé(s) de la base de données.`,
                msg,
                sender
            );

            log.info(`✅ ${deletedCount} messages supprimés restaurés et nettoyés`);
        } catch (error) {
            log.error('❌ Erreur commande restore:', error);
            await replyWithTag(
                sock,
                '❌ Erreur lors de la restauration des messages.',
                msg,
                sender
            );
        }
    },
};
