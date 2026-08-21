import { decryptSSC } from './sscDecryptor.js';
import { decryptDarkTunnel } from './darktunnelDecryptor.js';
import { decryptHTTPCustom } from './httpcustomDecryptor.js';
import { decryptHTTPInjector } from './httpinjectorDecryptor.js';
import { decryptNPVTunnel } from './npvtunnelDecryptor.js';
import { parse } from 'node-html-parser';
import fetch from 'node-fetch';

class TDecryptor {
    static decryptSSC(fileBytes) { return decryptSSC(fileBytes); }
    static decryptDarkTunnel(fileBytes) { return decryptDarkTunnel(fileBytes); }
    static decryptHTTPCustom(fileBytes) { return decryptHTTPCustom(fileBytes); }
    static async decryptHTTPInjector(fileBytes) { return await decryptHTTPInjector(fileBytes); }
    static decryptNPVTunnel(fileBytes) { return decryptNPVTunnel(fileBytes); }

    static async downloadAndDecryptEhiLink(url) {
        try {
            const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = await response.text();
            const root = parse(html);
            const downloadBtn = root.querySelector('a[href*=".ehi"]');
            if (!downloadBtn) return null;
            let fileUrl = downloadBtn.getAttribute('href');
            if (!fileUrl.startsWith('http')) fileUrl = `https://ehi.link${fileUrl}`;
            const fileResponse = await fetch(fileUrl);
            return await decryptHTTPInjector(await fileResponse.buffer());
        } catch (e) { return null; }
    }
}

export { TDecryptor };
