import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger(import.meta.url);

class AuthManager {
    constructor(sessionDir = 'auth_info') {
        this.sessionDir = sessionDir;
        this.sessionPath = path.resolve(sessionDir);
    }

    /**
     * Initialiser le répertoire de session
     */
    async initializeSessionDir() {
        try {
            await fs.mkdir(this.sessionPath, { recursive: true });
            log.info(`📁 Répertoire session créé/vérifié: ${this.sessionPath}`);
        } catch (error) {
            log.error('❌ Erreur initialisation répertoire session:', error);
            throw error;
        }
    }

    /**
     * Sauvegarder les données d'authentification
     */
    async saveAuthState(authState) {
        try {
            const filePath = path.join(this.sessionPath, 'creds.json');
            await fs.writeFile(filePath, JSON.stringify(authState, null, 2));
            log.info('✅ Données d\'authentification sauvegardées');
        } catch (error) {
            log.error('❌ Erreur sauvegarde authentification:', error);
            throw error;
        }
    }

    /**
     * Charger les données d'authentification
     */
    async loadAuthState() {
        try {
            const filePath = path.join(this.sessionPath, 'creds.json');
            const data = await fs.readFile(filePath, 'utf-8');
            log.info('✅ Données d\'authentification chargées');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                log.info('ℹ️  Pas de session existante - nouvelle connexion requise');
                return null;
            }
            log.error('❌ Erreur chargement authentification:', error);
            throw error;
        }
    }

    /**
     * Nettoyer/supprimer les données d'authentification
     */
    async clearAuthState() {
        try {
            const filePath = path.join(this.sessionPath, 'creds.json');
            await fs.unlink(filePath);
            log.info('✅ Données d\'authentification supprimées');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                log.error('❌ Erreur suppression authentification:', error);
            }
        }
    }

    /**
     * Vérifier si une session existe
     */
    async sessionExists() {
        try {
            const filePath = path.join(this.sessionPath, 'creds.json');
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}

export default AuthManager;
