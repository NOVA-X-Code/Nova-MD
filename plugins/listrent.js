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

import store from '../lib/lightweight_store.js';
import fs from 'fs';
import path from 'path';

const MONGO_URL = process.env.MONGO_URL;
const POSTGRES_URL = process.env.POSTGRES_URL;
const MYSQL_URL = process.env.MYSQL_URL;
const SQLITE_URL = process.env.DB_URL;
const HAS_DB = !!(MONGO_URL || POSTGRES_URL || MYSQL_URL || SQLITE_URL);

async function getAllCloneSessions() {
    if (HAS_DB) {
        const settings = await store.getSetting('clones', 'all') || {};
        return Object.entries(settings)
            .filter(([_key, value]) => value && value.status)
            .map(([authId, data]) => ({ authId, ...data }));
    } else {
        const clonesDir = path.join(process.cwd(), 'session', 'clones');
        if (!fs.existsSync(clonesDir)) return [];
        const dirs = fs.readdirSync(clonesDir);
        const clones = [];
        for (const authId of dirs) {
            const sessionPath = path.join(clonesDir, authId, 'session.json');
            if (fs.existsSync(sessionPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
                    clones.push({ authId, ...data });
                } catch (e) {
                    clones.push({ authId, status: 'unknown' });
                }
            } else {
                // Vérifier le fichier JSON de registre
                const registryPath = path.join(clonesDir, `${authId}.json`);
                if (fs.existsSync(registryPath)) {
                    try {
                        const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
                        clones.push({ authId, ...data });
                    } catch (e) {
                        clones.push({ authId, status: 'unknown' });
                    }
                } else {
                    clones.push({ authId, status: 'unknown' });
                }
            }
        }
        return clones;
    }
}

export default {
    command: 'listrent',
    aliases: ['listclone', 'botclones'],
    category: 'owner',
    description: 'List all currently active sub-bots',
    usage: '.listrent',
    async handler(sock, message, args, context) {
        const { chatId } = context;
        const activeConns = global.conns || [];
        const storedClones = await getAllCloneSessions();

        if (activeConns.length === 0 && storedClones.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "*❌ No sub-bots are currently active or stored.*"
            }, { quoted: message });
        }

        let msg = `*─── [ CLONE BOTS ] ───*\n\n`;
        msg += `*Storage:* ${HAS_DB ? 'Database 🗄️' : 'File System 📁'}\n\n`;

        if (activeConns.length > 0) {
            msg += `*🟢 ONLINE CLONES:*\n\n`;
            activeConns.forEach((conn, i) => {
                const user = conn.user;
                const number = user.id.split(':')[0];
                msg += `*${i + 1}.* @${number}\n`;
                msg += `   └ Name: ${user.name || 'Sub-Bot'}\n`;
                msg += `   └ Status: Connected ✅\n\n`;
            });
        }

        const offlineClones = storedClones.filter(clone => {
            return !activeConns.some((conn) => {
                const connNumber = conn.user.id.split(':')[0];
                return clone.phoneNumber === connNumber;
            });
        });

        if (offlineClones.length > 0) {
            msg += `*⚪ STORED CLONES (Offline):*\n\n`;
            offlineClones.forEach((clone, i) => {
                msg += `*${i + 1}.* 📱 ${clone.phoneNumber || 'N/A'}\n`;
                msg += `   └ ID: ${clone.authId}\n`;
                msg += `   └ Status: ${clone.status || 'offline'}\n`;
                msg += `   └ Storage: ${clone.dbType || 'local'}\n`;
                if (clone.createdAt) {
                    const date = new Date(clone.createdAt);
                    msg += `   └ Created: ${date.toLocaleString()}\n`;
                }
                msg += `\n`;
            });
        }

        msg += `*Total Online:* ${activeConns.length}\n`;
        if (HAS_DB) {
            msg += `*Total Stored:* ${storedClones.length}`;
        }

        const mentions = activeConns.map((c) => c.user.id);
        await sock.sendMessage(chatId, {
            text: msg,
            mentions
        }, { quoted: message });
    }
};