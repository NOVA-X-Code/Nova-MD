import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

export default {
    name: 'info',
    description: 'Affiche les informations du bot NOVA-MD',
    category: 'information',
    aliases: ['about', 'botinfo', 'infos'],
    
    run: async (context) => {
        try {
            const { sock, sender } = context;

            log.info(`Commande INFO reçue de ${sender}`);

            const uptime = Math.floor(process.uptime());
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = uptime % 60;

            const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const memoryTotal = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);
            const platform = process.platform;

            let infoText = `╭─────────────────────────────╮\n`;
            infoText += `│    📱 *NOVA-MD INFO* 📱     │\n`;
            infoText += `╰─────────────────────────────╯\n\n`;

            infoText += `*🤖 Informations du Bot:*\n`;
            infoText += `• *Nom:* NOVA-MD\n`;
            infoText += `• *Version:* 2.0.0\n`;
            infoText += `• *Type:* WhatsApp Bot avec IA\n`;
            infoText += `• *Framework:* Baileys + OpenAI\n\n`;

            infoText += `*📊 Statut du Serveur:*\n`;
            infoText += `• ⏱️  *Uptime:* ${hours}h ${minutes}m ${seconds}s\n`;
            infoText += `• 💾 *Mémoire:* ${memoryUsage}MB / ${memoryTotal}MB\n`;
            infoText += `• 🖥️  *Plateforme:* ${platform}\n`;
            infoText += `• 🔄 *Node.js:* ${process.version}\n\n`;

            infoText += `*✨ Fonctionnalités Activées:*\n`;
            infoText += `✅ Assistant IA (OpenAI)\n`;
            infoText += `✅ Gestion des messages supprimés (PostgreSQL)\n`;
            infoText += `✅ Mode privé (Propriétaire)\n`;
            infoText += `✅ Réponse automatique après 2 min\n`;
            infoText += `✅ Sessions persistantes\n`;
            infoText += `✅ Support QR Code + Pairing Code\n\n`;

            infoText += `*📞 Contact:*\n`;
            infoText += `Pour toute question ou problème, utilisez !help\n\n`;

            infoText += `*🔗 Liens:*\n`;
            infoText += `GitHub: https://github.com/\n`;
            infoText += `Documentation: /api/status`;

            await sock.sendMessage(sender, {
                text: infoText,
            });

            log.info(`ℹ️  Commande info envoyée à ${sender}`);
        } catch (error) {
            log.error('❌ Erreur commande info:', error);
            await sock.sendMessage(sender, {
                text: '❌ Erreur lors de l\'exécution de la commande.',
            });
        }
    }
};
