/*****************************************************************************
 *                                                                           *
 *                     Developed By Nostra                                   *
 *                                                                           *
 *  🌐  GitHub   : https://github.com/NOVA-X-Code                            *
 *  ▶️  YouTube  : https://youtube.com/@labokingfreesurf                     *
 *  💬  WhatsApp : https://whatsapp.com/channel/0029VagJIAr3bbVBCpEkAM07     *
 *                                                                           *
 *    © 2026 NOSTRA. All rights reserved.                                   *
 *                                                                           *
 *    Description: This file is part of the NOVA-MD Project.                 *
 *                 Unauthorized copying or distribution is prohibited.       *
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
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

import store from '../lib/lightweight_store.js';

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

function generateSessionId(length = 6, numLength = 4) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let randomPart = '';
    for (let i = 0; i < length; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const numPart = String(Math.floor(Math.random() * Math.pow(10, numLength))).padStart(numLength, '0');
    return `NOVA${randomPart}${numPart}`;
}

// ============================================================
// CLONE MANAGEMENT VIA LIGHTWEIGHT_STORE
// ============================================================

async function saveCloneToMainDB(authId, phoneNumber, dbUrl, dbType, status) {
    try {
        const data = {
            phoneNumber,
            dbUrl: dbUrl || 'local',
            dbType: dbType || 'local',
            status: status || 'configured',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        if (HAS_DB) {
            await store.saveSetting('clones', authId, data);
            console.log(`✅ [Clone ${authId}] Saved to main database`);
        } else {
            const clonesDir = path.join(process.cwd(), 'session', 'clones');
            if (!fs.existsSync(clonesDir)) {
                fs.mkdirSync(clonesDir, { recursive: true });
            }
            fs.writeFileSync(
                path.join(clonesDir, `${authId}.json`),
                JSON.stringify(data, null, 2)
            );
            console.log(`✅ [Clone ${authId}] Saved locally`);
        }
        return true;
    } catch (error) {
        console.error(`❌ Failed to save clone ${authId}:`, error.message);
        return false;
    }
}

async function getAllClonesFromMainDB() {
    try {
        if (HAS_DB) {
            // Récupérer tous les clones via lightweight_store
            const settings = await store.getSetting('clones', 'all') || {};
            return Object.entries(settings).map(([authId, data]) => ({
                authId,
                phoneNumber: data.phoneNumber,
                dbType: data.dbType || 'local',
                status: data.status || 'unknown',
                createdAt: data.createdAt,
                updatedAt: data.updatedAt
            }));
        } else {
            const clonesDir = path.join(process.cwd(), 'session', 'clones');
            if (!fs.existsSync(clonesDir)) return [];
            const files = fs.readdirSync(clonesDir).filter(f => f.endsWith('.json'));
            const clones = [];
            for (const file of files) {
                const authId = file.replace('.json', '');
                const data = JSON.parse(fs.readFileSync(path.join(clonesDir, file), 'utf-8'));
                clones.push({
                    authId,
                    phoneNumber: data.phoneNumber,
                    dbType: data.dbType || 'local',
                    status: data.status || 'unknown',
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt
                });
            }
            return clones;
        }
    } catch (error) {
        console.error('Failed to get all clones:', error.message);
        return [];
    }
}

async function deleteCloneFromMainDB(authId) {
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

async function testDatabaseConnection(dbUrl) {
    try {
        if (dbUrl.startsWith('mongodb')) {
            const mongoose = await import('mongoose');
            const conn = await mongoose.createConnection(dbUrl);
            await conn.db.admin().ping();
            await conn.close();
            return { success: true, type: 'mongodb' };
        }
        
        if (dbUrl.startsWith('postgresql')) {
            const pg = await import('pg');
            const { Pool } = pg;
            const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
            await pool.query('SELECT 1');
            await pool.end();
            return { success: true, type: 'postgresql' };
        }
        
        if (dbUrl.startsWith('mysql')) {
            const mysql = await import('mysql2/promise');
            const conn = await mysql.createConnection(dbUrl);
            await conn.execute('SELECT 1');
            await conn.end();
            return { success: true, type: 'mysql' };
        }
        
        return { success: false, error: 'Unsupported database type' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function deleteClone(authId) {
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
// MAIN COMMAND
// ============================================================

export default {
    command: 'rentbot',
    aliases: ['botclone', 'clonebot'],
    category: 'owner',
    description: 'Create, list, or delete bot clones',
    usage: '.rentbot [create|list|delete] [params]',
    ownerOnly: true,
    async handler(sock, message, args, context) {
        const { chatId } = context;
        const subCommand = args[0]?.toLowerCase();

        // ============================================================
        // LIST CLONES
        // ============================================================
        if (subCommand === 'list' || subCommand === 'ls' || subCommand === 'status') {
            const clones = await getAllClonesFromMainDB();
            
            if (clones.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: `*📋 CLONE LIST*\n\n` +
                          `No clones found.\n\n` +
                          `💡 *Create a clone:* \`.rentbot create 23765976XXXX\``
                }, { quoted: message });
            }

            let text = `*📋 CLONE LIST* (${clones.length})\n\n`;
            
            const online = clones.filter(c => c.status === 'online');
            const configured = clones.filter(c => c.status === 'configured' || c.status === 'active');
            const offline = clones.filter(c => c.status === 'offline' || !c.status);
            
            if (online.length > 0) {
                text += `🟢 *ONLINE* (${online.length})\n`;
                for (const clone of online) {
                    const dbDisplay = clone.dbType === 'local' ? '📁 Local' : `💾 ${clone.dbType.toUpperCase()}`;
                    text += `├─ 📱 \`${clone.phoneNumber}\`\n`;
                    text += `│  ${dbDisplay}\n`;
                    text += `│  📅 ${new Date(clone.updatedAt || clone.createdAt).toLocaleString()}\n`;
                    text += `│  ──────────────────\n`;
                }
                text += `\n`;
            }
            
            if (configured.length > 0) {
                text += `🟡 *CONFIGURED* (${configured.length})\n`;
                for (const clone of configured) {
                    const dbDisplay = clone.dbType === 'local' ? '📁 Local' : `💾 ${clone.dbType.toUpperCase()}`;
                    text += `├─ 📱 \`${clone.phoneNumber}\`\n`;
                    text += `│  ${dbDisplay}\n`;
                    text += `│  📅 ${new Date(clone.updatedAt || clone.createdAt).toLocaleString()}\n`;
                    text += `│  ──────────────────\n`;
                }
                text += `\n`;
            }
            
            if (offline.length > 0) {
                text += `🔴 *OFFLINE* (${offline.length})\n`;
                for (const clone of offline) {
                    const dbDisplay = clone.dbType === 'local' ? '📁 Local' : `💾 ${clone.dbType.toUpperCase()}`;
                    text += `├─ 📱 \`${clone.phoneNumber}\`\n`;
                    text += `│  ${dbDisplay}\n`;
                    text += `│  📅 ${new Date(clone.updatedAt || clone.createdAt).toLocaleString()}\n`;
                    text += `│  ──────────────────\n`;
                }
                text += `\n`;
            }

            text += `📌 *Commands:*\n`;
            text += `• \`.rentbot create <phone> <db_url?>\` - Create clone\n`;
            text += `• \`.rentbot delete <phone>\` - Delete clone\n`;
            text += `• \`.rentbot list\` - Show this list\n\n`;
            text += `💾 *Storage: local DB*`;

            return await sock.sendMessage(chatId, { text }, { quoted: message });
        }

        // ============================================================
        // DELETE CLONE
        // ============================================================
        if (subCommand === 'delete' || subCommand === 'del' || subCommand === 'remove' || subCommand === 'rm') {
            const phoneNumber = args[1]?.replace(/[^0-9]/g, '');
            
            if (!phoneNumber) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Please specify the phone number!*\n\n` +
                          `📌 *Usage:* \`.rentbot delete 23765976XXXX\``
                }, { quoted: message });
            }

            const clones = await getAllClonesFromMainDB();
            const targetClones = clones.filter(c => c.phoneNumber === phoneNumber);
            
            if (targetClones.length === 0) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Clone not found for* \`${phoneNumber}\``
                }, { quoted: message });
            }

            const cloneToDelete = targetClones[0];
            
            await sock.sendMessage(chatId, {
                text: `⚠️ *Confirm deletion*\n\n` +
                      `📱 Phone: \`${cloneToDelete.phoneNumber}\`\n` +
                      `💾 Storage: ${cloneToDelete.dbType === 'local' ? '📁 Local' : `💾 ${cloneToDelete.dbType.toUpperCase()}`}\n` +
                      `📅 Created: ${new Date(cloneToDelete.createdAt).toLocaleString()}\n\n` +
                      `❓ *Are you sure?* Reply with:\n` +
                      `• \`.rentbot confirm ${cloneToDelete.phoneNumber}\` - Yes\n` +
                      `• \`.rentbot list\` - Cancel`
            }, { quoted: message });
            
            global.pendingDelete = { phoneNumber: cloneToDelete.phoneNumber, authId: cloneToDelete.authId, chatId };
            return;
        }

        // ============================================================
        // CONFIRM DELETE
        // ============================================================
        if (subCommand === 'confirm' || subCommand === 'yes') {
            const phoneNumber = args[1]?.replace(/[^0-9]/g, '');
            
            if (!phoneNumber || !global.pendingDelete || global.pendingDelete.phoneNumber !== phoneNumber) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *No pending deletion found.*`
                }, { quoted: message });
            }

            const result = await deleteClone(global.pendingDelete.authId);
            
            if (result.success) {
                await sock.sendMessage(chatId, {
                    text: `✅ *Clone deleted!*\n\n📱 Phone: \`${phoneNumber}\``
                }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, {
                    text: `❌ *Error:* ${result.error}`
                }, { quoted: message });
            }
            
            delete global.pendingDelete;
            return;
        }

        // ============================================================
        // CREATE CLONE
        // ============================================================
        if (subCommand === 'create' || subCommand === 'new' || subCommand === 'add') {
            const userNumber = args[1]?.replace(/[^0-9]/g, '');
            const dbUrl = args.slice(2).join(' ');
            
            if (!userNumber) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Phone number required!*\n\n` +
                          `📌 *Usage:*\n` +
                          `• Local: \`.rentbot create 23765976XXXX\`\n` +
                          `• MongoDB: \`.rentbot create 23765976XXXX mongodb://...\``
                }, { quoted: message });
            }

            let dbType = 'local';
            let displayDbInfo = '📁 Local storage';

            if (dbUrl) {
                await sock.sendMessage(chatId, {
                    text: `🔄 *Testing database...*\n\n📱 ${userNumber}`
                }, { quoted: message });

                const testResult = await testDatabaseConnection(dbUrl);
                if (!testResult.success) {
                    return await sock.sendMessage(chatId, {
                        text: `❌ *DB connection failed!*\n\n${testResult.error}\n\n` +
                              `📌 Try local: \`.rentbot create ${userNumber}\``
                    }, { quoted: message });
                }
                dbType = testResult.type;
                displayDbInfo = `💾 ${dbType.toUpperCase()}`;
            }

            const authId = generateSessionId();
            const sessionPath = path.join(process.cwd(), 'session', 'clones', authId);
            
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
            }

            await saveCloneToMainDB(authId, userNumber, dbUrl || 'local', dbType, 'configured');

            await sock.sendMessage(chatId, {
                text: `✅ *Clone configured!*\n\n📱 ${userNumber}\n💾 ${displayDbInfo}\n\n🔄 Getting pairing code...`
            }, { quoted: message });

            async function startClone() {
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

                if (!conn.authState.creds.registered) {
                    await new Promise(resolve => setTimeout(resolve, 6000));
                    try {
                        let code = await conn.requestPairingCode(userNumber);
                        code = code?.match(/.{1,4}/g)?.join("-") || code;

                        const pairingText = `🔐 *PAIRING CODE*\n\n` +
                            `📱 Number: \`${userNumber}\`\n` +
                            `🔑 Code: *${code}*\n` +
                            `💾 Storage: ${dbType === 'local' ? '📁 Local' : `💾 ${dbType.toUpperCase()}`}\n\n` +
                            `📌 *Instructions:*\n` +
                            `1. Open WhatsApp Settings\n` +
                            `2. Linked Devices > Link with Phone Number\n` +
                            `3. Enter the code above`;

                        await sock.sendMessage(chatId, { text: pairingText }, { quoted: message });
                    } catch (err) {
                        console.error("Pairing Error:", err);
                        await sock.sendMessage(chatId, { text: "❌ Failed to request code." });
                    }
                }

                conn.ev.on('creds.update', async () => {
                    await saveCreds();
                    await saveCloneToMainDB(authId, userNumber, dbUrl || 'local', dbType, 'active');
                });

                conn.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect } = update;
                    
                    if (connection === 'open') {
                        global.conns.push(conn);
                        await saveCloneToMainDB(authId, userNumber, dbUrl || 'local', dbType, 'online');
                        
                        await sock.sendMessage(chatId, {
                            text: `✅ *Clone connected!*\n\n📱 \`${userNumber}\`\n💾 ${dbType === 'local' ? '📁 Local' : `💾 ${dbType.toUpperCase()}`}`
                        }, { quoted: message });
                    }

                    if (connection === 'close') {
                        const code = lastDisconnect?.error?.output?.statusCode;
                        if (code !== DisconnectReason.loggedOut) {
                            setTimeout(startClone, 5000);
                        } else {
                            await saveCloneToMainDB(authId, userNumber, dbUrl || 'local', dbType, 'offline');
                            const index = global.conns.indexOf(conn);
                            if (index > -1) global.conns.splice(index, 1);
                        }
                    }
                });

                try {
                    const { handleMessages } = await import('../lib/messageHandler.js');
                    conn.ev.on('messages.upsert', async (chatUpdate) => {
                        await handleMessages(conn, chatUpdate);
                    });
                } catch (e) {
                    console.error("Handler linkage failed:", e.message);
                }

                return conn;
            }

            await startClone();
            return;
        }

        // ============================================================
        // HELP
        // ============================================================
        return await sock.sendMessage(chatId, {
            text: `*🤖 CLONE BOT SYSTEM*\n\n` +
                  `📌 *Commands:*\n\n` +
                  `🟢 *CREATE:*\n` +
                  `\`.rentbot create 23765976XXXX\` (local)\n` +
                  `\`.rentbot create 23765976XXXX mongodb://...\`\n\n` +
                  `📋 *LIST:*\n` +
                  `\`.rentbot list\`\n\n` +
                  `🗑️ *DELETE:*\n` +
                  `\`.rentbot delete 23765976XXXX\``
        }, { quoted: message });
    }
};