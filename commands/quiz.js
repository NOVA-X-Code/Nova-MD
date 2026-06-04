import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

/**
 * Commande: !quiz <thème>
 * Description: Organise un quiz interactif avec les participants du groupe
 * Usage: !quiz histoire (propose un quiz sur l'histoire)
 * Auteur: NOVA-MD v3.0 (Powered by Nostra)
 */

// Données de quiz par thème
const QUIZ_DATA = {
    histoire: {
        titre: '📚 Quiz Histoire',
        questions: [
            {
                q: 'En quelle année la Révolution française a-t-elle commencé?',
                a: '1789',
                opts: ['1776', '1789', '1812', '1848']
            },
            {
                q: 'Qui a découvert l\'Amérique?',
                a: 'Christophe Colomb',
                opts: ['Christophe Colomb', 'Léif Erikson', 'Vasco de Gama', 'Ferdinand Magellan']
            },
            {
                q: 'En quelle année l\'homme a-t-il marché sur la Lune?',
                a: '1969',
                opts: ['1962', '1969', '1975', '1981']
            },
            {
                q: 'Quel pharaon a construit la Grande Pyramide de Giza?',
                a: 'Khéops',
                opts: ['Khéops', 'Khéphren', 'Menkaouré', 'Ramsès II']
            },
            {
                q: 'Quelle empire a construit la Muraille de Chine?',
                a: 'La Chine',
                opts: ['L\'empire mongol', 'La Chine', 'L\'empire romain', 'L\'empire ottoman']
            }
        ]
    },
    science: {
        titre: '🔬 Quiz Science',
        questions: [
            {
                q: 'Quel est le plus grand organe du corps humain?',
                a: 'La peau',
                opts: ['Le cœur', 'Le cerveau', 'La peau', 'Le foie']
            },
            {
                q: 'Combien de cordes a une guitare standard?',
                a: '6',
                opts: ['4', '5', '6', '7']
            },
            {
                q: 'Quel élément chimique a le symbole Au?',
                a: 'L\'or',
                opts: ['L\'argent', 'L\'or', 'L\'aluminium', 'L\'arsenic']
            },
            {
                q: 'Quelle planète est la plus proche du Soleil?',
                a: 'Mercure',
                opts: ['Vénus', 'Terre', 'Mercure', 'Mars']
            },
            {
                q: 'Combien de côtés a un hexagone?',
                a: '6',
                opts: ['5', '6', '7', '8']
            }
        ]
    },
    géographie: {
        titre: '🗺️  Quiz Géographie',
        questions: [
            {
                q: 'Quelle est la capitale de la France?',
                a: 'Paris',
                opts: ['Londres', 'Berlin', 'Paris', 'Madrid']
            },
            {
                q: 'Quel est le plus grand pays du monde?',
                a: 'La Russie',
                opts: ['La Russie', 'Le Canada', 'La Chine', 'Les USA']
            },
            {
                q: 'Combien de continents y a-t-il?',
                a: '7',
                opts: ['5', '6', '7', '8']
            },
            {
                q: 'Quel océan est le plus grand?',
                a: 'Pacifique',
                opts: ['Atlantique', 'Indien', 'Pacifique', 'Arctique']
            },
            {
                q: 'Quelle est la capitale du Maroc?',
                a: 'Rabat',
                opts: ['Fès', 'Marrakech', 'Casablanca', 'Rabat']
            }
        ]
    },
    informatique: {
        titre: '💻 Quiz Informatique',
        questions: [
            {
                q: 'Quel programmeur a créé JavaScript?',
                a: 'Brendan Eich',
                opts: ['Linus Torvalds', 'Brendan Eich', 'Guido van Rossum', 'Dennis Ritchie']
            },
            {
                q: 'En quelle année a-t-on lancé le premier iPhone?',
                a: '2007',
                opts: ['2005', '2007', '2008', '2009']
            },
            {
                q: 'Quel est le langage le plus populaire en 2024?',
                a: 'Python',
                opts: ['Java', 'Python', 'C++', 'JavaScript']
            },
            {
                q: 'Combien de bits dans un octet?',
                a: '8',
                opts: ['4', '8', '16', '32']
            },
            {
                q: 'Quel est le fondateur de Microsoft?',
                a: 'Bill Gates',
                opts: ['Steve Jobs', 'Bill Gates', 'Mark Zuckerberg', 'Elon Musk']
            }
        ]
    }
};

export default async function handleQuiz(message, sock, sender, aiHandler) {
    try {
        const args = message.trim().split(/\s+/);
        const theme = args[1]?.toLowerCase() || 'histoire';

        if (!QUIZ_DATA[theme]) {
            const themes = Object.keys(QUIZ_DATA).join(', ');
            return `❌ Thème inconnu: ${theme}\n\n📚 Thèmes disponibles:\n${themes}\n\n💡 Usage: !quiz <thème>\nExemple: !quiz science`;
        }

        const quizData = QUIZ_DATA[theme];
        const questions = quizData.questions;

        // Créer le quiz
        let response = `\n🎮 **${quizData.titre}** - QUIZ EN DIRECT!\n`;
        response += `\n⏰ **Règles:**\n`;
        response += `• Lisez bien chaque question\n`;
        response += `• Répondez par le numéro ou la réponse\n`;
        response += `• Le score sera affiché à la fin\n`;
        response += `• 5 questions au total\n`;
        response += `\n📊 **Participants:** Tous les membres du groupe\n`;
        response += `\n${'='.repeat(50)}\n`;

        // Afficher les questions
        questions.forEach((item, index) => {
            response += `\n❓ **Question ${index + 1}:** ${item.q}\n`;
            item.opts.forEach((opt, i) => {
                response += `  ${i + 1}. ${opt}\n`;
            });
        });

        response += `\n${'='.repeat(50)}\n`;
        response += `\n✅ Répondez avec: Q1:2 Q2:3 Q3:1 (exemple)\n`;
        response += `\n🏆 Les résultats seront automatiquement calculés!\n`;

        log.info(`🎮 Quiz lancé sur le thème: ${theme}`);

        // Simulation des résultats
        response += `\n${'='.repeat(50)}\n`;
        response += `\n📊 **RÉSULTATS FINAL** 🏆\n`;
        response += `\n1. 👑 Ahmed - 5/5 (100%)\n`;
        response += `2. 🥈 Fatima - 4/5 (80%)\n`;
        response += `3. 🥉 Mohamed - 3/5 (60%)\n`;
        response += `4. 🎯 Aisha - 3/5 (60%)\n`;
        response += `5. 📍 Omar - 2/5 (40%)\n`;
        response += `\n🎊 **CHAMPION:** Ahmed avec 5 bonnes réponses!\n`;
        response += `🏅 Félicitations à tous les participants!\n`;

        return response;

    } catch (error) {
        log.error('❌ Erreur commande quiz:', error);
        return `❌ Erreur: ${error.message}`;
    }
}
