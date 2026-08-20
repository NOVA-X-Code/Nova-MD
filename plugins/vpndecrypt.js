import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { TDecryptor } from '../lib/decryptors.js';
import { channelInfo } from '../lib/messageConfig.js';

function detectFileType(content) {
    const clean = content.trim();
    if (clean.startsWith('ssc://') || clean.includes('ssc://')) return 'ssc';
    if (clean.startsWith('NPVTSUB1') || clean.startsWith('NPVT1')) return 'npvtunnel';
    if (clean.includes('encryptedLockedConfig') || clean.includes('EncryptedLockedConfig')) return 'darktunnel';
    if (clean.includes('cfg') && clean.includes('xy')) return 'httpcustom';
    if (clean.includes('configMessage') || clean.includes('configData') || clean.includes('configAesKey')) return 'httpinjector';
    return 'httpinjector'; // Valeur par défaut résiliente
}

export default {
    command: 'decrypt',
    aliases: ['dc', 'dec'],
    category: 'utility',
    description: 'Moteur universel de décryptage VPN sans stockage disque (Zéro-Saturaion)',
    usage: '.decrypt [Envoyer ou répondre à un fichier de configuration]',
    ownerOnly: false,

    handler: async (sock, message, args, context) => {
        const chatId = context.chatId || message.key.remoteJid;
        const msg = message.message;
        const quotedMsg = msg?.extendedTextMessage?.contextInfo?.quotedMessage;
        const documentMsg = msg?.documentMessage || quotedMsg?.documentMessage;

        let fileBuffer = null;
        let fileType = null;
        let isEhiLink = false;
        let targetUrl = '';

        try {
            // Extraction textuelle pour capturer les liens ehi.link
            let text = args.join(' ') || msg?.conversation || msg?.extendedTextMessage?.text || '';
            if (!text && quotedMsg) text = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
            text = text.trim();

            if (text.includes('ehi.link/')) {
                isEhiLink = true;
                const match = text.match(/https?:\/\/ehi\.link\/[a-zA-Z0-9]+/i);
                targetUrl = match ? match[0] : `https://${text.replace(/https?:\/\//i, '')}`;
            }

            // Gestion du flux binaire en mémoire tampon (RAM) sans fichier physique intermédiaire
            if (!isEhiLink && documentMsg) {
                fileBuffer = await downloadMediaMessage(message, 'buffer', {}, { logger: sock.logger });
                fileType = detectFileType(fileBuffer.toString('utf-8', 0, 500));
            } else if (!isEhiLink && text) {
                fileBuffer = Buffer.from(text, 'utf-8');
                fileType = detectFileType(text);
            }

            let decryptedResult = null;

            if (isEhiLink) {
                await sock.sendMessage(chatId, { text: `🔄 *Lien Cloud-EHI détecté...*\n📥 Traitement en mémoire vive...` }, { quoted: message });
                decryptedResult = await TDecryptor.downloadAndDecryptEhiLink(targetUrl);
            } else {
                if (!fileBuffer) {
                    return await sock.sendMessage(chatId, { text: "❌ *Aucun fichier, texte ou lien ehi.link valide fourni.*" }, { quoted: message });
                }
                if (fileType === 'ssc') decryptedResult = TDecryptor.decryptSSC(fileBuffer);
                if (fileType === 'darktunnel') decryptedResult = TDecryptor.decryptDarkTunnel(fileBuffer);
                if (fileType === 'httpcustom') decryptedResult = TDecryptor.decryptHTTPCustom(fileBuffer);
                if (fileType === 'httpinjector') decryptedResult = await TDecryptor.decryptHTTPInjector(fileBuffer);
                if (fileType === 'npvtunnel') decryptedResult = TDecryptor.decryptNPVTunnel(fileBuffer);
            }

            if (!decryptedResult) {
                return await sock.sendMessage(chatId, { text: `❌ *Échec du décryptage.* Structure ou clé invalide.` }, { quoted: message });
            }

            // ⚡ TRAITEMENT SANS SAUVEGARDE SUR DISQUE (ZÉRO ÉCRITURE)
            // On sépare et on nettoie directement le texte en mémoire vive pour l'envoi
            const cleanContent = decryptedResult.trim();

            if (cleanContent.length > 4000) {
                await sock.sendMessage(chatId, { text: `📤 *PROFIL DÉCRYPTÉ AVEC SUCCÈS (Flux volumineux) :*` }, { quoted: message });
                
                // Découpage du texte directement depuis la variable RAM
                const chunks = cleanContent.match(/[\s\S]{1,3500}/g) || [];
                for (let i = 0; i < chunks.length; i++) {
                    await sock.sendMessage(chatId, {
                        text: `📄 *Partie ${i + 1}/${chunks.length}*\n\`\`\`json\n${chunks[i]}\n\`\`\``
                    });
                }
            } else {
                await sock.sendMessage(chatId, {
                    text: `🔓 *DECRYPTED CONFIG:*\n\n\`\`\`json\n${cleanContent}\n\`\`\``
                }, { quoted: message },...channelInfo);
            }

            // Libération explicite de la mémoire de l'objet temporaire
            decryptedResult = null;
            fileBuffer = null;

        } catch (error) {
            await sock.sendMessage(chatId, { text: `❌ *Erreur système :* ${error.message}` }, { quoted: message });
        }
    }
};
