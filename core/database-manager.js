import pkg from 'pg';
const { Pool } = pkg;
import { createLogger } from '../utils/logger.js';

const log = createLogger(import.meta.url);

class DatabaseManager {
    constructor(connectionString) {
        this.connectionString = connectionString || process.env.DATABASE_URL;
        this.pool = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Si déjà initialisée, skip
            if (this.isInitialized && this.pool) {
                log.info('ℹ️  Base données déjà initialisée');
                return;
            }

            // Créer la pool
            this.pool = new Pool({
                connectionString: this.connectionString,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            this.pool.on('error', (err) => {
                log.error('Erreur pool PostgreSQL:', err);
            });

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
            this.isInitialized = true;
        } catch (error) {
            log.error('❌ Erreur initialisation base de données:', error.message);
            this.isInitialized = false;
            // Don't throw - just log and continue
        }
    }

    /**
     * Enregistrer un message supprimé
     */
    async saveDeletedMessage(messageId, senderNumber, content, mediaType = null, timestamp) {
        if (!this.isInitialized || !this.pool) {
            log.warn('⚠️  Base de données non disponible - message non sauvegardé');
            return;
        }
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
        if (!this.isInitialized || !this.pool) {
            log.warn('⚠️  Base de données non disponible');
            return [];
        }
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
        if (!this.isInitialized || !this.pool) {
            log.warn('⚠️  Base de données non disponible');
            return 0;
        }
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
