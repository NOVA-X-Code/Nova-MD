import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const SESSION_DIR = path.join(process.cwd(), 'session');
const CREDS_FILE = path.join(SESSION_DIR, 'creds.json');

// Vérifier les URLs de base de données
const MONGO_URL = process.env.MONGO_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const MYSQL_URL = process.env.MYSQL_URL;
const DB_TYPE = MONGO_URL ? 'mongodb' : POSTGRES_URL ? 'postgresql' : MYSQL_URL ? 'mysql' : 'local';

class SessionManager {
    constructor() {
        this.db = null;
        this.dbType = DB_TYPE;
        this.initialized = false;
        this.sessionCache = null;
    }

    async init() {
        if (this.initialized) return;
        
        try {
            if (this.dbType === 'mongodb' && MONGO_URL) {
                await this.initMongoDB();
            } else if (this.dbType === 'postgresql' && POSTGRES_URL) {
                await this.initPostgreSQL();
            } else if (this.dbType === 'mysql' && MYSQL_URL) {
                await this.initMySQL();
            } else {
                console.log('💾 Using local file storage for sessions');
            }
            this.initialized = true;
        } catch (error) {
            console.error('❌ Session DB initialization failed:', error.message);
            console.log('💾 Falling back to local file storage');
            this.dbType = 'local';
            this.initialized = true;
        }
    }

    // === MONGODB ===
    async initMongoDB() {
        try {
            const mongoose = require('mongoose');
            await mongoose.connect(MONGO_URL);
            
            const sessionSchema = new mongoose.Schema({
                sessionId: { type: String, unique: true, required: true },
                creds: { type: Object, required: true },
                registered: { type: Boolean, default: false },
                phoneNumber: { type: String },
                deviceId: { type: String },
                createdAt: { type: Date, default: Date.now },
                updatedAt: { type: Date, default: Date.now }
            });
            
            this.SessionModel = mongoose.model('Session', sessionSchema);
            this.db = this.SessionModel;
            console.log('✅ MongoDB session storage initialized');
        } catch (error) {
            throw new Error(`MongoDB init failed: ${error.message}`);
        }
    }

    // === POSTGRESQL ===
    async initPostgreSQL() {
        try {
            const pg = require('pg');
            const { Pool } = pg;
            
            this.pool = new Pool({
                connectionString: POSTGRES_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    creds JSONB NOT NULL,
                    registered BOOLEAN DEFAULT FALSE,
                    phone_number TEXT,
                    device_id TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)
            `);

            console.log('✅ PostgreSQL session storage initialized');
        } catch (error) {
            throw new Error(`PostgreSQL init failed: ${error.message}`);
        }
    }

    // === MYSQL ===
    async initMySQL() {
        try {
            const mysql = require('mysql2/promise');
            
            this.mysqlConn = await mysql.createConnection(MYSQL_URL);

            await this.mysqlConn.execute(`
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id VARCHAR(255) PRIMARY KEY,
                    creds JSON NOT NULL,
                    registered BOOLEAN DEFAULT FALSE,
                    phone_number VARCHAR(50),
                    device_id VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_session_id (session_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            console.log('✅ MySQL session storage initialized');
        } catch (error) {
            throw new Error(`MySQL init failed: ${error.message}`);
        }
    }

    // === SAUVEGARDE DE SESSION ===
    async saveSession(creds, phoneNumber = null) {
        await this.init();

        const sessionId = this.generateSessionId();
        const registered = creds.registered === true || !!creds.me?.id;

        // 1. TOUJOURS sauvegarder localement en premier
        this.saveLocal(creds);

        // 2. Sauvegarder en base de données
        try {
            if (this.dbType === 'mongodb' && this.db) {
                await this.db.updateOne(
                    { sessionId },
                    {
                        sessionId,
                        creds,
                        registered,
                        phoneNumber,
                        deviceId: creds.deviceId || null,
                        updatedAt: new Date()
                    },
                    { upsert: true }
                );
                console.log(`✅ Session saved to MongoDB: ${sessionId}`);
            } else if (this.dbType === 'postgresql' && this.pool) {
                await this.pool.query(
                    `INSERT INTO sessions (session_id, creds, registered, phone_number, device_id, updated_at)
                     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                     ON CONFLICT (session_id) DO UPDATE SET 
                         creds = EXCLUDED.creds,
                         registered = EXCLUDED.registered,
                         phone_number = EXCLUDED.phone_number,
                         device_id = EXCLUDED.device_id,
                         updated_at = CURRENT_TIMESTAMP`,
                    [sessionId, creds, registered, phoneNumber, creds.deviceId || null]
                );
                console.log(`✅ Session saved to PostgreSQL: ${sessionId}`);
            } else if (this.dbType === 'mysql' && this.mysqlConn) {
                await this.mysqlConn.execute(
                    `INSERT INTO sessions (session_id, creds, registered, phone_number, device_id, updated_at)
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                     ON DUPLICATE KEY UPDATE 
                         creds = VALUES(creds),
                         registered = VALUES(registered),
                         phone_number = VALUES(phone_number),
                         device_id = VALUES(device_id),
                         updated_at = CURRENT_TIMESTAMP`,
                    [sessionId, JSON.stringify(creds), registered, phoneNumber, creds.deviceId || null]
                );
                console.log(`✅ Session saved to MySQL: ${sessionId}`);
            }
        } catch (error) {
            console.error('❌ DB session save failed:', error.message);
        }

        return sessionId;
    }

    // === CHARGEMENT DE SESSION ===
    async loadSession() {
        await this.init();

        try {
            if (this.dbType === 'mongodb' && this.db) {
                const result = await this.db.findOne({ registered: true }).sort({ updatedAt: -1 });
                if (result) {
                    console.log(`✅ Session loaded from MongoDB: ${result.sessionId}`);
                    this.saveLocal(result.creds);
                    return result.creds;
                }
            } else if (this.dbType === 'postgresql' && this.pool) {
                const result = await this.pool.query(
                    `SELECT session_id, creds FROM sessions WHERE registered = true ORDER BY updated_at DESC LIMIT 1`
                );
                if (result.rows.length > 0) {
                    console.log(`✅ Session loaded from PostgreSQL: ${result.rows[0].session_id}`);
                    this.saveLocal(result.rows[0].creds);
                    return result.rows[0].creds;
                }
            } else if (this.dbType === 'mysql' && this.mysqlConn) {
                const [rows] = await this.mysqlConn.execute(
                    `SELECT session_id, creds FROM sessions WHERE registered = true ORDER BY updated_at DESC LIMIT 1`
                );
                if (rows.length > 0) {
                    console.log(`✅ Session loaded from MySQL: ${rows[0].session_id}`);
                    this.saveLocal(rows[0].creds);
                    return rows[0].creds;
                }
            }
        } catch (error) {
            console.error('❌ DB session load failed:', error.message);
        }

        const localCreds = this.loadLocal();
        if (localCreds) {
            console.log('📂 Session loaded from local file');
            return localCreds;
        }

        console.log('⚠️ No session found');
        return null;
    }

    // === SAUVEGARDE LOCALE ===
    saveLocal(creds) {
        try {
            if (!fs.existsSync(SESSION_DIR)) {
                fs.mkdirSync(SESSION_DIR, { recursive: true });
            }
            fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
            return true;
        } catch (error) {
            console.error('❌ Local save failed:', error.message);
            return false;
        }
    }

    loadLocal() {
        try {
            if (fs.existsSync(CREDS_FILE)) {
                return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8'));
            }
            return null;
        } catch (error) {
            console.error('❌ Local load failed:', error.message);
            return null;
        }
    }

    // === UTILITAIRES ===
    generateSessionId() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const randomPart = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const numPart = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        return `NOVA${randomPart}${numPart}`;
    }

    hasValidSession() {
        try {
            const creds = this.loadLocal();
            if (!creds) return false;
            
            if (!creds.noiseKey || !creds.signedIdentityKey || !creds.signedPreKey) {
                return false;
            }
            
            // ✅ Vérifier registered OU me.id
            if (creds.registered !== true && !creds.me?.id) {
                return false;
            }
            
            return true;
        } catch (error) {
            return false;
        }
    }

    async deleteSession() {
        try {
            if (this.dbType === 'mongodb' && this.db) {
                await this.db.deleteMany({});
                console.log('🗑️ MongoDB session deleted');
            } else if (this.dbType === 'postgresql' && this.pool) {
                await this.pool.query('DELETE FROM sessions');
                console.log('🗑️ PostgreSQL session deleted');
            } else if (this.dbType === 'mysql' && this.mysqlConn) {
                await this.mysqlConn.execute('DELETE FROM sessions');
                console.log('🗑️ MySQL session deleted');
            }
        } catch (error) {
            console.error('❌ DB delete failed:', error.message);
        }

        try {
            if (fs.existsSync(CREDS_FILE)) {
                fs.unlinkSync(CREDS_FILE);
                console.log('🗑️ Local session deleted');
            }
        } catch (error) {
            console.error('❌ Local delete failed:', error.message);
        }
    }

    async close() {
        try {
            if (this.dbType === 'mongodb') {
                const mongoose = require('mongoose');
                await mongoose.connection.close();
            } else if (this.dbType === 'postgresql' && this.pool) {
                await this.pool.end();
            } else if (this.dbType === 'mysql' && this.mysqlConn) {
                await this.mysqlConn.end();
            }
            console.log('🔒 Session database closed');
        } catch (error) {
            console.error('❌ Close failed:', error.message);
        }
    }
}

export default new SessionManager();