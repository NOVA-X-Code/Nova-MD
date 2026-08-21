import crypto from 'crypto';
import argon2 from 'argon2';

const EHI_CONSTANTS = {
    L1_KEY: Buffer.from('7e1210f7aab956f7a668bda6e57feddb7f84ad840aef8d27b1b969959be3ab6c', 'hex'),
    L2_KEY_STATIC: Buffer.from('b2bc617c32d8b9eb1943a5ffa8051eea', 'hex'),
    EOO_MASTER_KEY: Buffer.from('null=V5kU5+FFrY\x00', 'utf-8'),
    BYPASS_IVS: [
        Buffer.from('221d572349555f1d112133236b1f4a3f', 'hex'),
        Buffer.from('5543494c53443e3f4a6a4539384e776a', 'hex'),
        Buffer.from('374c2541575e4d531a3c327b75431e5f', 'hex')
    ],
    STANDARD_IVS: [
        Buffer.from('2c5d1147bbad422b3b334d4d235f1a53', 'hex'),
        Buffer.from('522b01433a5e8b2fc7549e1ad368e541', 'hex'),
        Buffer.from('337a1035aaedf3458ca167e92d74b839', 'hex')
    ],
    STD_ALPHABET: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    CUSTOM_ALPHABET: "RkLC2QaVMPYgGJW/A4f7qzDb9e+t6Hr0Zp8OlNyjuxKcTw1o5EIimhBn3UvdSFXs",
    TRANSLATION_MAP: {}
};

for (let i = 0; i < EHI_CONSTANTS.CUSTOM_ALPHABET.length; i++) {
    EHI_CONSTANTS.TRANSLATION_MAP[EHI_CONSTANTS.CUSTOM_ALPHABET[i]] = EHI_CONSTANTS.STD_ALPHABET[i];
}

function customB64DecodeEhi(str) {
    const cleanStr = str.replace(/\?/g, '');
    let translated = '';
    for (let i = 0; i < cleanStr.length; i++) {
        translated += EHI_CONSTANTS.TRANSLATION_MAP[cleanStr[i]] || cleanStr[i];
    }
    while (translated.length % 4 !== 0) translated += '=';
    return Buffer.from(translated, 'base64');
}

function ehiDecryptXorLayer(ciphertextStr, key) {
    if (!ciphertextStr || !ciphertextStr.trim()) return null;
    try {
        const reversed = ciphertextStr.split('').reverse().join('');
        const hexBytesRaw = customB64DecodeEhi(reversed);
        const rawBytes = Buffer.from(hexBytesRaw.toString('ascii'), 'hex');
        const keyBytes = Buffer.from(key);
        const result = [];
        for (let i = 0; i < rawBytes.length; i++) {
            const val = rawBytes[i] ^ keyBytes[i % keyBytes.length];
            if (val !== 0) result.push(val);
        }
        return Buffer.from(result).toString('utf-8');
    } catch (e) { return null; }
}

function xxteaDecrypt(data, key) {
    if (data.length === 0) return Buffer.alloc(0);
    const n = Math.floor(data.length / 4);
    const v = new Uint32Array(n);
    for (let i = 0; i < n; i++) v[i] = data.readUInt32LE(i * 4);
    const k = new Uint32Array(4);
    for (let i = 0; i < 4; i++) k[i] = key.readUInt32LE(Math.min(i * 4, key.length - 4));

    const delta = 0x9e3779b9;
    let rounds = Math.floor(6 + 52 / n);
    let sum = (rounds * delta) & 0xffffffff;
    let y = v;

    while (sum !== 0) {
        const e = (sum >> 2) & 3;
        for (let p = n - 1; p > 0; p--) {
            const z = v[p - 1];
            const mx = (((z >> 5) ^ (y << 2)) + ((y >> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z));
            y = v[p] = (v[p] - mx) & 0xffffffff;
        }
        const z = v[n - 1];
        const mx = (((z >> 5) ^ (y << 2)) + ((y >> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(0 & 3) ^ e] ^ z));
        y = v = (v - mx) & 0xffffffff;
        sum = (sum - delta) & 0xffffffff;
    }

    const result = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) result.writeUInt32LE(v[i], i * 4);
    const length = v[n - 1];
    return (length > 0 && length <= n * 4) ? result.slice(0, length) : result;
}

function ehiParseBytes(fileBytes) {
    try {
        let offset = 0;
        if (fileBytes.readUInt16BE(0) === 0xaced) offset = 4;
        function readUTF() {
            if (offset + 2 > fileBytes.length) return '';
            const len = fileBytes.readUInt16BE(offset);
            offset += 2;
            const res = fileBytes.slice(offset, offset + len).toString('utf-8');
            offset += len;
            return res;
        }
        readUTF(); offset += 8; readUTF(); offset += 8;
        if (offset + 4 > fileBytes.length) return null;
        const pLen = fileBytes.readUInt32BE(offset);
        offset += 4; offset += 8;
        return fileBytes.slice(offset, offset + pLen);
    } catch (e) { return null; }
}

function decodeJavaUtf16Xor(str, key) {
    if (!str) return str;
    try {
        const keyBytes = Buffer.from(key, 'utf-8');
        const strBytes = Buffer.from(str, 'utf-16le');
        const res = Buffer.alloc(strBytes.length);
        for (let i = 0; i < strBytes.length; i++) {
            res[i] = strBytes[i] ^ keyBytes[i % keyBytes.length];
        }
        return res.toString('utf-16le').replace(/\x00/g, '');
    } catch (e) { return str; }
}

function generateMasterKey(config) {
    const parts = [
        config.configAesKey, config.configIdentifier, config.configSalt,
        config.configTimestamp ? String(config.configTimestamp) : "",
        config.configExpiryTimestamp ? String(config.configExpiryTimestamp) : "",
        config.lockModes, config.lockModesHash, config.configHwid,
        config.configLockMobileOperatorId
    ].filter(Boolean).join('');
    return crypto.createHash('sha256').update(parts, 'utf-8').digest();
}

export async function decryptHTTPInjector(fileBytes) {
    try {
        const payload = ehiParseBytes(fileBytes);
        if (!payload) return null;
        let config = null;
        let matchedIv = null;

        for (const iv of [...EHI_CONSTANTS.BYPASS_IVS, ...EHI_CONSTANTS.STANDARD_IVS]) {
            try {
                const decipher = crypto.createDecipheriv('aes-256-cbc', EHI_CONSTANTS.L1_KEY, iv);
                const l1Text = Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf-8');
                const parts = l1Text.split(':');
                
                if (parts.length >= 3) {
                    const c2 = crypto.createDecipheriv('aes-128-cbc', EHI_CONSTANTS.L2_KEY_STATIC, Buffer.from(parts[1], 'base64'));
                    const garbage = Buffer.concat([c2.update(Buffer.from(parts[1], 'base64')), c2.final()]);
                    const finalRaw = xxteaDecrypt(garbage, EHI_CONSTANTS.EOO_MASTER_KEY);
                    const startIdx = finalRaw.indexOf(123); 
                    if (startIdx !== -1) {
                        config = JSON.parse(finalRaw.slice(startIdx).toString('utf-8'));
                        matchedIv = iv;
                        break;
                    }
                }
            } catch (e) { continue; }
        }

        if (!config) return null;
        const targetSalt = config.configSalt || 'EVZJNI';

        if (!EHI_CONSTANTS.BYPASS_IVS.some(iv => iv.equals(matchedIv)) && config.configData) {
            const aaaResult = ehiDecryptXorLayer(config.configData, targetSalt);
            if (!aaaResult) return null;
            const rawPayload = Buffer.from(aaaResult, 'base64');

            const salt = rawPayload.slice(0x0a, 0x1a);
            const timeCost = rawPayload.readUInt32LE(1);
            const memoryCost = rawPayload.readUInt32LE(5);
            const parallelism = rawPayload[9] || 1;

            const masterKey = generateMasterKey(config);
            const argonKey = await argon2.hash(masterKey, {
                salt: salt, timeCost: timeCost, memoryCost: memoryCost, parallelism: parallelism,
                hashLength: 32, type: argon2.argon2id, raw: true
            });

            const decipher3 = crypto.createDecipheriv('chacha20-poly1305', argonKey, rawPayload.slice(0x1a, 0x32), { authTagLength: 16 });
            decipher3.setAAD(rawPayload.slice(0, 0x1a));
            decipher3.setAuthTag(rawPayload.slice(-16));
            
            const decryptedJsonBytes = Buffer.concat([decipher3.update(rawPayload.slice(0x32, -16)), decipher3.final()]);
            config = JSON.parse(decryptedJsonBytes.toString('utf-8'));
        }

        // 🔄 LOGIQUE LOGICIELLE MANQUANTE : Décodage récursif des sous-champs cachés
        if (config.configMessage) {
            config.configMessage = decodeJavaUtf16Xor(config.configMessage, targetSalt);
        }
        if (config.v2rRawJson && typeof config.v2rRawJson === 'string') {
            try { config.v2rRawJson = JSON.parse(config.v2rRawJson); } catch(e){}
        }
        if (config.overwriteServerData && typeof config.overwriteServerData === 'string') {
            try { config.overwriteServerData = JSON.parse(config.overwriteServerData); } catch(e){}
        }

        return `Labokingfreesurf HTTP INJECTOR CONFIG\n==============================\n\n${JSON.stringify(config, null, 4)}`;
    } catch (e) { return null; }
}
