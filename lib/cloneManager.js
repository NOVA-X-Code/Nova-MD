/*****************************************************************************
 *                                                                           *
 *                     Developed By Nostra                                   *
 *                                                                           *
 *  🌐  GitHub   : https://github.com/NOVA-X-Code                            *
 *  ▶️  YouTube  : https://youtube.com/@labokingfreesurf                     *
 *  💬  WhatsApp : https://whatsapp.com/channel/0029VagJIAr3bbVBCpEkAM07     *
 *                                                                           *
 *    Description: Clone Manager - Core logic for clone management           *
 *                                                                           *
 *****************************************************************************/

import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    Browsers 
} from '@whiskeysockets/baileys';
import NodeCache from 'node-cache';
import pino from 'pino';
import fs from 'fs';
import path,{ dirname }  from 'path';
import { fileURLToPath } from 'url';

import store from './lightweight_store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!global.conns) global.conns = [];

const MONGO_URL = process.env.MONGO_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const MYSQL_URL = process.env.MYSQL_URL;
const HAS_DB = !!(MONGO_URL || POSTGRES_URL || MYSQL_URL);

// ============================================================
// SESSION ID GENERATOR
// ============================================================

export function generateSessionId(length = 6, numLength = 4) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let randomPart = '';
    for (let i = 0; i < length; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const numPart = String(Math.floor(Math.random() * Math.pow(10, numLength))).padStart(numLength, '0');
    return `NOVA${randomPart}${numPart}`;
}

// ============================================================
// CLONE STORAGE WITH EXPIRY
// ============================================================

export async function saveCloneToMainDB(authId, phoneNumber, dbUrl, dbType, status, expiryDays = null) {
    try {
        let expiresAt = null;
        if (expiryDays && expiryDays > 0) {
            expiresAt = Date.now() + (expiryDays * 24 * 60 * 60 * 1000);
        }
        
        const data = {
            phoneNumber,
            dbUrl: dbUrl || 'local',
            dbType: dbType || 'local',
            status: status || 'configured',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            expiryDays: expiryDays || null,
            expiresAt: expiresAt,
            expired: false
        };
        
        if (HAS_DB) {
            await store.saveSetting('clones', authId, data);
            console.log(`✅ [Clone ${authId}] Saved to main database${expiryDays ? ` (expires in ${expiryDays} days)` : ''}`);
        } else {
            const clonesDir = path.join(process.cwd(), 'session', 'clones');
            if (!fs.existsSync(clonesDir)) {
                fs.mkdirSync(clonesDir, { recursive: true });
            }
            fs.writeFileSync(
                path.join(clonesDir, `${authId}.json`),
                JSON.stringify(data, null, 2)
            );
            console.log(`✅ [Clone ${authId}] Saved locally${expiryDays ? ` (expires in ${expiryDays} days)` : ''}`);
        }
        return true;
    } catch (error) {
        console.error(`❌ Failed to save clone ${authId}:`, error.message);
        return false;
    }
}

export async function getAllClonesFromMainDB() {
    try {
        let clones = [];
        
        if (HAS_DB) {
            const settings = await store.getSetting('clones', 'all') || {};
            clones = Object.entries(settings).map(([authId, data]) => ({
                authId,
                phoneNumber: data.phoneNumber,
                dbType: data.dbType || 'local',
                status: data.status || 'unknown',
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
                expiryDays: data.expiryDays || null,
                expiresAt: data.expiresAt || null,
                expired: data.expired || false
            }));
        } else {
            const clonesDir = path.join(process.cwd(), 'session', 'clones');
            if (!fs.existsSync(clonesDir)) return [];
            const files = fs.readdirSync(clonesDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const authId = file.replace('.json', '');
                const data = JSON.parse(fs.readFileSync(path.join(clonesDir, file), 'utf-8'));
                clones.push({
                    authId,
                    phoneNumber: data.phoneNumber,
                    dbType: data.dbType || 'local',
                    status: data.status || 'unknown',
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                    expiryDays: data.expiryDays || null,
                    expiresAt: data.expiresAt || null,
                    expired: data.expired || false
                });
            }
        }
        
        // Vérifier et marquer les clones expirés
        const now = Date.now();
        for (const clone of clones) {
            if (clone.expiresAt && clone.expiresAt < now && !clone.expired) {
                clone.expired = true;
                clone.status = 'expired';
                await updateCloneStatus(clone.authId, 'expired', true);
            }
        }
        
        return clones;
    } catch (error) {
        console.error('Failed to get all clones:', error.message);
        return [];
    }
}

async function updateCloneStatus(authId, status, expired = false) {
    try {
        let cloneData = null;
        
        if (HAS_DB) {
            cloneData = await store.getSetting('clones', authId);
        } else {
            const clonesDir = path.join(process.cwd(), 'session', 'clones');
            const filePath = path.join(clonesDir, `${authId}.json`);
            if (fs.existsSync(filePath)) {
                cloneData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
        }
        
        if (cloneData) {
            cloneData.status = status;
            cloneData.expired = expired;
            cloneData.updatedAt = Date.now();
            
            if (HAS_DB) {
                await store.saveSetting('clones', authId, cloneData);
            } else {
                const clonesDir = path.join(process.cwd(), 'session', 'clones');
                const filePath = path.join(clonesDir, `${authId}.json`);
                fs.writeFileSync(filePath, JSON.stringify(cloneData, null, 2));
            }
        }
    } catch (error) {
        console.error(`Failed to update clone status ${authId}:`, error.message);
    }
}

export async function getCloneByPhoneNumber(phoneNumber) {
    const clones = await getAllClonesFromMainDB();
    return clones.filter(c => c.phoneNumber === phoneNumber);
}

export async function deleteCloneFromMainDB(authId) {
    try {
        if (HAS_DB) {
            await store.saveSetting('clones', authId, null);
        } else {
            const clonesDir = path.join(process.cwd(), 'session', 'clones');
            const filePath = path.join(clonesDir, `${authId}.json`);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        console.log(`✅ [Clone ${authId}] Removed from main database`);
        return true;
    } catch (error) {
        console.error(`Failed to delete clone ${authId}:`, error.message);
        return false;
    }
}

// ============================================================
// CLONE PAIRING LOGIC
// ============================================================

export async function startClone(sessionPath, userNumber, authId, dbType, dbUrl, expiryDays, onConnected, onDisconnected) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        const msgRetryCounterCache = new NodeCache();
        
        const conn = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: Browsers.macOS("Chrome"),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            msgRetryCounterCache,
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 30000,
            mobile: false
        });

        let pairingCode = null;

        if (!conn.authState.creds.registered) {
            await new Promise(resolve => setTimeout(resolve, 6000));
            try {
                let code = await conn.requestPairingCode(userNumber);
                pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
                
                await saveCloneToMainDB(authId, userNumber, dbUrl || 'local', dbType, 'pairing', expiryDays);
            } catch (err) {
                console.error("Pairing Error:", err);
                throw new Error(`Failed to get pairing code: ${err.message}`);
            }
        }

        conn.ev.on('creds.update', async () => {
            await saveCreds();
            try {
                const credsData = JSON.parse(fs.readFileSync(path.join(sessionPath, 'creds.json'), 'utf-8'));
                await saveCloneToMainDB(authId, userNumber, dbUrl || 'local', dbType, 'active', expiryDays);
            } catch (e) {
                console.error("Creds save error:", e.message);
            }
        });

        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                global.conns.push(conn);
                await saveCloneToMainDB(authId, userNumber, dbUrl || 'local', dbType, 'online', expiryDays);
                
                if (onConnected) {
                    await onConnected(conn, authId, userNumber);
                }
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                if (code !== DisconnectReason.loggedOut) {
                    console.log(`🔄 [Clone ${authId}] Reconnecting...`);
                    setTimeout(() => startClone(sessionPath, userNumber, authId, dbType, dbUrl, expiryDays, onConnected, onDisconnected), 5000);
                } else {
                    await saveCloneToMainDB(authId, userNumber, dbUrl || 'local', dbType, 'offline', expiryDays);
                    const index = global.conns.indexOf(conn);
                    if (index > -1) global.conns.splice(index, 1);
                    
                    if (onDisconnected) {
                        await onDisconnected(conn, authId, userNumber);
                    }
                }
            }
        });

        try {
            const { handleMessages } = await import('./messageHandler.js');
            conn.ev.on('messages.upsert', async (chatUpdate) => {
                await handleMessages(conn, chatUpdate);
            });
        } catch (e) {
            console.error("Handler linkage failed:", e.message);
        }

        return { conn, pairingCode };
    } catch (error) {
        console.error(`Failed to start clone ${authId}:`, error.message);
        throw error;
    }
}

// ============================================================
// DELETE CLONE
// ============================================================

export async function deleteClone(authId) {
    try {
        const connIndex = global.conns.findIndex(c => {
            try {
                return c.authState?.creds?.me?.id?.includes(authId) || 
                       c.user?.id?.includes(authId);
            } catch (e) {
                return false;
            }
        });
        
        if (connIndex > -1) {
            try {
                await global.conns[connIndex].end();
                global.conns.splice(connIndex, 1);
                console.log(`✅ [Clone ${authId}] Disconnected`);
            } catch (e) {
                console.error(`Failed to disconnect clone ${authId}:`, e.message);
            }
        }

        await deleteCloneFromMainDB(authId);

        const sessionPath = path.join(process.cwd(), 'session', 'clones', authId);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        return { success: true };
    } catch (error) {
        console.error(`Failed to delete clone ${authId}:`, error.message);
        return { success: false, error: error.message };
    }
}

// ============================================================
// CHECK EXPIRED CLONES
// ============================================================

export async function checkAndCleanExpiredClones() {
    try {
        const clones = await getAllClonesFromMainDB();
        const now = Date.now();
        let cleaned = 0;
        
        for (const clone of clones) {
            if (clone.expiresAt && clone.expiresAt < now && !clone.expired) {
                console.log(`🧹 Cleaning expired clone: ${clone.authId} (${clone.phoneNumber})`);
                await deleteClone(clone.authId);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`✅ Cleaned ${cleaned} expired clones`);
        }
        
        return cleaned;
    } catch (error) {
        console.error('Failed to check expired clones:', error.message);
        return 0;
    }
}

// ============================================================
// CHECK CLONE OWNER
// ============================================================

export async function isCloneOwner(senderId, authId) {
    try {
        const clones = await getAllClonesFromMainDB();
        const clone = clones.find(c => c.authId === authId);
        if (!clone) return false;
        
        const senderNumber = senderId.split('@')[0];
        return clone.phoneNumber === senderNumber;
    } catch (error) {
        console.error('Check clone owner error:', error.message);
        return false;
    }
}