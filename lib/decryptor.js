import crypto from 'crypto';
import argon2 from 'argon2';

// ============================================================
// 1. SSCCUSTOM DECRYPTOR
// ============================================================

const SSC_CONSTANTS = {
    FIXED_NONCE: Buffer.from('f7479d9f87f3d074', 'hex'),
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
    },
    ENCRYPTED_FIELDS: new Set(["g", "h", "l", "o", "p", "v", "x", "i", "w"])
};

function chacha20Decrypt(key, nonce, data) {
    try {
        const cipher = crypto.createDecipheriv('chacha20', key, nonce);
        const skip = Buffer.alloc(64);
        cipher.update(skip);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    } catch (e) {
        return null;
    }
}

function decodeCString(b) {
    if (!b || b.length === 0) return "";
    const idx = b.indexOf(0);
    const str = idx !== -1 ? b.slice(0, idx) : b;
    return str.toString('utf-8');
}

function sanitizeField(key, value) {
    if (typeof value !== 'string') return value;
    value = value.replace(/[\x00-\x1F]/g, '');
    if (["ADDRESS", "DNS", "H", "NSSERVER"].includes(key)) {
        const match = value.match(/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/);
        return match ? match[0] : value.replace(/[^a-zA-Z0-9._-]/g, '');
    }
    if (["USERNAME", "PASSWORD"].includes(key)) {
        if (/^[a-zA-Z0-9]+$/.test(value)) return value;
        const match = value.match(/^[a-zA-Z0-9!@#$%^&*()._-]+/);
        return match ? match[0] : value;
    }
    if (key === "PAYLOAD") {
        return value.includes("[crlf]") ? value.split("\x00")[0] : value.trim();
    }
    return value.trim();
}

function deriveInnerNonce(userKey) {
    if (!userKey || userKey.length !== 32) return null;
    const reversed = userKey.slice(16, 32).split('').reverse().join('');
    const hex = `${reversed}68${userKey.slice(0, 16)}`;
    return Buffer.from(hex.slice(0, 16), 'hex');
}

function cleanJSON(textBytes) {
    if (!textBytes || textBytes.length === 0) return null;
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

function processConfigs(jsonObj) {
    if (!jsonObj.a || !Array.isArray(jsonObj.a)) return jsonObj;
    const processed = [];
    for (const item of jsonObj.a) {
        const userKey = item.b;
        if (userKey) {
            const innerNonce = deriveInnerNonce(userKey);
            if (innerNonce) {
                for (const field of SSC_CONSTANTS.ENCRYPTED_FIELDS) {
                    if (item[field] && typeof item[field] === 'string' && item[field].length > 16) {
                        try {
                            const encVal = Buffer.from(item[field], 'hex');
                            const decBytes = chacha20Decrypt(SSC_CONSTANTS.L3_KEY, innerNonce, encVal);
                            if (decBytes) {
                                const plain = decodeCString(decBytes);
                                if (["l", "v", "w", "h"].includes(field)) {
                                    item[field] = plain.replace(/[^a-zA-Z0-9._:-]/g, '');
                                } else {
                                    item[field] = plain;
                                }
                            }
                        } catch (e) {}
                    }
                }
            }
        }
        const newItem = {};
        for (const [k, v] of Object.entries(item)) {
            const newKey = SSC_CONSTANTS.KEY_MAP[k] || k;
            const newVal = sanitizeField(newKey, v);
            if (newVal !== "" || !SSC_CONSTANTS.ENCRYPTED_FIELDS.has(k)) {
                newItem[newKey] = newVal;
            }
        }
        processed.push(newItem);
    }
    jsonObj.a = processed;
    return jsonObj;
}

export function decryptSSC(fileBytes) {
    try {
        let content = fileBytes.toString('utf-8').trim();
        if (content.startsWith('ssc://')) {
            content = content.slice(6).split('').reverse().join('');
        }
        const cipherHex = content.replace(/\s/g, '');
        if (cipherHex.length % 2 !== 0) return null;
        const l1Data = chacha20Decrypt(SSC_CONSTANTS.L1_KEY, SSC_CONSTANTS.FIXED_NONCE, Buffer.from(cipherHex, 'hex'));
        if (!l1Data) return null;
        const l1Json = cleanJSON(l1Data);
        if (!l1Json) return null;
        let targetJson = null;
        if (l1Json.c && typeof l1Json.a === 'string') {
            const l2Nonce = Buffer.from(l1Json.a.slice(0, 16), 'hex');
            const l2Data = chacha20Decrypt(SSC_CONSTANTS.L2_KEY, l2Nonce, Buffer.from(l1Json.c, 'hex'));
            if (l2Data) {
                const l2Json = cleanJSON(l2Data);
                if (l2Json) {
                    targetJson = {};
                    for (const [k, v] of Object.entries(l2Json)) {
                        const newKey = SSC_CONSTANTS.KEY_MAP[k] || k;
                        targetJson[newKey] = k !== "a" ? sanitizeField(newKey, v) : v;
                    }
                }
            }
        } else if (l1Json.a && Array.isArray(l1Json.a)) {
            targetJson = l1Json;
        }
        if (targetJson) {
            const finalStruct = processConfigs(targetJson);
            const finalObj = {};
            for (const [k, v] of Object.entries(finalStruct)) {
                const newKey = SSC_CONSTANTS.KEY_MAP[k] || k;
                finalObj[newKey] = (k === "a" || k === "CONFIGS") ? v : sanitizeField(newKey, v);
            }
            return `SSC SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(finalObj, null, 4)}\n\n${'='.repeat(30)}\ncode : @SSC_DECRYPTOR`;
        }
        return null;
    } catch (e) {
        console.error('SSC decrypt error:', e);
        return null;
    }
}

// ============================================================
// 2. DARKTUNNEL DECRYPTOR
// ============================================================

const DT_CONSTANTS = {
    KEY_256: Buffer.from("$B&E)H@McQfThWmZq4t7w!z%C*F-JaNd"),
    KEY_192: Buffer.from("F)J@NcRfUjXn2r4u7x!A%D*G"),
    IV: Buffer.from("232e39185523184a5723586242200e05", 'hex')
};

function base64DecodeSafe(data) {
    let clean = data.replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4 !== 0) clean += '=';
    return Buffer.from(clean, 'base64');
}

function aesCfbDecrypt(data, key, iv) {
    try {
        const decipher = crypto.createDecipheriv('aes-256-cfb', key, iv);
        decipher.setAutoPadding(false);
        return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (e) {
        return null;
    }
}

function normalizeForJson(value) {
    if (Array.isArray(value)) {
        return value.map(v => normalizeForJson(v));
    }
    if (value && typeof value === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            if (k === "Password") continue;
            result[k] = normalizeForJson(v);
        }
        return result;
    }
    if (Buffer.isBuffer(value)) {
        try {
            const str = value.toString('utf-8');
            return JSON.parse(str) || str;
        } catch (e) {
            return value.toString('hex');
        }
    }
    return value;
}

export function decryptDarkTunnel(fileBytes) {
    try {
        let raw = fileBytes.toString('utf-8').trim();
        if (!raw) return null;
        if (raw.includes("://")) {
            raw = raw.split("://")[1];
        }
        const outer = JSON.parse(base64DecodeSafe(raw).toString('utf-8'));
        if (!outer.encryptedLockedConfig) return null;
        const encrypted = base64DecodeSafe(outer.encryptedLockedConfig);
        const decryptedOuter = aesCfbDecrypt(encrypted, DT_CONSTANTS.KEY_256, DT_CONSTANTS.IV);
        if (!decryptedOuter) return null;
        let unpackedOuter = JSON.parse(decryptedOuter.toString('utf-8'));
        if (unpackedOuter.EncryptedLockedConfig) {
            const decryptedInner = aesCfbDecrypt(unpackedOuter.EncryptedLockedConfig, DT_CONSTANTS.KEY_192, DT_CONSTANTS.IV);
            if (decryptedInner) {
                unpackedOuter.EncryptedLockedConfig = JSON.parse(decryptedInner.toString('utf-8'));
            }
        }
        outer.encryptedLockedConfig = normalizeForJson(unpackedOuter);
        const normalized = normalizeForJson(outer);
        return `DARK TUNNEL SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(normalized, null, 4)}\n\n${'='.repeat(30)}\ncode : @DARK_TUNNEL`;
    } catch (e) {
        console.error('DarkTunnel decrypt error:', e);
        return null;
    }
}

// ============================================================
// 3. HTTPCUSTOM DECRYPTOR
// ============================================================

const HC_CONSTANTS = {
    CHACHA_KEYS: [
        '2be4342943c6f91ff58987f41a1aafd179eeb4e053f5cea55b11d6a7db58bd7d',
        '3380aa278b744ba5b529a7f32fa803e48749280dae378345d9b526cf1dbce372',
        'cea9305c95168b162a335b137c61983b8df54e6375da01136547890f14c5fac3',
        '4beeace0e42bae8f29470cf40cf2dfacd5f4e1f751912bf52e803c8c85792193',
        'f8e5f6ebea90558eb32229da24fd0fb7d813091dafe89bb2954fda33b4c60f63',
        '81342f558a6273bac4548d473f54c4ffc7c41747dee81369acab9c787d41ab9c',
        '45635e6fc70486e2fd10d3c2b4780f02d0b4c5f4aa929fc54f86bb8fa4417944',
        '3d632a251c9820f2baf83e15498d27548fc67921cb437f8ce48505989378adea'
    ],
    RST_KEYS: [
        'JN1k3YHc2.6_v235', 'JN1k3YHc_2.7_v71', 'JN1k3YHc2.7.ps69',
        'JN1k3YHc2.7.6950', 'Jn1K3yHc2.8.ps08', 'Jn1K3yHc2.9.ps6c',
        'Zk:L7>WKaiK*s9>D', '!<f!&WIlM**R.B0X', 'b4a5opinx2uloec6'
    ],
    STATIC_NONCE: Buffer.from('dbdbdbdbdbdbdbdb', 'hex'),
    RST_XOR_KEY: Buffer.from([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
    JKL_KEY_OLD: Buffer.from([0xd5, 0xd4, 0xd3, 0xd2, 0xd1, 0xd0, 0xcf, 0xce, 0xcd, 0xcc, 0xbd, 0xbc, 0xbb, 0xba, 0xb9, 0xb8, 0xb7, 0xb6, 0xb5, 0xb4]),
    JKL_KEY_NEW: Buffer.from([8, 9, 10, 11, 12, 13, 14, 15, 17, 17, 5, 4, 3, 2, 1, 0, 255, 254, 253, 252])
};

function hcChachaDecrypt(data, key, nonce) {
    try {
        const cipher = crypto.createDecipheriv('chacha20', Buffer.from(key, 'hex'), nonce);
        const skip = Buffer.alloc(64);
        cipher.update(skip);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    } catch (e) {
        return null;
    }
}

function rstDecrypt(encryptedStr) {
    try {
        const bytes = Buffer.from(encryptedStr, 'utf-8');
        const xored = Buffer.alloc(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            xored[i] = bytes[i] ^ HC_CONSTANTS.RST_XOR_KEY[i % 20];
        }
        const aesCiphertext = Buffer.from(xored.toString(), 'base64');
        for (const key of HC_CONSTANTS.RST_KEYS) {
            try {
                const decipher = crypto.createDecipheriv('aes-256-ecb', Buffer.from(key), Buffer.alloc(0));
                decipher.setAutoPadding(true);
                const decrypted = Buffer.concat([decipher.update(aesCiphertext), decipher.final()]);
                const decStr = decrypted.toString('utf-8');
                if (decStr.includes('[splitConfig]')) {
                    return decStr;
                }
            } catch (e) {}
        }
        return null;
    } catch (e) {
        return null;
    }
}

function cleanHex(rawStr) {
    if (!rawStr) return "";
    const clean = rawStr.replace(/[^0-9a-fA-F]/g, '');
    return clean.length % 2 !== 0 ? '0' + clean : clean;
}

function isHex(s) {
    return s && s.length >= 16 && /^[0-9a-fA-F]+$/.test(s);
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

function isMostlyPrintable(s, strict = false) {
    if (!s || s.length < 4) return false;
    const printable = s.split('').filter(c => c.charCodeAt(0) >= 32 || c === '\t' || c === '\n' || c === '\r').length;
    return (printable / s.length) > (strict ? 0.90 : 0.80);
}

function extractZ3a(data, iv) {
    if (!data) return "";
    const result = [];
    const matches = data.matchAll(/(-?\d+)\.(-?\d+)/g);
    for (const match of matches) {
        const val1 = parseInt(match[1]) - iv;
        const val2 = parseInt(match[2]) - iv;
        if (val2 >= 0 && (1 << val2) !== 0) {
            result.push((val1 / (1 << val2)) % 256);
        }
    }
    return Buffer.from(result).toString('utf-8');
}

function decryptBraille(ciphertext) {
    const BRAILLE_ALPHABET = "⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵⠼⠁⠼⠃⠼⠉⠼⠙⠼⠑⠼⠋⠼⠛⠼⠓⠼⠊⠼⠚";
    try {
        const result = [];
        for (let i = 0; i < ciphertext.length - 1; i += 2) {
            const idx1 = BRAILLE_ALPHABET.indexOf(ciphertext[i]);
            const idx2 = BRAILLE_ALPHABET.indexOf(ciphertext[i + 1]);
            if (idx1 !== -1 && idx2 !== -1) {
                result.push((idx1 * 16 + idx2) & 255);
            }
        }
        return Buffer.from(result).toString('utf-8');
    } catch (e) {
        return ciphertext;
    }
}

function processCredentials(rawVal, isSsh = false) {
    if (!rawVal) return rawVal;
    if (isSsh && rawVal[0] && "⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵⠼".includes(rawVal[0])) {
        rawVal = decryptBraille(rawVal);
    }
    const pattern = isSsh ? /^([\w\.-]+):([\d\-]+)@(.+):(.+)$/ : /^([^:]+):(.+)$/;
    const match = rawVal.match(pattern);
    if (match) {
        const groups = match.slice(1);
        const uEnc = groups[isSsh ? 2 : 0];
        const pEnc = groups[isSsh ? 3 : 1];
        const uDec = extractZ3a(uEnc, (uEnc.match(/(-?\d+)\.(-?\d+)/g) || []).length);
        const pDec = extractZ3a(pEnc, (pEnc.match(/(-?\d+)\.(-?\d+)/g) || []).length);
        const finalUser = uDec || uEnc;
        const finalPass = pDec || pEnc;
        if (isSsh) {
            return `${groups[0]}:${groups[1]}@${finalUser}:${finalPass}`;
        }
        return `${finalUser}:${finalPass}`;
    }
    return rawVal;
}

function decryptField(token, dynamicNonce) {
    if (!token || token === "true" || token === "false" || token === "lifeTime" || token === "[splitPsiphon][splitPsiphon]" || token.startsWith("<")) {
        return token;
    }
    const candidates = [];
    const cleanH = cleanHex(token);
    if (isHex(cleanH) && cleanH.length >= 32) {
        try { candidates.push(Buffer.from(cleanH, 'hex')); } catch (e) {}
    }
    if (token.length > 16) {
        try { candidates.push(Buffer.from(token, 'latin1')); } catch (e) {}
        try { candidates.push(Buffer.from(token, 'utf-8')); } catch (e) {}
    }
    const uniqueCands = [...new Set(candidates.map(b => b.toString('hex')))].map(h => Buffer.from(h, 'hex'));
    for (const dataBytes of uniqueCands.filter(b => b.length > 16)) {
        const ciphertext = dataBytes.slice(0, -16);
        for (const chachaKey of HC_CONSTANTS.CHACHA_KEYS) {
            try {
                const cipher = crypto.createDecipheriv('chacha20', Buffer.from(chachaKey, 'hex'), dynamicNonce);
                const skip = Buffer.alloc(64);
                cipher.update(skip);
                const decStr = Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf-8');
                for (const isNew of [true, false]) {
                    const out = jklDecrypt(decStr, isNew);
                    if (out && out !== decStr && isMostlyPrintable(out)) {
                        return out;
                    }
                }
                if (isMostlyPrintable(decStr, true) && (decStr.includes("HTTP") || decStr.includes("@") || decStr.includes(":") || decStr.includes("{")) || /^[a-zA-Z0-9]+$/.test(decStr)) {
                    return decStr;
                }
            } catch (e) {}
        }
    }
    for (const isNew of [true, false]) {
        const out = jklDecrypt(token, isNew);
        if (out && out !== token && isMostlyPrintable(out)) {
            return out;
        }
    }
    return token;
}

export function decryptHTTPCustom(fileBytes) {
    try {
        const content = fileBytes.toString('utf-8').trim();
        if (!content) return null;
        const hexKey = 'e382e4b8adc386f09f9293';
        const keyBytes = Buffer.from(hexKey, 'hex');
        let encryptedData;
        try {
            encryptedData = Buffer.from(content, 'latin1');
        } catch (e) {
            encryptedData = fileBytes;
        }
        const xorData = Buffer.alloc(encryptedData.length);
        for (let i = 0; i < encryptedData.length; i++) {
            xorData[i] = encryptedData[i] ^ keyBytes[i % keyBytes.length];
        }
        const hexPayload = xorData.toString('utf-8');
        if (!hexPayload) return null;
        const outerData = hcChachaDecrypt(Buffer.from(hexPayload, 'hex'), HC_CONSTANTS.CHACHA_KEYS[5], HC_CONSTANTS.STATIC_NONCE);
        if (!outerData) return null;
        const outerStr = outerData.toString('utf-8');
        if (!outerStr.startsWith('{')) return null;
        const jsonObj = JSON.parse(outerStr);
        const cfgObj = jsonObj.cfg || {};
        const isNewFormat = typeof cfgObj === 'object' && cfgObj !== null && 'content' in cfgObj;
        const protections = {};
        let targetCipher = null;
        let splitDelim = null;
        if (isNewFormat) {
            if (jsonObj.b) protections.hwid = String(jsonObj.b);
            if (jsonObj.f) protections.area = String(jsonObj.f);
            targetCipher = cfgObj.content || null;
            splitDelim = "[splitConfig]";
        } else {
            const objA = typeof jsonObj.a === 'object' && jsonObj.a !== null ? jsonObj.a : {};
            if (jsonObj.bb) {
                const decVal = hcChachaDecrypt(Buffer.from(String(jsonObj.bb), 'hex'), HC_CONSTANTS.CHACHA_KEYS[7], HC_CONSTANTS.STATIC_NONCE);
                if (decVal) protections.hwid = decVal.toString('utf-8');
            }
            if (jsonObj.e) {
                const decVal = hcChachaDecrypt(Buffer.from(String(jsonObj.e), 'hex'), HC_CONSTANTS.CHACHA_KEYS[7], HC_CONSTANTS.STATIC_NONCE);
                if (decVal) protections.password = decVal.toString('utf-8');
            }
            if (objA.fe) {
                const decVal = hcChachaDecrypt(Buffer.from(String(objA.fe), 'hex'), HC_CONSTANTS.CHACHA_KEYS[7], HC_CONSTANTS.STATIC_NONCE);
                if (decVal) protections.area = decVal.toString('utf-8');
            }
            if (objA.ed) {
                const decVal = hcChachaDecrypt(Buffer.from(String(objA.ed), 'hex'), HC_CONSTANTS.CHACHA_KEYS[7], HC_CONSTANTS.STATIC_NONCE);
                if (decVal) protections.provider = decVal.toString('utf-8');
            }
            targetCipher = jsonObj.xy || objA.xy || null;
            splitDelim = jsonObj.uv || objA.uv || null;
        }
        if (!targetCipher || !splitDelim) {
            return `HTTP CUSTOM SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(jsonObj, null, 4)}\n\n${'='.repeat(30)}\ncode : @HTTP_CUSTOM`;
        }
        let xyDec = null;
        if (isNewFormat) {
            xyDec = rstDecrypt(String(targetCipher));
            if (!xyDec) {
                for (const key of HC_CONSTANTS.CHACHA_KEYS) {
                    const temp = hcChachaDecrypt(Buffer.from(String(targetCipher), 'hex'), key, HC_CONSTANTS.STATIC_NONCE);
                    if (temp && temp.toString('utf-8').includes(String(splitDelim))) {
                        xyDec = temp.toString('utf-8');
                        break;
                    }
                }
            }
        } else {
            const temp = hcChachaDecrypt(Buffer.from(String(targetCipher), 'hex'), HC_CONSTANTS.CHACHA_KEYS[1], HC_CONSTANTS.STATIC_NONCE);
            if (temp) xyDec = temp.toString('utf-8');
        }
        if (!xyDec) {
            return `HTTP CUSTOM SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(jsonObj, null, 4)}\n\n${'='.repeat(30)}\ncode : @HTTP_CUSTOM`;
        }
        const TOKEN_MAP = {
            0: "payload", 1: "proxy", 2: "lockAllConfig", 3: "blockedByRoot",
            4: "expiryTime", 5: "noteEnabled", 6: "notes", 7: "sshField",
            8: "mobileDataAndLockProvider", 9: "unlockUserAndPass", 10: "ovpnConfig",
            11: "ovpnUserAndPass", 12: "sni", 13: "unlockUserAndPass2",
            14: "unknown14", 15: "blockedByHwid", 16: "cloudconfig",
            17: "psiphon", 18: "name", 19: "blockArea",
            20: "connectionMode", 21: "blockedByPassword", 22: "unknown22",
            23: "extraSniffer", 24: "psiphon2", 25: "v2rayEnabled",
            26: "v2rayConfig", 27: "version", 28: "slowdnsEnabled",
            29: "slowdnsServer", 30: "slowdnsPublickey", 31: "dnsResolver"
        };
        const h = protections.hwid || '';
        const p = protections.password || '';
        const pr = protections.provider || '';
        const a = protections.area || '';
        let derivedHex = '';
        if (h && !p && !pr && !a) {
            derivedHex = Buffer.from(h).toString('hex').repeat(2);
        } else {
            derivedHex = Buffer.from(p).toString('hex') + Buffer.from(h).toString('hex') + Buffer.from(pr).toString('hex') + Buffer.from(a).toString('hex');
        }
        const dynamicNonce = Buffer.from(HC_CONSTANTS.STATIC_NONCE);
        if (derivedHex) {
            try {
                const derivedBytes = Buffer.from(derivedHex, 'hex');
                for (let i = 0; i < Math.min(derivedBytes.length, 8); i++) {
                    dynamicNonce[i] = derivedBytes[i];
                }
            } catch (e) {}
        }
        const configData = {};
        const tokens = xyDec.split(String(splitDelim));
        for (let i = 0; i < tokens.length; i++) {
            if (i === 22 || i === 24) continue;
            const label = TOKEN_MAP[i] || `field_${i}`;
            let token = tokens[i];
            if (isNewFormat) {
                token = decryptField(token, dynamicNonce);
            } else {
                if (isHex(token)) {
                    const dec = hcChachaDecrypt(Buffer.from(token, 'hex'), HC_CONSTANTS.CHACHA_KEYS[7], dynamicNonce);
                    if (dec) token = dec.toString('utf-8');
                }
                token = jklDecrypt(token, false);
            }
            if (i === 7) token = processCredentials(token, true);
            else if (i === 11) token = processCredentials(token, false);
            if (token) {
                if (typeof token === 'string') {
                    token = token.replace("88a05e8772eac3e5703e0cd26c6e6f23de72fb09f7ee5a43283d1681f19d", "");
                    try {
                        if (token.startsWith('{') || token.startsWith('[')) {
                            token = JSON.parse(token);
                        }
                    } catch (e) {}
                }
                if (!(typeof token === 'string' && isHex(token))) {
                    configData[label] = token;
                }
            }
        }
        const result = { Protections: protections, Config: configData };
        return `HTTP CUSTOM SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(result, null, 4)}\n\n${'='.repeat(30)}\ncode : @HTTP_CUSTOM`;
    } catch (e) {
        console.error('HTTPCustom decrypt error:', e);
        return null;
    }
}

// ============================================================
// 4. HTTPINJECTOR DECRYPTOR (COMPLET)
// ============================================================

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
    ]
};

function ehiCustomB64Decode(str) {
    let clean = str.replace(/\?/g, '');
    while (clean.length % 4 !== 0) clean += '=';
    const translated = clean.split('').map(c => {
        const idx = EHI_CONSTANTS.CUSTOM_ALPHABET.indexOf(c);
        return idx !== -1 ? EHI_CONSTANTS.STD_ALPHABET[idx] : c;
    }).join('');
    return Buffer.from(translated, 'base64');
}

function ehiDecryptXorLayer(ciphertextStr, key) {
    if (!ciphertextStr || !ciphertextStr.trim()) return null;
    try {
        const hexBytesRaw = ehiCustomB64Decode(ciphertextStr.split('').reverse().join(''));
        const hexString = hexBytesRaw.toString('ascii');
        if (hexString.length % 2 !== 0) return null;
        const rawBytes = Buffer.from(hexString, 'hex');
        const keyBytes = Buffer.from(key);
        const result = Buffer.alloc(rawBytes.length);
        let nonZeroCount = 0;
        for (let i = 0; i < rawBytes.length; i++) {
            const val = rawBytes[i] ^ keyBytes[i % keyBytes.length];
            if (val !== 0) {
                result[nonZeroCount++] = val;
            }
        }
        const final = result.slice(0, nonZeroCount);
        const plaintext = final.toString('utf-8');
        if (plaintext && (plaintext.split('').filter(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0))).length / plaintext.length) > 0.5) {
            return null;
        }
        return plaintext;
    } catch (e) {
        return null;
    }
}

function ehiAesCbcDecrypt(key, iv, data) {
    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(true);
        return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (e) {
        return null;
    }
}

function ehiXxteaDecrypt(data, key) {
    if (!data || data.length === 0) return Buffer.alloc(0);
    if (data.length % 4 !== 0) {
        const pad = 4 - (data.length % 4);
        data = Buffer.concat([data, Buffer.alloc(pad)]);
    }
    const k = [];
    const keyBuf = Buffer.alloc(16);
    key.copy(keyBuf, 0, 0, Math.min(key.length, 16));
    for (let i = 0; i < 4; i++) k.push(keyBuf.readUInt32LE(i * 4));
    const n = data.length / 4;
    const v = [];
    for (let i = 0; i < n; i++) v.push(data.readUInt32LE(i * 4));
    const delta = 0x9e3779b9;
    let sum = ((6 + 52 / n) * delta) & 0xffffffff;
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
    if (length > 0 && length <= n * 4) {
        return result.slice(0, length);
    }
    return result;
}

function ehiParseBytes(fileBytes) {
    try {
        let offset = 0;
        function readUTF() {
            if (offset + 2 > fileBytes.length) return '';
            const len = fileBytes.readUInt16BE(offset);
            offset += 2;
            if (offset + len > fileBytes.length) return '';
            const result = fileBytes.slice(offset, offset + len).toString('utf-8');
            offset += len;
            return result;
        }
        readUTF();
        offset += 8;
        readUTF();
        offset += 8;
        if (offset + 4 > fileBytes.length) return null;
        const pLen = fileBytes.readUInt32BE(offset);
        offset += 4;
        offset += 8;
        if (offset + pLen > fileBytes.length) return null;
        return fileBytes.slice(offset, offset + pLen);
    } catch (e) {
        return null;
    }
}

function ehiGenerateMasterKey(config) {
    const payload = [
        config.configAesKey || '',
        config.configIdentifier || '',
        config.configSalt || '',
        String(config.configTimestamp || 0),
        String(config.configExpiryTimestamp || 0),
        config.lockModes || '',
        config.lockModesHash || '',
        config.configHwid || '',
        config.configLockMobileOperatorId || ''
    ].filter(Boolean).join('');
    return crypto.createHash('sha256').update(payload).digest();
}

function ehiDecodeConfigMessage(ciphertextStr) {
    if (!ciphertextStr || !ciphertextStr.trim()) return ciphertextStr;
    try {
        let padded = ciphertextStr;
        while (padded.length % 4 !== 0) padded += '=';
        const rawBytes = Buffer.from(padded, 'base64');
        const utf16Str = rawBytes.toString('utf-8');
        const key = "EHIMSG";
        const result = [];
        for (let i = 0; i < utf16Str.length; i++) {
            const code = utf16Str.charCodeAt(i);
            result.push(code ^ key.charCodeAt(i % key.length));
        }
        return String.fromCharCode(...result);
    } catch (e) {
        return ciphertextStr;
    }
}

function ehiDecodeInnerFields(parsedJson, saltKey) {
    const cleaned = {};
    const vitalKeys = new Set(["overwriteServerData"]);
    for (const [k, v] of Object.entries(parsedJson)) {
        if (typeof v === 'string' && v.trim()) {
            let decryptedVal = null;
            if (k === "configMessage") {
                decryptedVal = ehiDecodeConfigMessage(v);
            } else {
                decryptedVal = ehiDecryptXorLayer(v, saltKey);
            }
            if (decryptedVal !== null) {
                cleaned[k] = decryptedVal;
            } else if (vitalKeys.has(k)) {
                cleaned[k] = v;
            }
        } else {
            cleaned[k] = v;
        }
    }
    return cleaned;
}

export async function decryptHTTPInjector(fileBytes) {
    try {
        // Étape 1: Parser le fichier EHI
        const payload = ehiParseBytes(fileBytes);
        if (!payload) {
            return decryptHTTPInjectorFallback(fileBytes);
        }

        // Étape 2: Décrypter avec les IVs
        let config = null;
        let matchedIv = null;
        const allIVs = [...EHI_CONSTANTS.BYPASS_IVS, ...EHI_CONSTANTS.STANDARD_IVS];

        for (const iv of allIVs) {
            try {
                const decrypted = ehiAesCbcDecrypt(EHI_CONSTANTS.L1_KEY, iv, payload);
                if (!decrypted) continue;
                
                const l1Text = decrypted.toString('utf-8');
                const parts = l1Text.split(':');
                if (parts.length >= 3) {
                    const iv2 = Buffer.from(parts[0], 'base64');
                    const garbage = ehiAesCbcDecrypt(
                        EHI_CONSTANTS.L2_KEY_STATIC, 
                        iv2, 
                        Buffer.from(parts[2], 'base64')
                    );
                    if (!garbage) continue;
                    
                    const finalRaw = ehiXxteaDecrypt(garbage, EHI_CONSTANTS.EOO_MASTER_KEY);
                    if (!finalRaw || finalRaw.length === 0) continue;
                    
                    const start = finalRaw.indexOf('{');
                    if (start !== -1) {
                        const jsonStr = finalRaw.slice(start).toString('utf-8');
                        config = JSON.parse(jsonStr);
                        matchedIv = iv;
                        break;
                    }
                }
            } catch (e) {
                continue;
            }
        }

        if (!config) {
            return decryptHTTPInjectorFallback(fileBytes);
        }

        // Étape 3: Traiter selon le type d'IV
        const targetSalt = config.configSalt || 'EVZJNI';
        let parsedFinal = {};

        const isBypass = EHI_CONSTANTS.BYPASS_IVS.some(iv => iv.equals(matchedIv));

        if (isBypass) {
            parsedFinal = config;
        } else {
            // Étape 4: Décrypter avec Argon2
            const targetData = config.configData;
            if (!targetData) {
                return decryptHTTPInjectorFallback(fileBytes);
            }

            const aaaResult = ehiDecryptXorLayer(targetData, targetSalt);
            if (!aaaResult) {
                return decryptHTTPInjectorFallback(fileBytes);
            }

            const rawPayload = Buffer.from(aaaResult, 'base64');
            if (rawPayload.length <= 50) {
                return decryptHTTPInjectorFallback(fileBytes);
            }

            try {
                // Étape 5: Générer la clé maître
                const masterKey = ehiGenerateMasterKey(config);
                
                // Étape 6: Extraire les paramètres Argon2
                const salt = rawPayload.slice(0x0a, 0x1a);
                const timeCost = rawPayload.readUInt32LE(1);
                const memoryCost = rawPayload.readUInt32LE(5);
                const parallelism = rawPayload[9];

                // Étape 7: Argon2 hash
                const argonHash = await argon2.hash(masterKey, {
                    salt: salt,
                    timeCost: timeCost,
                    memoryCost: memoryCost,
                    parallelism: parallelism,
                    hashLength: 32,
                    type: argon2.argon2id
                });

                const hashParts = argonHash.split('$');
                const hashValue = hashParts[hashParts.length - 1];
                const argonKey = Buffer.from(hashValue, 'base64');

                // Étape 8: ChaCha20-Poly1305 décryptage
                const nonce = rawPayload.slice(0x1a, 0x32);
                const aad = rawPayload.slice(0, 0x1a);
                const ciphertext = rawPayload.slice(0x32, -16);
                const tag = rawPayload.slice(-16);

                const decipher = crypto.createDecipheriv('chacha20-poly1305', argonKey, nonce);
                decipher.setAAD(aad);
                decipher.setAuthTag(tag);
                
                const decrypted = Buffer.concat([
                    decipher.update(ciphertext),
                    decipher.final()
                ]);

                parsedFinal = JSON.parse(decrypted.toString('utf-8'));

            } catch (e) {
                console.error('Argon2/ChaCha20 decrypt error:', e);
                return decryptHTTPInjectorFallback(fileBytes);
            }
        }

        // Étape 9: Nettoyer les champs
        const cleaned = ehiDecodeInnerFields(parsedFinal, targetSalt);

        // Étape 10: Traiter les champs JSON imbriqués
        for (const field of ["v2rRawJson", "overwriteServerData"]) {
            if (cleaned[field] && typeof cleaned[field] === 'string') {
                try {
                    const start = cleaned[field].indexOf('{');
                    const end = cleaned[field].lastIndexOf('}');
                    if (start !== -1 && end !== -1) {
                        const parsed = JSON.parse(cleaned[field].slice(start, end + 1));
                        cleaned[field] = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
                    }
                } catch (e) {}
            }
        }

        return `HTTP INJECTOR SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(cleaned, null, 4)}\n\n${'='.repeat(30)}\ncode : @HTTP_INJECTOR`;

    } catch (e) {
        console.error('HTTPInjector decrypt error:', e);
        return decryptHTTPInjectorFallback(fileBytes);
    }
}

function decryptHTTPInjectorFallback(fileBytes) {
    try {
        const content = fileBytes.toString('utf-8').trim();
        if (!content) return null;

        try {
            const json = JSON.parse(content);
            return `HTTP INJECTOR SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(json, null, 4)}\n\n${'='.repeat(30)}\ncode : @HTTP_INJECTOR`;
        } catch (e) {}

        try {
            const decoded = Buffer.from(content, 'base64').toString('utf-8');
            return `HTTP INJECTOR SCRIPT\n${'='.repeat(30)}\n\n${decoded}\n\n${'='.repeat(30)}\ncode : @HTTP_INJECTOR`;
        } catch (e) {}

        let result = {
            type: 'httpinjector',
            raw: content.slice(0, 1000) + (content.length > 1000 ? '...' : ''),
            size: content.length
        };

        if (content.includes('cloudconfig') || content.includes('"cfg":') || content.includes('"xy":')) {
            result.format = 'cloudconfig';
        } else if (/^[A-Za-z0-9+/=]+$/.test(content) && content.length > 100) {
            result.format = 'base64';
        } else if (/^[0-9a-fA-F]+$/.test(content) && content.length > 100) {
            result.format = 'hex';
        }

        return `HTTP INJECTOR SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(result, null, 4)}\n\n${'='.repeat(30)}\ncode : @HTTP_INJECTOR`;
    } catch (e) {
        return null;
    }
}

// ============================================================
// 5. NPVTUNNEL DECRYPTOR
// ============================================================

function npvBase64Decode(str) {
    try {
        let clean = str;
        while (clean.length % 4 !== 0) clean += '=';
        return Buffer.from(clean, 'base64');
    } catch (e) {
        return null;
    }
}

export function decryptNPVTunnel(fileBytes) {
    try {
        const content = fileBytes.toString('utf-8').trim();
        if (!content) return null;
        let raw = content;
        if (raw.startsWith('NPVTSUB1')) raw = raw.slice(8).trim();
        else if (raw.startsWith('NPVT1')) raw = raw.slice(5).trim();
        if (!raw) return null;
        const parts = raw.split(',');
        if (parts.length < 2) {
            return `NPVTUNNEL SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify({ raw: raw.slice(0, 500) }, null, 4)}\n\n${'='.repeat(30)}\ncode : @NPVTUNNEL`;
        }
        const decoded = npvBase64Decode(parts[1]);
        if (!decoded) {
            return `NPVTUNNEL SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify({ raw: parts[1].slice(0, 500) }, null, 4)}\n\n${'='.repeat(30)}\ncode : @NPVTUNNEL`;
        }
        const decryptedStr = decoded.toString('utf-8');
        let resultJson = null;
        try {
            resultJson = JSON.parse(decryptedStr);
            if (Array.isArray(resultJson) && resultJson.length > 0) {
                resultJson = resultJson[0];
            }
        } catch (e) {
            resultJson = { raw_data: decryptedStr.slice(0, 1000) };
        }
        return `NPVTUNNEL SCRIPT\n${'='.repeat(30)}\n\n${JSON.stringify(resultJson, null, 4)}\n\n${'='.repeat(30)}\ncode : @NPVTUNNEL`;
    } catch (e) {
        console.error('NPVTunnel decrypt error:', e);
        return null;
    }
}

// ============================================================
// EXPORTS
// ============================================================

export default {
    decryptSSC,
    decryptDarkTunnel,
    decryptHTTPCustom,
    decryptHTTPInjector,
    decryptNPVTunnel
};