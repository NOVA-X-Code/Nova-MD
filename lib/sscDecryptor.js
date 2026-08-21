import crypto from 'crypto';

const SSC_CONSTANTS = {
    FIXED_NONCE: Buffer.from([0x74, 0xd0, 0xf3, 0x87, 0x9f, 0x9d, 0x47, 0xf7]),
    L1_KEY: Buffer.from('c8a6a8ea102d5a0baf8fdb1b39cd615c0d07c1edcbde4e82cfdd309bc4587f6b', 'hex'),
    L2_KEY: Buffer.from('7f9db48ffde449ad19f9ed44b8b27eee334ab4a85b972dca8ff20e4e8ed44e4e', 'hex'),
    L3_KEY: Buffer.from('d39394517a48971f6e8555e994bee5bd835e5ab2f85fbd76bbd99800f32b967e', 'hex'),
    KEY_MAP: {
        "a": "CONFIGS", "b": "NOTE", "c": "EXPIRY DATE", "e": "CONFIGNAME",
        "f": "PAYLOAD ENABLED", "g": "PAYLOAD", "h": "PROXY", "i": "PROXY PORT",
        "j": "TYPE", "k": "PROXY ENABLED", "l": "ADDRESS", "m": "PORT",
        "n": "IS PREMIUM", "o": "USERNAME", "p": "PASSWORD", "q": "TIMEOUT",
        "r": "PROTOCOL", "s": "VERSION", "t": "ENCRYPTION", "u": "COMPRESSIONLEVEL",
        "v": "DNS", "w": "NSSERVER", "x": "PUBKEY", "y": "ISDEFAULT", "z": "LOCALPORT"
    }
};

function chacha20Decrypt(key, nonce, data) {
    try {
        const decipher = crypto.createDecipheriv('chacha20', key, nonce);
        decipher.setAutoPadding(false);
        const skip = Buffer.alloc(64);
        decipher.update(skip);
        return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (e) { return null; }
}

function cleanJSON(textBytes) {
    if (!textBytes) return null;
    try {
        const text = textBytes.toString('utf-8').split('\x00');
        const start = text.findIndex(el => el.includes('{'));
        if (start !== -1) {
            const joined = text.slice(start).join('');
            return JSON.parse(joined.substring(joined.indexOf('{'), joined.lastIndexOf('}') + 1));
        }
    } catch (e) {}
    return null;
}

export function decryptSSC(fileBytes) {
    try {
        let content = fileBytes.toString('utf-8').trim();
        if (content.startsWith('ssc://')) content = content.slice(6).split('').reverse().join('');
        const cipherHex = content.replace(/\s/g, '');
        
        const l1Data = chacha20Decrypt(SSC_CONSTANTS.L1_KEY, SSC_CONSTANTS.FIXED_NONCE, Buffer.from(cipherHex, 'hex'));
        const l1Json = cleanJSON(l1Data);
        if (!l1Json) return null;

        let targetJson = l1Json;
        if (l1Json.c && typeof l1Json.a === 'string') {
            const l2Nonce = Buffer.from(l1Json.a.slice(0, 16), 'hex');
            const l2Data = chacha20Decrypt(SSC_CONSTANTS.L2_KEY, l2Nonce, Buffer.from(l1Json.c, 'hex'));
            targetJson = cleanJSON(l2Data) || l1Json;
        }

        // 🔄 LOGIQUE LOGICIELLE MANQUANTE : Déchiffrement de la couche interne L3 CONFIGS par dérivation de nonce binaire
        const normalized = {};
        for (const [k, v] of Object.entries(targetJson)) {
            const newKey = SSC_CONSTANTS.KEY_MAP[k] || k;
            
            if (newKey === 'CONFIGS' && Array.isArray(v)) {
                normalized[newKey] = v.map(subConfig => {
                    const cleanSub = {};
                    // Dérivation du nonce à 8 octets depuis la clé utilisateur "b"
                    const userKey = subConfig.b || "DEFAULT";
                    const l3Nonce = crypto.createHash('md5').update(userKey).digest().slice(0, 8);
                    
                    for (const [sk, sv] of Object.entries(subConfig)) {
                        const subLabel = SSC_CONSTANTS.KEY_MAP[sk] || sk;
                        // Si le champ est protégé, on applique l'index L3
                        if (["g", "h", "l", "o", "p", "v", "x", "w"].includes(sk) && typeof sv === 'string') {
                            const decBytes = chacha20Decrypt(SSC_CONSTANTS.L3_KEY, l3Nonce, Buffer.from(sv, 'hex'));
                            cleanSub[subLabel] = decBytes ? decBytes.toString('utf-8').replace(/[\x00-\x1F]/g, '').trim() : sv;
                        } else {
                            cleanSub[subLabel] = sv;
                        }
                    }
                    return cleanSub;
                });
            } else {
                normalized[newKey] = v;
            }
        }

        return `Labokingfreesurf SSC CONFIG\n==============================\n\n${JSON.stringify(normalized, null, 4)}`;
    } catch (e) { return null; }
}
