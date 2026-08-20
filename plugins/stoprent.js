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
 *****************************************************************************/

import { 
    getAllClonesFromMainDB, 
    deleteClone, 
    isCloneOwner 
} from '../lib/cloneManager.js';
import isOwnerOrSudo from '../lib/isOwner.js';

export default {
    command: 'stoprent',
    aliases: ['stopclone', 'delrent', 'deletemyclone'],
    category: 'owner',
    description: 'Stop your own sub-bot (or all if owner)',
    usage: '.stoprent [number/all]',
    ownerOnly: true,
    async handler(sock, message, args, context) {
        const { chatId } = context;
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        const isFromMe = message.key.fromMe;
        const senderNumber = senderId.split('@')[0];

        const activeConns = global.conns || [];
        const allClones = await getAllClonesFromMainDB();

        // Filtrer: si owner => tous, sinon seulement ses clones
        const userClones = (isOwner || isFromMe) 
            ? allClones 
            : allClones.filter(c => c.phoneNumber === senderNumber);

        // Filtrer les connexions actives
        const userActiveConns = (isOwner || isFromMe)
            ? activeConns
            : activeConns.filter(conn => {
                const connNumber = conn.user.id.split(':')[0];
                return userClones.some(c => c.phoneNumber === connNumber);
            });

        if (userActiveConns.length === 0) {
            return await sock.sendMessage(chatId, {
                text: `❌ No sub-bots are currently running${!isOwner && !isFromMe ? ' for your number' : ''}.`
            }, { quoted: message });
        }

        if (!args[0]) {
            let listMsg = `*📋 ${isOwner || isFromMe ? 'ACTIVE' : 'YOUR'} CLONES*\n\n`;
            userActiveConns.forEach((conn, i) => {
                const number = conn.user.id.split(':')[0];
                listMsg += `*${i + 1}.* @${number}\n`;
                listMsg += `   └ Name: ${conn.user.name || 'Sub-Bot'}\n\n`;
            });
            listMsg += `📌 *Usage:* \`.stoprent <number>\` or \`.stoprent all\``;
            
            const mentions = userActiveConns.map((c) => c.user.id);
            return await sock.sendMessage(chatId, {
                text: listMsg,
                mentions
            }, { quoted: message });
        }

        if (args[0].toLowerCase() === 'all') {
            // Vérifier que l'utilisateur peut supprimer tous les clones
            if (!isOwner && !isFromMe) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *You can only delete your own clones!*\n\nUse \`.stoprent <number>\` to delete specific clones.`
                }, { quoted: message });
            }

            let stoppedCount = 0;
            for (const conn of userActiveConns) {
                try {
                    await conn.logout();
                    conn.end();
                    stoppedCount++;
                } catch (e) {
                    console.error('Error stopping clone:', e.message);
                }
            }

            // Supprimer les clones de l'utilisateur
            for (const clone of userClones) {
                await deleteClone(clone.authId);
            }

            // Nettoyer global.conns
            global.conns = global.conns.filter(c => {
                const connNumber = c.user.id.split(':')[0];
                return !userClones.some(cl => cl.phoneNumber === connNumber);
            });

            return await sock.sendMessage(chatId, {
                text: `✅ ${isOwner || isFromMe ? 'All' : 'Your'} sub-bots have been stopped and removed.\n\n` +
                    `Stopped: ${stoppedCount}\n