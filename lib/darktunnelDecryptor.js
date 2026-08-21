import crypto from 'crypto';
import { unpack } from 'msgpackr';

const DT_CONSTANTS = {
    KEY_256: Buffer.from("$B&E)H@McQfThWmZq4t7w!z%C*F-JaNd", "utf-8"),
    KEY_192: Buffer.from("F)J@NcRfUjXn2r4u7x!A%D*G", "utf-8"),
    IV: Buffer.from("232e39185523184a5723586242200e05", 'hex')
};

function base64DecodeSafe(data) {
    let clean = data.replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4 !== 0) clean += '=';
    return Buffer.from(clean, 'base64');
}

function aesCfbDecrypt(data, key, iv, bits = 256) {
    const algo = bits === 192 ? 'aes-192-cfb' : 'aes-256-cfb';
    const decipher = crypto.createDecipheriv(algo, key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

// 🔄 LOGIQUE LOGICIELLE MANQUANTE : Nettoyage et décryptage récursif de l'arbre MessagePack
function cleanAndDecryptTree(node) {
    if (!node || typeof node !== 'object') return node;

    if (Array.isArray(node)) {
        return node.map(item => cleanAndDecryptTree(item));
    }

    const cleanObj = {};
    for (let [k, v] of Object.entries(node)) {
        // Sécurité : masquer les mots de passe comme dans le script Python
        if (k.toLowerCase().includes('password') || k.toLowerCase().includes('pass')) {
            cleanObj[k] = "REMOVED_FOR_SAFETY";
            continue;
        }

        // Si le champ est un bloc binaire chiffré imbriqué
        if (k.startsWith('Encrypted') && (v instanceof Buffer || typeof v === 'string')) {
            try {
                const cipherBytes = typeof v === 'string' ? base64DecodeSafe(v) : v;
                const decryptedBytes = aesCfbDecrypt(cipherBytes, DT_CONSTANTS.KEY_192, DT_CONSTANTS.IV, 192);
                try {
                    // Tenter de désérialiser le sous-MessagePack
                    v = cleanAndDecryptTree(unpack(decryptedBytes));
                } catch(e) {
                    v = decryptedBytes.toString('utf-8');
                }
                k = k.replace('Encrypted', 'Decrypted');
            } catch(e) {}
        } else if (v instanceof Buffer) {
            v = v.toString('utf-8');
        } else if (typeof v === 'object') {
            v = cleanAndDecryptTree(v);
        }

        // Auto-parsing des chaînes JSON embarquées
        if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
            try { v = JSON.parse(v); } catch(e){}
        }

        cleanObj[k] = v;
    }
    return cleanObj;
}

export function decryptDarkTunnel(fileBytes) {
    try {
        let raw = fileBytes.toString('utf-8').trim();
        if (raw.includes("://")) raw = raw.split("://")[1];

        const outerObj = JSON.parse(base64DecodeSafe(raw).toString('utf-8'));
        if (!outerObj.encryptedLockedConfig) return null;

        const encryptedData = base64DecodeSafe(outerObj.encryptedLockedConfig);
        const decryptedOuter = aesCfbDecrypt(encryptedData, DT_CONSTANTS.KEY_256, DT_CONSTANTS.IV, 256);
        
        const unpackedOuter = unpack(decryptedOuter);
        const finalCleanConfig = cleanAndDecryptTree(unpackedOuter);

        outerObj.encryptedLockedConfig = finalCleanConfig;
        return `Labokingfreesurf DARK TUNNEL CONFIG\n==============================\n\n${JSON.stringify(outerObj, null, 4)}`;
    } catch (e) { return null; }
}
