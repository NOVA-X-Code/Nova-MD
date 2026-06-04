import pkg from 'pg';
const { Pool } = pkg;
import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

class DatabaseManager {
    constructor(connectionString) {
        this.pool = new Pool({
            connectionString: connectionString || process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        this.pool.on('error', (err) => {
            log.error('Erreur pool PostgreSQL:', err);
        });
    }

    async initialize() {
        try {
            const client = await this.pool.connect();
            log.info('✅ Connexion PostgreSQL établie');

            // Créer les tables si elles n'existent pas
            await client.query(`
                CREATE TABLE IF NOT EXISTS deleted_messages (
                    id SERIAL PRIMARY KEY,
                    message_id TEXT UNIQUE NOT NULL,
                    sender_number TEXT NOT NULL,
                    message_content TEXT,
                    media_type VARCHAR(50),
                    timestamp BIGINT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Créer les index
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_sender 
                ON deleted_messages (sender_number);
            `);

            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_timestamp 
                ON deleted_messages (timestamp);
            `);

            log.info('✅ Tables PostgreSQL créées/vérifiées');
            client.release();
        } catch (error) {
            log.error('❌ Erreur initialisation base de données:', error);
            throw error;
        }
    }

    /**
     * Enregistrer un message supprimé
     */
    async saveDeletedMessage(messageId, senderNumber, content, mediaType = null, timestamp) {
        try {
            await this.pool.query(
                `INSERT INTO deleted_messages (message_id, sender_number, message_content, media_type, timestamp)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (message_id) DO NOTHING;`,
                [messageId, senderNumber, content, mediaType, timestamp]
            );
            log.info(`📝 Message supprimé enregistré: ${messageId}`);
        } catch (error) {
            log.error('❌ Erreur sauvegarde message supprimé:', error);
        }
    }

    /**
     * Récupérer tous les messages supprimés
     */
    async getDeletedMessages() {
        try {
            const result = await this.pool.query(
                `SELECT * FROM deleted_messages ORDER BY timestamp DESC;`
            );
            return result.rows;
        } catch (error) {
            log.error('❌ Erreur récupération messages supprimés:', error);
            return [];
        }
    }

    /**
     * Supprimer tous les messages supprimés (après les avoir envoyés au propriétaire)
     */
    async clearDeletedMessages() {
        try {
            const result = await this.pool.query(
                `DELETE FROM deleted_messages;`
            );
            log.info(`✅ ${result.rowCount} messages supprimés de la base de données`);
            return result.rowCount;
        } catch (error) {
            log.error('❌ Erreur suppression messages:', error);
            return 0;
        }
    }

    /**
     * Fermer la connexion
     */
    async close() {
        try {
            await this.pool.end();
            log.info('✅ Connexion PostgreSQL fermée');
        } catch (error) {
            log.error('❌ Erreur fermeture connexion:', error);
        }
    }
}

export default DatabaseManager;
