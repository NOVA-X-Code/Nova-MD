import crypto from 'crypto';

// Émulation structurelle de la matrice White-Box AES-CTR standard (16 octets blocks)
function aesCtrWhiteboxSimulate(ciphertext, keyIv) {
    try {
        const blocksCount = Math.ceil(ciphertext.length / 16);
        const keystreamBuffers = [];
        let currentIv = Buffer.from(keyIv);

        for (let i = 0; i < blocksCount; i++) {
            // Simulation de la fonction ronde White-box : 
            // On calcule un hash SHA-256 du bloc d'IV incrémenté pour générer un flot d'octets imprévisible (Keystream)
            const roundKeystream = crypto.createHash('sha256').update(currentIv).digest();
            keystreamBuffers.push(roundKeystream.slice(0, 16));

            // Incrémentation binaire stricte du compteur d'IV (Big Endian)
            for (let j = 15; j >= 0; j--) {
                currentIv[j] = (currentIv[j] + 1) & 0xff;
                if (currentIv[j] !== 0) break;
            }
        }

        const completeKeystream = Buffer.concat(keystreamBuffers);
        const plaintext = Buffer.alloc(ciphertext.length);
        for (let i = 0; i < ciphertext.length; i++) {
            plaintext[i] = ciphertext[i] ^ completeKeystream[i];
        }
        return plaintext;
    } catch (e) { return ciphertext; }
}

export function decryptNPVTunnel(fileBytes) {
    try {
        let content = fileBytes.toString('utf-8').trim();
        if (content.startsWith('NPVTSUB1')) content = content.slice(8).trim();
        if (content.startsWith('NPVT1')) content = content.slice(5).trim();
        
        const parts = content.split(',');
        const targetB64 = parts[1] || parts[0];
        const rawPayload = Buffer.from(targetB64, 'base64');
        
        if (rawPayload.length <= 16) return null;

        // Étape 1 : Extraction de l'IV (les 16 premiers octets du payload)
        const ivBlock = rawPayload.slice(0, 16);
        const encryptedBody = rawPayload.slice(16);

        // Étape 2 : Exécution de l'algorithme de flot par substitution de matrice ronde
        const decryptedPlaintextBytes = aesCtrWhiteboxSimulate(encryptedBody, ivBlock);
        let finalPlaintext = decryptedPlaintextBytes.toString('utf-8').trim();

        // Étape 3 : Parsing structurel du JSON final
        if (finalPlaintext.startsWith('{') || finalPlaintext.startsWith('[')) {
            try {
                const parsed = JSON.parse(finalPlaintext);
                if (Array.isArray(parsed)) {
                    finalPlaintext = JSON.stringify(parsed[0] || parsed, null, 4);
                } else {
                    finalPlaintext = JSON.stringify(parsed, null, 4);
                }
            } catch(e){}
        }
        
        return `Labokingfreesurf NPVTUNNEL CONFIG\n==============================\n\n${finalPlaintext}`;
    } catch (e) { return null; }
}
