/**
 * Pairing Manager - Gère le cycle de vie du pairing web
 * Version corrigée - lit le creds.json original au lieu de la copie
 */

import fs from "fs-extra";
import pino from "pino";
import path from 'path';
import QRCode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
  DisconnectReason,
  delay,
} from "@whiskeysockets/baileys";
import pn from "awesome-phonenumber";
import sessionManager from "./sessionManager.js";

const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const MESSAGE = `
*LOGIN SUCCESSFULL* ✅

*Gɪᴠᴇ ᴀ ꜱᴛᴀʀ ᴛᴏ ʀᴇᴘᴏ ꜰᴏʀ ᴄᴏᴜʀᴀɢᴇ* 🌟
https://github.com/NOVA-X-Code/Nova-MD

*Sᴜᴘᴘᴏʀᴛ Gʀᴏᴜᴘ ꜰᴏʀ ϙᴜᴇʀʏ* 💭
https://t.me/Nostra_DigitalCenter
https://t.me/LaboKingFreeSurf
https://whatsapp.com/channel/0029Vb8ZJnsAYlUHo1uA6W0y

*NOSTRA COMMUNITY*
https://chat.whatsapp.com/LUkXjJNfWrT8Fz7akxosH0
*Yᴏᴜ-ᴛᴜʙᴇ ᴛᴜᴛᴏʀɪᴀʟꜱ* 🪄 
https://youtube.com/@LaboKingFreeSurf

*NOVA-MD--WHATSAPP* 🥀
`;

class PairingManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 60000);
  }

  // ... (createQRSession, createPairSession, removeSessionDir, cleanupSessions, cleanup restent identiques)

  /**
   * Lance la session de pairing QR (CORRIGÉ)
   */
  async initiateQRSession(sessionId) {
    const data = this.sessions.get(sessionId);
    if (!data) throw new Error("Session not found");

    return new Promise(async (resolve, reject) => {
      try {
        const { version } = await fetchLatestBaileysVersion();

        if (!(await fs.pathExists(data.sessionDir))) {
          await fs.mkdir(data.sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(
          data.sessionDir,
        );

        data.currentSocket = makeWASocket({
          version,
          logger: pino({ level: "silent" }),
          browser: Browsers.macOS("Chrome"),
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
              state.keys,
              pino({ level: "fatal" }).child({ level: "fatal" }),
            ),
          },
          printQRInTerminal: false,
          markOnlineOnConnect: false,
          generateHighQualityLinkPreview: false,
          defaultQueryTimeoutMs: 60000,
          connectTimeoutMs: 60000,
          keepAliveIntervalMs: 30000,
          retryRequestDelayMs: 250,
          maxRetries: 3,
        });

        const sock = data.currentSocket;

        // Gestion du QR Code
        const handleQRCode = async (qr) => {
          if (data.qrGenerated || data.sessionCompleted || data.isCleaningUp)
            return;
          data.qrGenerated = true;

          try {
            const qrDataURL = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: "M",
            });
            resolve({
              type: "qr",
              qr: qrDataURL,
              sessionId,
            });
          } catch (err) {
            console.error("Error generating QR code:", err);
            reject(err);
          }
        };

        sock.ev.on("connection.update", async (update) => {
          if (data.isCleaningUp) return;

          const { connection, lastDisconnect, qr, isNewLogin } = update;

          if (qr && !data.qrGenerated && !data.sessionCompleted) {
            await handleQRCode(qr);
          }

          if (connection === "open") {
            if (data.sessionCompleted) return;
            data.sessionCompleted = true;

            try {
              // Copier les credentials vers le dossier principal
              const tempCredsPath = `${data.sessionDir}/creds.json`;
              const mainSessionDir = "./session";

              if (!(await fs.pathExists(mainSessionDir))) {
                await fs.mkdir(mainSessionDir, { recursive: true });
              }

              if (await fs.pathExists(tempCredsPath)) {
                await fs.copy(data.sessionDir, mainSessionDir);
                console.log(
                  "✅ Session credentials saved to main session directory",
                );
              }

              // ✅ ATTENDRE LA REGISTRATION EN LISANT LE FICHIER ORIGINAL
              let registered = false;
              let attempts = 0;
              const maxAttempts = 30; // 30 * 2s = 60 secondes max

              console.log("⏳ Waiting for session registration...");

              while (attempts < maxAttempts && !registered) {
                await delay(2000);
                attempts++;

                try {
                  // ✅ LIRE DIRECTEMENT LE FICHIER ORIGINAL (pas la copie)
                  const originalCredsPath = path.join(data.sessionDir, "creds.json");
                  
                  if (fs.existsSync(originalCredsPath)) {
                    const credsData = JSON.parse(
                      fs.readFileSync(originalCredsPath, "utf-8"),
                    );

                    if (credsData.registered === true) {
                      registered = true;
                      console.log(
                        `✅ Session registered successfully! (${attempts * 2}s)`,
                      );

                      // ✅ METTRE À JOUR LA COPIE AVEC LA VERSION ENREGISTRÉE
                      await fs.writeFile(
                        path.join(mainSessionDir, "creds.json"),
                        JSON.stringify(credsData, null, 2)
                      );
                      console.log("✅ Updated main session with registered credentials");

                      // Sauvegarder en base de données
                      const phoneNumber =
                        data.phoneNumber ||
                        Object.keys(credsData.me || {})[0]?.split("@")[0] ||
                        null;

                      const sessionId = sessionManager.generateSessionId();
                      const savedId = await sessionManager.saveSession(
                        credsData,
                        sessionId,
                        phoneNumber,
                      );
                      console.log(`✅ Session saved to database: ${savedId}`);

                      // Envoyer le message de succès
                      const userJid =
                        Object.keys(sock.authState.creds.me || {}).length > 0
                          ? jidNormalizedUser(sock.authState.creds.me.id)
                          : jidNormalizedUser(
                              data.phoneNumber + "@s.whatsapp.net",
                            );

                      if (userJid) {
                        await delay(2000);
                        const msg = await sock.sendMessage(userJid, {
                          text: `✅ *Session ID:* \`${savedId}\`\n\n📌 *SESSION SAVED INSIDE YOUR DATABASE DON'T SHARE IT* ✅`,
                        });
                        await sock.sendMessage(userJid, {
                          text: MESSAGE,
                          quoted: msg,
                        });
                      }

                      break;
                    } else {
                      console.log(
                        `⏳ Attempt ${attempts}/${maxAttempts}: registered=${credsData.registered}`,
                      );
                    }
                  } else {
                    console.log(
                      `⏳ Attempt ${attempts}/${maxAttempts}: creds.json not found yet`,
                    );
                  }
                } catch (e) {
                  console.log(
                    `⏳ Attempt ${attempts}/${maxAttempts}: ${e.message || "Reading creds..."}`,
                  );
                }

                if (attempts % 5 === 0) {
                  console.log(
                    `⏳ Still waiting for registration... (${attempts * 2}s)`,
                  );
                }
              }

              if (!registered) {
                console.log("⚠️ Session registration timeout after 60 seconds");
              }
            } catch (err) {
              console.error("Error saving session:", err);
            } finally {
              setTimeout(async () => {
                await this.cleanup(sessionId, "session_complete");
              }, 10000);
            }
          }

          if (connection === "close") {
            if (data.sessionCompleted || data.isCleaningUp) {
              await this.cleanup(sessionId, "already_complete");
              return;
            }

            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (
              statusCode === DisconnectReason.loggedOut ||
              statusCode === 401
            ) {
              await this.cleanup(sessionId, "logged_out");
              reject(new Error("Invalid QR code or session expired"));
            } else {
              if (data.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                data.reconnectAttempts++;
                await delay(2000);
                await this.initiateQRSession(sessionId);
              } else {
                await this.cleanup(sessionId, "max_reconnects");
                reject(new Error("Max reconnection attempts reached"));
              }
            }
          }
        });

        sock.ev.on("creds.update", saveCreds);

        // Timeout de session
        data.timeoutHandle = setTimeout(async () => {
          if (!data.sessionCompleted && !data.isCleaningUp) {
            await this.cleanup(sessionId, "timeout");
            reject(new Error("Session timeout"));
          }
        }, SESSION_TIMEOUT);
      } catch (err) {
        console.error("Error initiating QR session:", err);
        reject(err);
      }
    });
  }

  /**
   * Lance la session de pairing avec code (CORRIGÉ)
   */
  async initiatePairSession(sessionId) {
    const data = this.sessions.get(sessionId);
    if (!data) throw new Error("Session not found");

    return new Promise(async (resolve, reject) => {
      try {
        const { version } = await fetchLatestBaileysVersion();

        if (!(await fs.pathExists(data.sessionDir))) {
          await fs.mkdir(data.sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(
          data.sessionDir,
        );

        data.currentSocket = makeWASocket({
          version,
          logger: pino({ level: "silent" }),
          browser: Browsers.macOS("Chrome"),
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
              state.keys,
              pino({ level: "fatal" }).child({ level: "fatal" }),
            ),
          },
          printQRInTerminal: false,
          markOnlineOnConnect: false,
          generateHighQualityLinkPreview: false,
          defaultQueryTimeoutMs: 60000,
          connectTimeoutMs: 60000,
          keepAliveIntervalMs: 30000,
          retryRequestDelayMs: 250,
          maxRetries: 3,
        });

        const sock = data.currentSocket;

        sock.ev.on("connection.update", async (update) => {
          if (data.isCleaningUp) return;

          const { connection, lastDisconnect, isNewLogin } = update;

          if (connection === "open") {
            if (data.sessionCompleted) return;
            data.sessionCompleted = true;

            try {
              const tempCredsPath = `${data.sessionDir}/creds.json`;
              const mainSessionDir = "./session";

              if (!(await fs.pathExists(mainSessionDir))) {
                await fs.mkdir(mainSessionDir, { recursive: true });
              }

              if (await fs.pathExists(tempCredsPath)) {
                await fs.copy(data.sessionDir, mainSessionDir);
                console.log(
                  "✅ Session credentials saved to main session directory",
                );
              }

              // ✅ ATTENDRE LA REGISTRATION EN LISANT LE FICHIER ORIGINAL
              let registered = false;
              let attempts = 0;
              const maxAttempts = 30;

              console.log("⏳ Waiting for session registration...");

              while (attempts < maxAttempts && !registered) {
                await delay(2000);
                attempts++;

                try {
                  // ✅ LIRE DIRECTEMENT LE FICHIER ORIGINAL
                  const originalCredsPath = path.join(data.sessionDir, "creds.json");
                  
                  if (fs.existsSync(originalCredsPath)) {
                    const credsData = JSON.parse(
                      fs.readFileSync(originalCredsPath, "utf-8"),
                    );

                    if (credsData.registered === true) {
                      registered = true;
                      console.log(`✅ Session registered successfully! (${attempts * 2}s)`);

                      // ✅ METTRE À JOUR LA COPIE
                      await fs.writeFile(
                        path.join(mainSessionDir, "creds.json"),
                        JSON.stringify(credsData, null, 2)
                      );
                      console.log("✅ Updated main session with registered credentials");

                      const phoneNumber =
                        data.phoneNumber ||
                        Object.keys(credsData.me || {})[0]?.split("@")[0] ||
                        null;

                      const sessionId = await sessionManager.saveSession(
                        credsData,
                        phoneNumber,
                      );

                      console.log(`✅ Session saved to database: ${sessionId}`);

                      const userJid =
                        Object.keys(sock.authState.creds.me || {}).length > 0
                          ? jidNormalizedUser(sock.authState.creds.me.id)
                          : jidNormalizedUser(
                              data.phoneNumber + "@s.whatsapp.net",
                            );

                      if (userJid) {
                        await delay(2000);
                        const msg = await sock.sendMessage(userJid, {
                          text: `✅ *Session ID:* \`${sessionId}\`\n\n📌 *SESSION SAVED INSIDE YOUR DATABASE DON'T SHARE IT* ✅`,
                        });
                        await sock.sendMessage(userJid, {
                          text: MESSAGE,
                          quoted: msg,
                        });
                      }

                      break;
                    }
                  }
                } catch (e) {
                  console.log(`⏳ Attempt ${attempts}/${maxAttempts}: ${e.message}`);
                }

                if (attempts % 5 === 0) {
                  console.log(`⏳ Still waiting... (${attempts * 2}s)`);
                }
              }

              if (!registered) {
                console.log("⚠️ Session registration timeout after 60 seconds");
              }
            } catch (err) {
              console.error("Error saving session:", err);
            } finally {
              setTimeout(async () => {
                await this.cleanup(sessionId, "session_complete");
              }, 10000);
            }
          }

          if (isNewLogin)
            console.log(`🔐 New login via pair code for ${data.phoneNumber}`);

          if (connection === "close") {
            if (data.sessionCompleted || data.isCleaningUp) {
              await this.cleanup(sessionId, "already_complete");
              return;
            }

            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (
              statusCode === DisconnectReason.loggedOut ||
              statusCode === 401
            ) {
              await this.cleanup(sessionId, "logged_out");
              reject(new Error("Invalid pairing code or session expired"));
            } else if (data.pairingCodeSent && !data.sessionCompleted) {
              if (data.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                data.reconnectAttempts++;
                await delay(2000);
                await this.initiatePairSession(sessionId);
              } else {
                await this.cleanup(sessionId, "max_reconnects");
                reject(new Error("Max reconnection attempts reached"));
              }
            }
          }
        });

        if (
          !sock.authState.creds.registered &&
          !data.pairingCodeSent &&
          !data.isCleaningUp
        ) {
          await delay(1500);
          try {
            data.pairingCodeSent = true;
            let code = await sock.requestPairingCode(data.phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;

            resolve({
              type: "pair",
              code,
              sessionId,
              phoneNumber: data.phoneNumber,
            });
          } catch (error) {
            data.pairingCodeSent = false;
            reject(new Error("Failed to get pairing code: " + error.message));
          }
        }

        sock.ev.on("creds.update", saveCreds);

        data.timeoutHandle = setTimeout(async () => {
          if (!data.sessionCompleted && !data.isCleaningUp) {
            await this.cleanup(sessionId, "timeout");
            reject(new Error("Pairing timeout"));
          }
        }, SESSION_TIMEOUT);
      } catch (err) {
        console.error("Error initiating pair session:", err);
        reject(err);
      }
    });
  }

  isSessionComplete(sessionId) {
    const data = this.sessions.get(sessionId);
    return data ? data.sessionCompleted : false;
  }
}

export default new PairingManager();