import fs from 'fs';
import path,{ dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Importer les décripteurs JavaScript purs
import { 
    decryptSSC, 
    decryptDarkTunnel, 
    decryptHTTPCustom, 
    decryptHTTPInjector, 
    decryptNPVTunnel 
} from '../lib/decryptors.js';

/**
 * Détecter le type de fichier par son contenu
 * @param {string} content - Contenu du fichier à analyser
 * @returns {string|null} Type détecté ou null
 */
function detectFileType(content) {
    const clean = content.trim();
    
    // SSC
    if (clean.startsWith('ssc://') || clean.includes('ssc://')) {
        return 'ssc';
    }
    
    // NPVTunnel
    if (clean.startsWith('NPVTSUB1') || clean.startsWith('NPVT1')) {
        return 'npvtunnel';
    }
    
    // DarkTunnel
    if (clean.includes('encryptedLockedConfig') || clean.includes('EncryptedLockedConfig')) {
        return 'darktunnel';
    }
    
    // HTTPCustom
    if (clean.includes('cfg') && clean.includes('xy') && clean.includes('uv')) {
        return 'httpcustom';
    }
    
    // HTTPInjector - CloudConfig / EHI
    if (clean.includes('cloudconfig') || 
        clean.includes('configMessage') || 
        clean.includes('configData') || 
        clean.includes('configAesKey') ||
        clean.includes('"cfg":') ||
        clean.includes('"xy":') ||
        clean.includes('"uv":') ||
        clean.includes('Someone shared an HTTP Injector config')) {
        return 'httpinjector';
    }
    
    // HTTPInjector - Format base64 / EHI
    if (clean.match(/^[A-Za-z0-9+/=]+$/) && clean.length > 100) {
        return 'httpinjector';
    }
    
    return null;
}

/**
 * Détecter par extension de fichier
 * @param {string} filename - Nom du fichier
 * @returns {string|null} Type détecté ou null
 */
function detectByExtension(filename) {
    const ext = path.extname(filename).toLowerCase();
    const name = path.basename(filename).toLowerCase();
    
    if (ext === '.ssc' || name.includes('ssc')) return 'ssc';
    if (ext === '.npvt' || name.includes('npvt')) return 'npvtunnel';
    if (ext === '.dt' || name.includes('darktunnel') || name.includes('dark')) return 'darktunnel';
    if (ext === '.hc' || name.includes('httpcustom') || name.includes('httpc')) return 'httpcustom';
    if (ext === '.ehi' || name.includes('ehi') || name.includes('httpinjector') || name.includes('injector')) return 'httpinjector';
    if (ext === '.json' && name.includes('cloudconfig')) return 'httpinjector';
    if (ext === '.txt' && name.includes('cloud')) return 'httpinjector';
    
    return null;
}

/**
 * Télécharger depuis ehi.link
 * @param {string} code - Le code ehi.link
 * @returns {Promise<string>} Contenu téléchargé
 */
async function downloadFromEhiLink(code) {
    try {
        const url = `https://ehi.link/${code}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const html = await response.text();
        
        // Chercher un lien direct vers le fichier .ehi
        const fileMatch = html.match(/href="([^"]*\.ehi[^"]*)"/i);
        if (fileMatch) {
            const fileUrl = fileMatch[1].startsWith('http') ? fileMatch[1] : `https://ehi.link${fileMatch[1]}`;
            const fileResponse = await fetch(fileUrl);
            const fileData = await fileResponse.text();
            return fileData;
        }
        
        // Chercher la config dans un script ou une balise
        const contentMatch = html.match(/(?:config|data|content)\s*[:=]\s*["']([^"']+)["']/i);
        if (contentMatch) {
            return contentMatch[1];
        }
        
        // Retourner le code si rien d'autre trouvé
        return `ehi_code:${code}`;
        
    } catch (error) {
        console.error('Erreur de téléchargement depuis ehi.link:', error);
        throw error;
    }
}

/**
 * Décrypter le fichier selon le type détecté
 * @param {Buffer} fileBuffer - Contenu du fichier
 * @param {string} type - Type détecté
 * @returns {Promise<string|null>} Contenu décrypté ou null
 */
async function decryptFile(fileBuffer, type) {
    switch (type) {
        case 'ssc':
            return decryptSSC(fileBuffer);
        case 'npvtunnel':
            return decryptNPVTunnel(fileBuffer);
        case 'darktunnel':
            return decryptDarkTunnel(fileBuffer);
        case 'httpcustom':
            return decryptHTTPCustom(fileBuffer);
        case 'httpinjector':
            return await decryptHTTPInjector(fileBuffer);
        default:
            return null;
    }
}

/**
 * Nettoyer les emojis du texte
 * @param {string} text - Texte à nettoyer
 * @returns {string} Texte nettoyé
 */
function cleanEmojis(text) {
    return text.replace(/[^\x00-\x7F]/g, '').trim();
}

export default {
    command: 'decrypt',
    aliases: ['dc', 'dec', 'decryptehi', 'decehi'],
    category: 'owner',
    description: 'Décrypter les fichiers de configuration VPN (SSC, NPVTunnel, DarkTunnel, HTTPCustom, HTTPInjector)',
    usage: '.decrypt [fichier|texte|url|ehi.link]',
    ownerOnly: true,
    handler: async (sock, message, args, context) => {
        const chatId = context.chatId || message.key.remoteJid;
        const msg = message.message;
        const quotedMsg = msg?.extendedTextMessage?.contextInfo?.quotedMessage;
        const documentMsg = msg?.documentMessage || quotedMsg?.documentMessage;
        const imageMsg = msg?.imageMessage || quotedMsg?.imageMessage;

        let fileBuffer = null;
        let fileName = null;
        let fileType = null;
        let fileSize = 0;

        try {
            // === CAS 1: Document attaché ===
            if (documentMsg) {
                fileName = documentMsg.fileName || 'fichier.bin';
                fileBuffer = await sock.downloadMediaMessage(message);
                fileSize = fileBuffer.length;
                fileType = detectByExtension(fileName);
                
                if (!fileType && fileBuffer) {
                    const content = fileBuffer.toString('utf-8', 0, 500);
                    fileType = detectFileType(content);
                }
            }
            
            // === CAS 2: Image attachée ===
            else if (imageMsg) {
                fileName = 'image.bin';
                fileBuffer = await sock.downloadMediaMessage(message);
                fileSize = fileBuffer.length;
                const content = fileBuffer.toString('utf-8', 0, 500);
                fileType = detectFileType(content) || 'httpinjector';
            }
            
            // === CAS 3: Texte dans le message ou réponse ===
            else {
                let text = args.join(' ') || msg?.conversation || msg?.extendedTextMessage?.text || '';
                
                if (!text && quotedMsg) {
                    text = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
                }
                
                if (text) {
                    // Vérifier si c'est un lien ehi.link
                    const ehiMatch = text.match(/ehi\.link\/([a-zA-Z0-9]+)/);
                    if (ehiMatch) {
                        const code = ehiMatch[1];
                        await sock.sendMessage(chatId, {
                            text: `🔄 *Téléchargement de la config depuis ehi.link...*\n\nCode: \`${code}\`\n⏳ Veuillez patienter...`
                        }, { quoted: message });
                        
                        try {
                            const data = await downloadFromEhiLink(code);
                            
                            if (data.startsWith('ehi_code:')) {
                                const extractedCode = data.replace('ehi_code:', '');
                                return await sock.sendMessage(chatId, {
                                    text: `⚠️ *Configuration trouvée mais non téléchargée !*\n\n` +
                                          `📌 *Code:* \`${extractedCode}\`\n\n` +
                                          `💡 *Méthodes pour obtenir la config:*\n` +
                                          `• Ouvrir le lien sur votre téléphone avec HTTP Injector\n` +
                                          `• Télécharger le fichier .ehi et l'envoyer ici\n` +
                                          `• Utiliser le code avec l'application HTTP Injector\n\n` +
                                          `🌐 *Lien:* https://ehi.link/${extractedCode}`
                                }, { quoted: message });
                            }
                            
                            fileBuffer = Buffer.from(data, 'utf-8');
                            fileName = `${code}.json`;
                            fileType = 'httpinjector';
                            fileSize = fileBuffer.length;
                            
                        } catch (error) {
                            return await sock.sendMessage(chatId, {
                                text: `❌ *Erreur de téléchargement depuis ehi.link:*\n${error.message}\n\n` +
                                      `💡 *Essayez de:*\n` +
                                      `• Ouvrir le lien manuellement\n` +
                                      `• Télécharger le fichier et l'envoyer ici\n` +
                                      `• Utiliser le code avec HTTP Injector`
                            }, { quoted: message });
                        }
                    }
                    // URL normale
                    else if (text.match(/^https?:\/\//)) {
                        try {
                            const response = await fetch(text);
                            const data = await response.text();
                            fileBuffer = Buffer.from(data, 'utf-8');
                            fileName = path.basename(new URL(text).pathname) || 'config.txt';
                            fileType = detectFileType(data) || 'httpinjector';
                            fileSize = fileBuffer.length;
                        } catch (error) {
                            return await sock.sendMessage(chatId, {
                                text: `❌ *Erreur de téléchargement:* ${error.message}`
                            }, { quoted: message });
                        }
                    }
                    // Texte brut
                    else {
                        const cleanText = cleanEmojis(text);
                        fileBuffer = Buffer.from(cleanText, 'utf-8');
                        fileSize = fileBuffer.length;
                        fileName = 'config.txt';
                        fileType = detectFileType(cleanText);
                        
                        // Si c'est un code court (comme 6gstKqyj)
                        if (!fileType && text.length < 20 && text.match(/^[a-zA-Z0-9]+$/)) {
                            return await sock.sendMessage(chatId, {
                                text: `❌ *Code non reconnu comme une config complète*\n\n` +
                                      `📌 Code: \`${text}\`\n\n` +
                                      `💡 *Utilisation:*\n` +
                                      `• Utiliser le lien complet: \`https://ehi.link/${text}\`\n` +
                                      `• Envoyer le fichier .ehi directement\n` +
                                      `• Utiliser \`.decrypt https://ehi.link/${text}\``
                            }, { quoted: message });
                        }
                        
                        if (!fileType) {
                            fileType = 'httpinjector'; // Par défaut
                        }
                    }
                }
            }

            // === Si pas de contenu, erreur ===
            if (!fileBuffer) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Aucun fichier ou texte fourni !*\n\n` +
                          `💡 *Utilisation:*\n` +
                          `• Envoyer un fichier (.ssc, .ehi, .json, etc.)\n` +
                          `• \`.decrypt https://ehi.link/code\`\n` +
                          `• \`.decrypt <contenu_brut>\`\n` +
                          `• Répondre à un message contenant la config\n\n` +
                          `📌 *Exemples:*\n` +
                          `• \`.decrypt https://ehi.link/6gstKqyj\`\n` +
                          `• \`.decrypt \` (avec fichier attaché)`
                }, { quoted: message });
            }

            // === Détection automatique du type ===
            if (!fileType) {
                const content = fileBuffer.toString('utf-8', 0, 500);
                fileType = detectFileType(content);
            }

            if (!fileType) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Type de fichier non reconnu !*\n\n` +
                          `📌 *Formats supportés:*\n` +
                          `• SSC (.ssc)\n` +
                          `• NPVTunnel (.npvt)\n` +
                          `• DarkTunnel (.dt)\n` +
                          `• HTTPCustom (.hc)\n` +
                          `• HTTPInjector (.ehi, cloudconfig.json, lien ehi.link)\n\n` +
                          `💡 *Essayez:*\n` +
                          `• \`.decrypt https://ehi.link/code\`\n` +
                          `• Envoyer le fichier directement`
                }, { quoted: message });
            }

            // === DÉCRYPTAGE ===
            await sock.sendMessage(chatId, {
                text: `🔄 *Décryptage en cours...*\n\n📁 Fichier: *${fileName || 'config'}*\n🔍 Type: *${fileType.toUpperCase()}*\n📏 Taille: *${(fileSize / 1024).toFixed(2)} KB*`
            }, { quoted: message });

            // Appeler le décripteur (HTTPInjector est async)
            const result = await decryptFile(fileBuffer, fileType);
            
            if (!result) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Échec du décryptage*\n\n` +
                          `Le fichier *${fileName || 'config'}* n'a pas pu être décrypté.\n` +
                          `Type détecté: *${fileType.toUpperCase()}*\n\n` +
                          `Vérifiez que le fichier est valide et non corrompu.`
                }, { quoted: message });
            }

            // === ENVOI DU RÉSULTAT ===
            const resultLines = result.split('\n');
            const header = resultLines.slice(0, 3).join('\n');
            const content = resultLines.slice(3).join('\n');

            // Sauvegarder
            const saveDir = path.join(process.cwd(), 'decrypted');
            if (!fs.existsSync(saveDir)) {
                fs.mkdirSync(saveDir, { recursive: true });
            }
            const baseName = path.basename(fileName || 'config', path.extname(fileName || ''));
            const savePath = path.join(saveDir, `${baseName}_${fileType}_${Date.now()}.txt`);
            fs.writeFileSync(savePath, result);

            // Envoyer le résultat
            if (content.length > 4000) {
                await sock.sendMessage(chatId, {
                    text: `📤 *RÉSULTAT DU DÉCRYPTAGE*\n\n` +
                          `📁 Fichier: *${fileName || 'config'}*\n` +
                          `🔍 Type: *${fileType.toUpperCase()}*\n` +
                          `📏 Taille: *${(fileSize / 1024).toFixed(2)} KB*\n` +
                          `💾 Sauvegardé: *${path.basename(savePath)}*\n\n` +
                          `${header}`
                }, { quoted: message });

                const chunks = content.match(/[\s\S]{1,3500}/g) || [];
                for (let i = 0; i < chunks.length; i++) {
                    await sock.sendMessage(chatId, {
                        text: `📄 *Partie ${i + 1}/${chunks.length}*\n\`\`\`\n${chunks[i]}\n\`\`\``
                    });
                }
            } else {
                await sock.sendMessage(chatId, {
                    text: `📤 *RÉSULTAT DU DÉCRYPTAGE*\n\n` +
                          `📁 Fichier: *${fileName || 'config'}*\n` +
                          `🔍 Type: *${fileType.toUpperCase()}*\n` +
                          `📏 Taille: *${(fileSize / 1024).toFixed(2)} KB*\n` +
                          `💾 Sauvegardé: *${path.basename(savePath)}*\n\n` +
                          `\`\`\`\n${content}\n\`\`\``
                }, { quoted: message });
            }

        } catch (error) {
            console.error('Erreur de décryptage:', error);
            await sock.sendMessage(chatId, {
                text: `❌ *Erreur:* ${error.message}\n\n` +
                      `💡 Vérifiez que le fichier est valide et que les dépendances sont installées.`
            }, { quoted: message });
        }
    }
};