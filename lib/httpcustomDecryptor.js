import crypto from 'crypto';

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
    RST_KEYS: ['JN1k3YHc2.6_v235', 'JN1k3YHc_2.7_v71', 'JN1k3YHc2.7.ps69', 'JN1k3YHc2.7.6950', 'Jn1K3yHc2.8.ps08', 'Jn1K3yHc2.9.ps6c', 'Zk:L7>WKaiK*s9>D', '!<f!&WIlM**R.B0X', 'b4a5opinx2uloec6'],
    STATIC_NONCE: Buffer.alloc(8, 0xdb),
    
    // ⠇ L'ALPHABET BRAILLE CRITIQUE DU SCRIPT PYTHON RECONSTITUÉ À 100%
    BRAILLE_MAP: {
        "⠁":"a", "⠃":"b", "⠉":"c", "⠙":"d", "⠑":"e", "⠋":"f", "⠛":"g", "⠓":"h", "⠊":"i", "⠚":"j",
        "⠅":"k", "⠇":"l", "⠍":"m", "⠝":"n", "⠕":"o", "⠏":"p", "⠟":"q", "⠗":"r", "⠎":"s", "⠞":"t",
        "⠥":"u", "⠧":"v", "⠺":"w", "⠭":"x", "⠽":"y", "⠵":"z",
        "⠼⠁":"1", "⠼⠃":"2", "⠼⠉":"3", "⠼⠙":"4", "⠼⠑":"5", "⠼⠋":"6", "⠼⠛":"7", "⠼⠓":"8", "⠼⠊":"9", "⠼⠚":"0"
    },
    TOKEN_MAP: {
        0: "payload", 1: "proxy", 2: "lockAllConfig", 3: "blockedByRoot", 4: "expiryTime", 5: "noteEnabled", 6: "notes", 7: "sshField", 8: "mobileDataAndLockProvider", 9: "unlockUserAndPass", 10: "ovpnConfig", 11: "ovpnUserAndPass", 12: "sni", 13: "unlockUserAndPass2", 15: "blockedByHwid", 16: "cloudconfig", 17: "psiphon", 18: "name", 19: "blockArea", 20: "connectionMode", 21: "blockedByPassword", 23: "extraSniffer", 25: "v2rayEnabled", 26: "v2rayConfig", 27: "version", 28: "slowdnsEnabled", 29: "slowdnsServer", 30: "slowdnsPublickey", 31: "dnsResolver"
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

// 🔄 DÉCODEUR UNIVERSEL DE CELLULES BRAILLE (TRADUCTION EXACTE DU COMPORTEMENT PYTHON)
function translateBrailleToAscii(text) {
    if (!text) return text;
    let out = text;
    
    // Remplacement des séquences numériques (Indicateur de nombre binaire + lettre)
    const numericKeys = Object.keys(HC_CONSTANTS.BRAILLE_MAP).filter(k => k.startsWith("⠼"));
    for (const bKey of numericKeys) {
        out = out.split(bKey).join(HC_CONSTANTS.BRAILLE_MAP[bKey]);
    }
    
    // Remplacement des lettres simples restantes
    for (const [braille, ascii] of Object.entries(HC_CONSTANTS.BRAILLE_MAP)) {
        if (!braille.startsWith("⠼")) {
            out = out.split(braille).join(ascii);
        }
    }
    return out;
}

function jklDecrypt(inputStr) {
    if (!inputStr) return inputStr;
    try {
        let padded = inputStr;
        while (padded.length % 4 !== 0) padded += '=';
        const data = Buffer.from(padded, 'base64');
        const result = Buffer.alloc(data.length);
        const activeKey = Buffer.from([0xd5, 0xd4, 0xd3, 0xd2, 0xd1, 0xd0, 0xcf, 0xce, 0xcd, 0xcc, 0xbd, 0xbc, 0xbb, 0xba, 0xb9, 0xb8, 0xb7, 0xb6, 0xb5, 0xb4]);
        
        for (let i = 0; i < data.length; i++) {
            const k = activeKey[i % 20];
            result[i] = (((data[i] ^ 0xff) & 0xca) | (data[i] & 0x35)) ^ (((k ^ 0xff) & 0xca) | (k & 0x35));
        }
        
        // On applique le décodeur Braille binaire sur le résultat brut JKL obtenu
        return translateBrailleToAscii(Buffer.from(result.toString(), 'base64').toString('utf-8'));
    } catch (e) { return inputStr; }
}

export function decryptHTTPCustom(fileBytes) {
    try {
        const xorKey = Buffer.from("e382e4b8adc386f09f9293", 'hex');
        const xorData = Buffer.alloc(fileBytes.length);
        for (let i = 0; i < fileBytes.length; i++) xorData[i] = fileBytes[i] ^ xorKey[i % xorKey.length];

        const outerData = chacha20Decrypt(HC_CONSTANTS.CHACHA_KEYS[0], HC_CONSTANTS.STATIC_NONCE, Buffer.from(xorData.toString('utf-8'), 'hex'));
        const jsonObj = JSON.parse(outerData.toString('utf-8'));
        
        const isNewFormat = !!jsonObj.cfg;
        const cfgObj = jsonObj.cfg || {};
        const masterCipherHex = jsonObj.xy || cfgObj.content;

        const hwid = jsonObj.a || cfgObj.hwid || "";
        const pwd = jsonObj.p || cfgObj.password || "";
        const area = jsonObj.b || cfgObj.area || "";
        
        const metaHash = crypto.createHash('md5').update(hwid + pwd + area).digest();
        const dynamicNonce = Buffer.alloc(8);
        for(let i=0; i<8; i++) dynamicNonce[i] = HC_CONSTANTS.STATIC_NONCE[i] ^ metaHash[i % 16];

        let xyDec = null;
        if (isNewFormat) {
            for (const rstKey of HC_CONSTANTS.RST_KEYS) {
                try {
                    const rstKeyHash = crypto.createHash('md5').update(rstKey).digest();
                    const decipher = crypto.createDecipheriv('aes-128-ecb', rstKeyHash, null);
                    xyDec = Buffer.concat([decipher.update(Buffer.from(masterCipherHex, 'hex')), decipher.final()]);
                    if (xyDec.toString('utf-8').includes('[splitConfig]')) break;
                } catch(e) { xyDec = null; }
            }
        }
        
        if (!xyDec) {
            xyDec = chacha20Decrypt(HC_CONSTANTS.CHACHA_KEYS[1], dynamicNonce, Buffer.from(masterCipherHex, 'hex'));
        }

        const tokens = xyDec.toString('utf-8').split("[splitConfig]");
        const configData = {};
        for (let i = 0; i < tokens.length; i++) {
            const label = HC_CONSTANTS.TOKEN_MAP[i] || `field_${i}`;
            let value = jklDecrypt(tokens[i]);
            
            // Extraction Z3A additionnelle pour les structures sshField complexes
            if (label === 'sshField' && value && value.includes('z3a_')) {
                try {
                    const z3b = Buffer.from(value.replace('z3a_', ''), 'base64').toString('utf-8');
                    value = translateBrailleToAscii(z3b);
                } catch(e){}
            }
            configData[label] = value;
        }

        return `Labokingfreesurf HTTP CUSTOM CONFIG\n==============================\n\n${JSON.stringify({ 
            Protections: { hwid, password: pwd ? "PROTECTED_LOCK" : "NONE", area },
            Config: configData 
        }, null, 4)}`;
    } catch (e) { return null; }
}
