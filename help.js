import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

export default {
    name: 'help',
    description: "Affiche le menu d'aide du bot NOVA-MD v3.0 - Powered by Nostra",
    category: 'information',
    aliases: ['aide', 'menu', 'commands', 'h'],
    
    run: async (context) => {
        try {
            const { sock, msg, sender } = context;
            const BOT_NAME = "NOVA-MD v3.0";
            const PREFIX = "!";
            log.info(`Commande HELP reçue de ${sender}`);

            let helpText = `╭─────────────────────────────╮\n`;
            helpText += `│  🤖 NOVA-MD v3.0 - HELP 🤖   │\n`;
            helpText += `│   Powered by Nostra          │\n`;
            helpText += `╰─────────────────────────────╯\n\n`;

            helpText += `*🎯 COMMANDES IA (NOUVELLE v3.0):*\n\n`;

            helpText += `1️⃣  *!ai <question>*\n`;
            helpText += `    → Poser une question à l'IA Groq\n`;
            helpText += `    💡 Ex: !ai Quelle est la capitale de la France?\n\n`;

            helpText += `2️⃣  *!ai login <clé>*\n`;
            helpText += `    → Configurer votre clé Groq API\n`;
            helpText += `    💡 Obtenir: https://console.groq.com\n`;
            helpText += `    💡 Ex: !ai login gsk_xxxxxxxxxxxxx\n\n`;

            helpText += `3️⃣  *!quiz <thème>*\n`;
            helpText += `    → Lancer un quiz interactif\n`;
            helpText += `    📚 Thèmes: histoire, science, géographie, informatique\n`;
            helpText += `    💡 Ex: !quiz science\n\n`;

            helpText += `*📚 COMMANDES CLASSIQUES:*\n\n`;

            helpText += `4️⃣  *!help* (ou !h)\n`;
            helpText += `    → Affiche cette aide\n\n`;

            helpText += `5️⃣  *!info*\n`;
            helpText += `    → Affiche les infos du bot\n\n`;

            helpText += `6️⃣  *!restore*\n`;
            helpText += `    → Restaure les messages supprimés (Admin)\n\n`;

            helpText += `7️⃣  *!rules*\n`;
            helpText += `    → Affiche les règles d'utilisation\n\n`;

            helpText += `*✨ INSTRUCTIONS INTELLIGENTES (IA v3.0):*\n\n`;
            helpText += `🎯 L'IA peut maintenant exécuter les commandes!\n\n`;
            helpText += `Exemples:\n`;
            helpText += `• "Nova affiche moi les commandes"\n`;
            helpText += `  → IA lance !help et affiche les résultats\n\n`;
            helpText += `• "IA organise un quiz"\n`;
            helpText += `  → IA lance !quiz et gère le jeu\n\n`;
            helpText += `• "Dis-moi les infos du bot"\n`;
            helpText += `  → IA lance !info et commente\n\n`;

            helpText += `*⚙️  FONCTIONNALITÉS v3.0:*\n`;
            helpText += `✅ IA Groq Gratuite (ultra-rapide)\n`;
            helpText += `✅ Configuration dynamique (!ai login)\n`;
            helpText += `✅ Exécution de commandes par l'IA\n`;
            helpText += `✅ Quiz interactifs (5 thèmes)\n`;
            helpText += `✅ Historique conversation (20 messages)\n`;
            helpText += `✅ Sauvegarde messages supprimés\n`;
            helpText += `✅ Mode privé (Admin)\n`;
            helpText += `✅ Réponse automatique après 2 min\n\n`;

            helpText += `*🚀 DÉMARRAGE RAPIDE:*\n`;
            helpText += `1. Obtenir clé Groq: https://console.groq.com\n`;
            helpText += `2. Configurer: !ai login gsk_xxxxx\n`;
            helpText += `3. Poser une question: !ai Bonjour!\n`;
            helpText += `4. Lancer un quiz: !quiz histoire\n\n`;

            helpText += `*💡 ASTUCES:*\n`;
            helpText += `🔹 Utilisez des instructions naturelles\n`;
            helpText += `🔹 L'IA comprend le français\n`;
            helpText += `🔹 Chaque utilisateur peut avoir sa clé\n`;
            helpText += `🔹 Quiz multiuser en groupe\n\n`;

            helpText += `*📖 DOCUMENTATION:*\n`;
            helpText += `→ README_GROQ_UPDATE.md (guide complet)\n`;
            helpText += `→ README.md (guide général)\n`;
            helpText += `→ QUICKSTART.md (démarrage 5 min)\n\n`;

            helpText += `*🔐 NOTE IMPORTANTE:*\n`;
            helpText += `Certaines commandes sont réservées au propriétaire.`;

            await sock.sendMessage(sender, {
                text: helpText,
            });

            log.info(`ℹ️  Commande help envoyée à ${sender}`);
        } catch (error) {
            log.error('❌ Erreur commande help:', error);
            await sock.sendMessage(sender, {
                text: '❌ Erreur lors de l\'exécution de la commande.',
            });
        }
    }
};
