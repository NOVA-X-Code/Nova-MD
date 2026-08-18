import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import decryptors
import { 
    decryptSSC, 
    decryptDarkTunnel, 
    decryptHTTPCustom, 
    decryptHTTPInjector, 
    decryptNPVTunnel 
} from '../lib/decryptors.js';

/**
 * Detect file type by content
 * @param {string} content - File content to analyze
 * @returns {string|null} Detected file type or null
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
    
    // HTTPInjector - CloudConfig
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
    
    // HTTPInjector - Base64 / EHI format
    if (clean.match(/^[A-Za-z0-9+/=]+$/) && clean.length > 100) {
        return 'httpinjector';
    }
    
    return null;
}

/**
 * Detect by file extension
 * @param {string} filename - Name of the file
 * @returns {string|null} Detected file type or null
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
 * Download from ehi.link
 * @param {string} code - The ehi.link code
 * @returns {Promise<string>} Downloaded content
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
        
        // Try to find direct .ehi file link
        const fileMatch = html.match(/href="([^"]*\.ehi[^"]*)"/i);
        if (fileMatch) {
            const fileUrl = fileMatch[1].startsWith('http') ? fileMatch[1] : `https://ehi.link${fileMatch[1]}`;
            const fileResponse = await fetch(fileUrl);
            const fileData = await fileResponse.text();
            return fileData;
        }
        
        // Try to find config in script or tag
        const contentMatch = html.match(/(?:config|data|content)\s*[:=]\s*["']([^"']+)["']/i);
        if (contentMatch) {
            return contentMatch[1];
        }
        
        // Return code if nothing else found
        return `ehi_code:${code}`;
        
    } catch (error) {
        console.error('Error downloading from ehi.link:', error);
        throw error;
    }
}

/**
 * Decrypt file based on detected type (async)
 * @param {Buffer} fileBuffer - File content as buffer
 * @param {string} type - Detected file type
 * @returns {Promise<string|null>} Decrypted content or null
 */
async function decryptFile(fileBuffer, type) {
    switch (type) {
        case 'ssc':
            return await decryptSSC(fileBuffer);
        case 'npvtunnel':
            return await decryptNPVTunnel(fileBuffer);
        case 'darktunnel':
            return await decryptDarkTunnel(fileBuffer);
        case 'httpcustom':
            return await decryptHTTPCustom(fileBuffer);
        case 'httpinjector':
            return await decryptHTTPInjector(fileBuffer);
        default:
            return null;
    }
}

/**
 * Clean emojis from text
 * @param {string} text - Text to clean
 * @returns {string} Cleaned text
 */
function cleanEmojis(text) {
    return text.replace(/[^\x00-\x7F]/g, '').trim();
}

export default {
    command: 'decrypt',
    aliases: ['dc', 'dec', 'decryptehi', 'decehi'],
    category: 'owner',
    description: 'Decrypt VPN configuration files (SSC, NPVTunnel, DarkTunnel, HTTPCustom, HTTPInjector)',
    usage: '.decrypt [file|text|url|ehi.link]',
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
            // === CASE 1: Attached document ===
            if (documentMsg) {
                fileName = documentMsg.fileName || 'file.bin';
                fileBuffer = await sock.downloadMediaMessage(message);
                fileSize = fileBuffer.length;
                fileType = detectByExtension(fileName);
                
                if (!fileType && fileBuffer) {
                    const content = fileBuffer.toString('utf-8', 0, 500);
                    fileType = detectFileType(content);
                }
            }
            
            // === CASE 2: Attached image ===
            else if (imageMsg) {
                fileName = 'image.bin';
                fileBuffer = await sock.downloadMediaMessage(message);
                fileSize = fileBuffer.length;
                const content = fileBuffer.toString('utf-8', 0, 500);
                fileType = detectFileType(content) || 'httpinjector';
            }
            
            // === CASE 3: Text in message or reply ===
            else {
                let text = args.join(' ') || msg?.conversation || msg?.extendedTextMessage?.text || '';
                
                if (!text && quotedMsg) {
                    text = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
                }
                
                if (text) {
                    // Check if it's an ehi.link URL
                    const ehiMatch = text.match(/ehi\.link\/([a-zA-Z0-9]+)/);
                    if (ehiMatch) {
                        const code = ehiMatch[1];
                        await sock.sendMessage(chatId, {
                            text: `🔄 *Downloading config from ehi.link...*\n\nCode: \`${code}\`\n⏳ Please wait...`
                        }, { quoted: message });
                        
                        try {
                            const data = await downloadFromEhiLink(code);
                            
                            if (data.startsWith('ehi_code:')) {
                                const extractedCode = data.replace('ehi_code:', '');
                                return await sock.sendMessage(chatId, {
                                    text: `⚠️ *Config found but not downloaded!*\n\n` +
                                          `📌 *Code:* \`${extractedCode}\`\n\n` +
                                          `💡 *Methods to get the config:*\n` +
                                          `• Open the link on your phone with HTTP Injector\n` +
                                          `• Download the .ehi file and send it here\n` +
                                          `• Use the code with HTTP Injector app\n\n` +
                                          `🌐 *Link:* https://ehi.link/${extractedCode}`
                                }, { quoted: message });
                            }
                            
                            fileBuffer = Buffer.from(data, 'utf-8');
                            fileName = `${code}.json`;
                            fileType = 'httpinjector';
                            fileSize = fileBuffer.length;
                            
                        } catch (error) {
                            return await sock.sendMessage(chatId, {
                                text: `❌ *Error downloading from ehi.link:*\n${error.message}\n\n` +
                                      `💡 *Try to:*\n` +
                                      `• Open the link manually\n` +
                                      `• Download the file and send it here\n` +
                                      `• Use the code with HTTP Injector`
                            }, { quoted: message });
                        }
                    }
                    // Normal URL
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
                                text: `❌ *Download error:* ${error.message}`
                            }, { quoted: message });
                        }
                    }
                    // Plain text
                    else {
                        const cleanText = cleanEmojis(text);
                        fileBuffer = Buffer.from(cleanText, 'utf-8');
                        fileSize = fileBuffer.length;
                        fileName = 'config.txt';
                        fileType = detectFileType(cleanText);
                        
                        // If it's a short code (like 6gstKqyj)
                        if (!fileType && text.length < 20 && text.match(/^[a-zA-Z0-9]+$/)) {
                            return await sock.sendMessage(chatId, {
                                text: `❌ *Code not recognized as a complete config*\n\n` +
                                      `📌 Code: \`${text}\`\n\n` +
                                      `💡 *Usage:*\n` +
                                      `• Use full link: \`https://ehi.link/${text}\`\n` +
                                      `• Send the .ehi file directly\n` +
                                      `• Use \`.decrypt https://ehi.link/${text}\``
                            }, { quoted: message });
                        }
                        
                        if (!fileType) {
                            fileType = 'httpinjector'; // Default
                        }
                    }
                }
            }

            // === If no content, error ===
            if (!fileBuffer) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *No file or text provided!*\n\n` +
                          `💡 *Usage:*\n` +
                          `• Send a file (.ssc, .ehi, .json, etc.)\n` +
                          `• \`.decrypt https://ehi.link/code\`\n` +
                          `• \`.decrypt <raw_content>\`\n` +
                          `• Reply to a message containing the config\n\n` +
                          `📌 *Examples:*\n` +
                          `• \`.decrypt https://ehi.link/6gstKqyj\`\n` +
                          `• \`.decrypt \` (with attached file)`
                }, { quoted: message });
            }

            // === Auto detect type ===
            if (!fileType) {
                const content = fileBuffer.toString('utf-8', 0, 500);
                fileType = detectFileType(content);
            }

            if (!fileType) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Unrecognized file type!*\n\n` +
                          `📌 *Supported formats:*\n` +
                          `• SSC (.ssc)\n` +
                          `• NPVTunnel (.npvt)\n` +
                          `• DarkTunnel (.dt)\n` +
                          `• HTTPCustom (.hc)\n` +
                          `• HTTPInjector (.ehi, cloudconfig.json, ehi.link)\n\n` +
                          `💡 *Try:*\n` +
                          `• \`.decrypt https://ehi.link/code\`\n` +
                          `• Send the file directly`
                }, { quoted: message });
            }

            // === DECRYPT ===
            await sock.sendMessage(chatId, {
                text: `🔄 *Decrypting...*\n\n📁 File: *${fileName || 'config'}*\n🔍 Type: *${fileType.toUpperCase()}*\n📏 Size: *${(fileSize / 1024).toFixed(2)} KB*`
            }, { quoted: message });

            // Call async decryptor
            const result = await decryptFile(fileBuffer, fileType);
            
            if (!result) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Decryption failed*\n\n` +
                          `The file *${fileName || 'config'}* could not be decrypted.\n` +
                          `Detected type: *${fileType.toUpperCase()}*\n\n` +
                          `Verify that the file is valid and not corrupted.`
                }, { quoted: message });
            }

            // === SEND RESULT ===
            const resultLines = result.split('\n');
            const header = resultLines.slice(0, 3).join('\n');
            const content = resultLines.slice(3).join('\n');

            // Save
            const saveDir = path.join(process.cwd(), 'decrypted');
            if (!fs.existsSync(saveDir)) {
                fs.mkdirSync(saveDir, { recursive: true });
            }
            const baseName = path.basename(fileName || 'config', path.extname(fileName || ''));
            const savePath = path.join(saveDir, `${baseName}_${fileType}_${Date.now()}.txt`);
            fs.writeFileSync(savePath, result);

            // Send result
            if (content.length > 4000) {
                await sock.sendMessage(chatId, {
                    text: `📤 *DECRYPTION RESULT*\n\n` +
                          `📁 File: *${fileName || 'config'}*\n` +
                          `🔍 Type: *${fileType.toUpperCase()}*\n` +
                          `📏 Size: *${(fileSize / 1024).toFixed(2)} KB*\n` +
                          `💾 Saved: *${path.basename(savePath)}*\n\n` +
                          `${header}`
                }, { quoted: message });

                const chunks = content.match(/[\s\S]{1,3500}/g) || [];
                for (let i = 0; i < chunks.length; i++) {
                    await sock.sendMessage(chatId, {
                        text: `📄 *Part ${i + 1}/${chunks.length}*\n\`\`\`\n${chunks[i]}\n\`\`\``
                    });
                }
            } else {
                await sock.sendMessage(chatId, {
                    text: `📤 *DECRYPTION RESULT*\n\n` +
                          `📁 File: *${fileName || 'config'}*\n` +
                          `🔍 Type: *${fileType.toUpperCase()}*\n` +
                          `📏 Size: *${(fileSize / 1024).toFixed(2)} KB*\n` +
                          `💾 Saved: *${path.basename(savePath)}*\n\n` +
                          `\`\`\`\n${content}\n\`\`\``
                }, { quoted: message });
            }

        } catch (error) {
            console.error('Decrypt error:', error);
            await sock.sendMessage(chatId, {
                text: `❌ *Error:* ${error.message}\n\n` +
                      `💡 Verify that the file is valid and Python dependencies are installed.`
            }, { quoted: message });
        }
    }
};