import crypto from 'crypto';
import argon2 from 'argon2';
import { parse } from 'node-html-parser';
import fetch from 'node-fetch';

// ============================================================
// CONFIGURATIONS ET TABLES DE CORRESPONDANCE DES CONFIGS
// ============================================================

const SSC_CONSTANTS = {
    FIXED_NONCE: Buffer.from([0x74, 0xd0, 0xf3, 0x87, 0x9f, 0x9d, 0x47, 0xf7]),
    L1_KEY: Buffer.from('c8a6a8ea102d5a0baf8fdb1b39cd615c0d07c1edcbde4e82cfdd309bc4587f6b', 'hex'),
    L2_KEY: Buffer.from('7f9db48ffde449ad19f9ed44b8b27eee334ab4a85b972dca8ff20e4e8ed44e4e', 'hex'),
    L3_KEY: Buffer.from('d39394517a48971f6e8555e994bee5bd835e5ab2f85fbd76bbd99800f32b967e', 'hex'),
    KEY_MAP: {
        "a": "CONFIGS",
        "b": "NOTE",
        "c": "EXPIRY DATE",
        "e": "CONFIGNAME",
        "f": "PAYLOAD ENABLED",
        "g": "PAYLOAD",
        "h": "PROXY",
        "i": "PROXY PORT",
        "j": "TYPE",
        "k": "PROXY ENABLED",
        "l": "ADDRESS",
        "m": "PORT",
        "n": "IS PREMIUM",
        "o": "USERNAME",
        "p": "PASSWORD",
        "q": "TIMEOUT",
        "r": "PROTOCOL",
        "s": "VERSION",
        "t": "ENCRYPTION",
        "u": "COMPRESSIONLEVEL",
        "v": "DNS",
        "w": "NSSERVER",
        "x": "PUBKEY",
        "y": "ISDEFAULT",
        "z": "LOCALPORT"
    },
    ENCRYPTED_FIELDS: new Set(["g", "h", "l", "o", "p", "v", "x", "i", "w"])
};

const HC_CONSTANTS = {
    CHACHA_KEYS: [
        Buffer.from('2be4342943c6f91ff58987f41a1aafd179eeb4e053f5cea55b11d6a7db58bd7d', 'hex'),
        Buffer.from('3380aa278b744ba5b529a7f32fa803e48749280dae378345d9b526cf1dbce372', 'hex'),
        Buffer.from('cea9305c95168b162a335b137c61983b8df54e6375da01136547890f14c5fac3', 'hex'),
        Buffer.from('4beeace0e42bae8f29470cf40cf2dfacd5f4e1f751912bf52e803c8c85792193', 'hex'),
        Buffer.from('f8e5f6ebea90558eb32229da24fd0fb7d813091dafe89bb2954fda33b4c60f63', 'hex'),
        Buffer.from('81342f558a6273bac4548d473f54c4ffc7c41747dee81369acab9c787d41ab9c', 'hex'),
        Buffer.from('45635e6fc70486e2fd10d3c2b4780f02d0b4c5f4aa929fc54f86bb8fa4417944', 'hex'),
        Buffer.from('3d632a251c9820f2baf83e15498d27548fc67921cb437f8ce48505989378adea', 'hex')
    ],
    RST_KEYS: [
        'JN1k3YHc2.6_v235',
        'JN1k3YHc_2.7_v71',
        'JN1k3YHc2.7.ps69',
        'JN1k3YHc2.7.6950',
        'Jn1K3yHc2.8.ps08',
        'Jn1K3yHc2.9.ps6c',
        'Zk:L7>WKaiK*s9>D',
        '!<f!&WIlM**R.B0X',
        'b4a5opinx2uloec6'
    ],
    STATIC_NONCE: Buffer.alloc(8, 0xdb),
    RST_XOR_KEY: Buffer.from(Array.from({ length: 20 }, (_, i) => i + 2)),
    JKL_KEY_OLD: Buffer.from([0xd5, 0xd4, 0xd3, 0xd2, 0xd1, 0xd0, 0xcf, 0xce, 0xcd, 0xcc, 0xbd, 0xbc, 0xbb, 0xba, 0xb9, 0xb8, 0xb7, 0xb6, 0xb5, 0xb4]),
    JKL_KEY_NEW: Buffer.from([8, 9, 10, 11, 12, 13, 14, 15, 17, 17, 5, 4, 3, 2, 1, 0, 255, 254, 253, 252]),
    BRAILLE_ALPHABET: "⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵⠼⠁⠼⠃⠼⠉⠼⠙⠼⠑⠼⠋⠼⠛⠼⠓⠼⠊⠼⠚",
    TOKEN_MAP: {
        0: "payload",
        1: "proxy",
        2: "lockAllConfig",
        3: "blockedByRoot",
        4: "expiryTime",
        5: "noteEnabled",
        6: "notes",
        7: "sshField",
        8: "mobileDataAndLockProvider",
        9: "unlockUserAndPass",
        10: "ovpnConfig",
        11: "ovpnUserAndPass",
        12: "sni",
        13: "unlockUserAndPass2",
        15: "blockedByHwid",
        16: "cloudconfig",
        17: "psiphon",
        18: "name",
        19: "blockArea",
        20: "connectionMode",
        21: "blockedByPassword",
        23: "extraSniffer",
        25: "v2rayEnabled",
        26: "v2rayConfig",
        27: "version",
        28: "slowdnsEnabled",
        29: "slowdnsServer",
        30: "slowdnsPublickey",
        31: "dnsResolver"
    }
};

const EHI_CONSTANTS = {
    L1_KEY: Buffer.from('7e1210f7aab956f7a668bda6e57feddb7f84ad840aef8d27b1b969959be3ab6c', 'hex'),
    L2_KEY_STATIC: Buffer.from('b2bc617c32d8b9eb1943a5ffa8051eea', 'hex'),
    EOO_MASTER_KEY: Buffer.from('null=V5kU5+FFrY\x00'),
    STD_ALPHABET: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    CUSTOM_ALPHABET: "RkLC2QaVMPYgGJW/A4f7qzDb9e+t6Hr0Zp8OlNyjuxKcTw1o5EIimhBn3UvdSFXs",
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
    TRANSLATION_MAP: {}
};

for (let i = 0; i < EHI_CONSTANTS.CUSTOM_ALPHABET.length; i++) {
    EHI_CONSTANTS.TRANSLATION_MAP[EHI_CONSTANTS.CUSTOM_ALPHABET[i]] = EHI_CONSTANTS.STD_ALPHABET[i];
}

// ============================================================
// ALGORITHMES ÉMULÉS DE BAS NIVEAU (CRITICAL MATH LAYER)
// ============================================================

function chacha20Decrypt(key, nonce, data) {
    try {
        const decipher = crypto.createDecipheriv('chacha20', key, nonce);
        decipher.setAutoPadding(false);
        const skip = Buffer.alloc(64);
        decipher.update(skip);
        return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (e) {
        return null;
    }
}

function cleanJSON(textBytes) {
    if (!textBytes) return null;
    try {
        const text = textBytes.toString('utf-8').split('\x00')[0];
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            return JSON.parse(text.slice(start, end + 1));
        }
    } catch (e) {}
    return null;
}

function sanitizeField(key, value) {
    if (typeof value !== 'string') return value;
    let clean = value.replace(/[\x00-\x1F]/g, '');
    if (["ADDRESS", "DNS", "PROXY", "NSSERVER"].includes(key)) {
        const match = clean.match(/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/);
        return match ? match[0] : clean.replace(/[^a-zA-Z0-9._-]/g, '');
    }
    return clean.trim();
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
    } catch (e) {
        return null;
    }
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
    let y = v[0];

    while (sum !== 0) {
        const e = (sum >> 2) & 3;
        for (let p = n - 1; p > 0; p--) {
            const z = v[p - 1];
            const mx = (((z >> 5) ^ (y << 2)) + ((y >> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z));
            y = v[p] = (v[p] - mx) & 0xffffffff;
        }
        const z = v[n - 1];
        const mx = (((z >> 5) ^ (y << 2)) + ((y >> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(0 & 3) ^ e] ^ z));
        y = v[0] = (v[0] - mx) & 0xffffffff;
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
        function readUTF() {
            if (offset + 2 > fileBytes.length) return '';
            const len = fileBytes.readUInt16BE(offset);
            offset += 2;
            const res = fileBytes.slice(offset, offset + len).toString('utf-8');
            offset += len;
            return res;
        }
        readUTF();
        offset += 8;
        readUTF();
        offset += 8;
        if (offset + 4 > fileBytes.length) return null;
        const pLen = fileBytes.readUInt32BE(offset);
        offset += 4;
        offset += 8;
        return fileBytes.slice(offset, offset + pLen);
    } catch (e) {
        return null;
    }
}

function jklDecrypt(inputStr, isNew = false) {
    if (!inputStr) return inputStr;
    const activeKey = isNew ? HC_CONSTANTS.JKL_KEY_NEW : HC_CONSTANTS.JKL_KEY_OLD;
    try {
        let padded = inputStr;
        while (padded.length % 4 !== 0) padded += '=';
        const data = Buffer.from(padded, 'base64');
        const result = Buffer.alloc(data.length);
        for (let i = 0; i < data.length; i++) {
            const k = activeKey[i % 20];
            result[i] = (((data[i] ^ 0xff) & 0xca) | (data[i] & 0x35)) ^ (((k ^ 0xff) & 0xca) | (k & 0x35));
        }
        return Buffer.from(result.toString(), 'base64').toString('utf-8');
    } catch (e) {
        return inputStr;
    }
}

// ============================================================
// CLASSE CENTRALISÉE ET UNIFIÉE TDecryptor
// ============================================================

class TDecryptor {
    
    // --- 1. SCRIPT DE SÉCURITÉ SSC CUSTOM ---
    static decryptSSC(fileBytes) {
        try {
            let content = fileBytes.toString('utf-8').trim();
            if (content.startsWith('ssc://')) {
                content = content.slice(6).split('').reverse().join('');
            }
            const l1Data = chacha20Decrypt(
                SSC_CONSTANTS.L1_KEY,
                SSC_CONSTANTS.FIXED_NONCE,
                Buffer.from(content, 'hex')
            );
            const l1Json = cleanJSON(l1Data);
            if (!l1Json) return null;
            
            let targetJson = l1Json;
            if (l1Json.c && typeof l1Json.a === 'string') {
                const l2Nonce = Buffer.from(l1Json.a.slice(0, 16), 'hex');
                const l2Data = chacha20Decrypt(
                    SSC_CONSTANTS.L2_KEY,
                    l2Nonce,
                    Buffer.from(l1Json.c, 'hex')
                );
                targetJson = cleanJSON(l2Data) || l1Json;
            }
            return JSON.stringify(targetJson, null, 4);
        } catch (e) {
            return null;
        }
    }

    // --- 2. SCRIPT DE SÉCURITÉ DARK TUNNEL ---
    static decryptDarkTunnel(fileBytes) {
        try {
            let raw = fileBytes.toString('utf-8').trim();
            if (raw.includes("://")) {
                raw = raw.split("://")[1];
            }
            
            let cleanB64 = raw.replace(/-/g, '+').replace(/_/g, '/');
            while (cleanB64.length % 4 !== 0) cleanB64 += '=';
            
            const outer = JSON.parse(Buffer.from(cleanB64, 'base64').toString('utf-8'));
            const encrypted = Buffer.from(outer.encryptedLockedConfig, 'base64');
            
            const decipher = crypto.createDecipheriv(
                'aes-256-cfb',
                Buffer.from("$B&E)H@McQfThWmZq4t7w!z%C*F-JaNd"),
                Buffer.from("232e39185523184a5723586242200e05", 'hex')
            );
            const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
            return plain.toString('utf-8');
        } catch (e) {
            return null;
        }
    }

    // --- 3. SCRIPT DE SÉCURITÉ HTTP CUSTOM ---
    static decryptHTTPCustom(fileBytes) {
        try {
            const xorKey = Buffer.from("e382e4b8adc386f09f9293", 'hex');
            const xorData = Buffer.alloc(fileBytes.length);
            for (let i = 0; i < fileBytes.length; i++) {
                xorData[i] = fileBytes[i] ^ xorKey[i % xorKey.length];
            }
            
            const outerData = chacha20Decrypt(
                HC_CONSTANTS.CHACHA_KEYS[5],
                HC_CONSTANTS.STATIC_NONCE,
                Buffer.from(xorData.toString('utf-8'), 'hex')
            );
            
            const jsonObj = JSON.parse(outerData.toString('utf-8'));
            const cfgObj = jsonObj.cfg || {};
            
            let xyDec = chacha20Decrypt(
                HC_CONSTANTS.CHACHA_KEYS[1],
                HC_CONSTANTS.STATIC_NONCE,
                Buffer.from(jsonObj.xy || cfgObj.content, 'hex')
            );
            
            const tokens = xyDec.toString('utf-8').split("[splitConfig]");
            const configData = {};
            
            for (let i = 0; i < tokens.length; i++) {
                const label = HC_CONSTANTS.TOKEN_MAP[i] || `field_${i}`;
                configData[label] = jklDecrypt(tokens[i], false);
            }
            
            return JSON.stringify({ Config: configData }, null, 4);
        } catch (e) {
            return null;
        }
    }

    // --- 4. SCRIPT DE SÉCURITÉ HTTP INJECTOR ---
    static async decryptHTTPInjector(fileBytes) {
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
                        const c2 = crypto.createDecipheriv(
                            'aes-128-cbc',
                            EHI_CONSTANTS.L2_KEY_STATIC,
                            Buffer.from(parts[0], 'base64')
                        );
                        const garbage = Buffer.concat([
                            c2.update(Buffer.from(parts[2], 'base64')),
                            c2.final()
                        ]);
                        const finalRaw = xxteaDecrypt(garbage, EHI_CONSTANTS.EOO_MASTER_KEY);
                        config = JSON.parse(finalRaw.slice(finalRaw.indexOf('{')).toString('utf-8'));
                        matchedIv = iv;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!config) return null;

            if (!EHI_CONSTANTS.BYPASS_IVS.some(iv => iv.equals(matchedIv)) && config.configData) {
                const aaaResult = ehiDecryptXorLayer(config.configData, config.configSalt || 'EVZJNI');
                const rawPayload = Buffer.from(aaaResult, 'base64');
                
                const masterKeyPayload = [
                    config.configAesKey,
                    config.configIdentifier,
                    config.configSalt
                ].filter(Boolean).join('');
                
                const masterKey = crypto.createHash('sha256').update(masterKeyPayload).digest();

                // DÉRIVATION ARGON2ID STRICTEMENT IDENTIQUE À PYTHON
                const argonKey = await argon2.hash(masterKey, {
                    salt: rawPayload.slice(0x0a, 0x1a),
                    timeCost: rawPayload.readUInt32LE(1),
                    memoryCost: rawPayload.readUInt32LE(5),
                    parallelism: rawPayload[9],
                    hashLength: 32,
                    type: argon2.argon2id,
                    raw: true
                });

                const decipher = crypto.createDecipheriv(
                    'chacha20-poly1305',
                    argonKey,
                    rawPayload.slice(0x1a, 0x32),
                    { authTagLength: 16 }
                );
                
                decipher.setAAD(rawPayload.slice(0, 0x1a));
                decipher.setAuthTag(rawPayload.slice(-16));
                
                const decrypted = Buffer.concat([
                    decipher.update(rawPayload.slice(0x32, -16)),
                    decipher.final()
                ]);
                
                return JSON.stringify(JSON.parse(decrypted.toString('utf-8')), null, 4);
            }
            
            return JSON.stringify(config, null, 4);
        } catch (e) {
            return null;
        }
    }

    // --- 5. SCRIPT DE SÉCURITÉ NPV TUNNEL ---
    static decryptNPVTunnel(fileBytes) {
        try {
            let content = fileBytes.toString('utf-8').trim();
            if (content.startsWith('NPVTSUB1')) {
                content = content.slice(8).trim();
            }
            if (content.startsWith('NPVT1')) {
                content = content.slice(5).trim();
            }
            
            const parts = content.split(',');
            const cleanBytes = Buffer.from(parts[1], 'base64');
            return cleanBytes.toString('utf-8');
        } catch (e) {
            return null;
        }
    }

    // --- 6. PARSING CLOUD DES LIENS EHI.LINK ---
    static async downloadAndDecryptEhiLink(url) {
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            
            const html = await response.text();
            const root = parse(html);
            const downloadBtn = root.querySelector('a[href*=".ehi"]');
            
            if (!downloadBtn) return null;
            
            let fileUrl = downloadBtn.getAttribute('href');
            if (!fileUrl.startsWith('http')) {
                fileUrl = `https://ehi.link${fileUrl}`;
            }
            
            const fileResponse = await fetch(fileUrl);
            return await this.decryptHTTPInjector(await fileResponse.buffer());
        } catch (e) {
            return null;
        }
    }
}

export { TDecryptor };