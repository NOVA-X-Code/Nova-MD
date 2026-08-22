import "dotenv/config";

import fs, { existsSync, mkdirSync, rmSync } from "fs";
import path, { dirname } from "path";
import chalk from "chalk";
import syntaxerror from "syntax-error";
import { parsePhoneNumber as PhoneNumber } from "awesome-phonenumber";
import readline from "readline";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { smsg } from "./lib/myfunc.js";
import { compileAll } from "./lib/compile.js";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidDecode,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  delay,
} from "@whiskeysockets/baileys";
import NodeCache from "node-cache";
import pino from "pino";
import config from "./config.js";
import store from "./lib/lightweight_store.js";
import { server, PORT } from "./lib/server.js";
import { printLog } from "./lib/print.js";
import { writeErrorLog } from "./lib/logger.js";
import {
  handleMessages,
  handleGroupParticipantUpdate,
  handleStatus,
  handleCall,
} from "./lib/messageHandler.js";
import commandHandler from "./lib/commandHandler.js";
import sessionManager from "./lib/sessionManager.js";

store.readFromFile();
setInterval(() => store.writeToFile(), config.storeWriteInterval || 10000);

setInterval(() => {
  if (global.gc) {
    global.gc();
    console.log("🧹 Garbage collection completed");
  }
}, 60000);

setInterval(() => {
  const used = process.memoryUsage().rss / 1024 / 1024;
  if (used > 400) {
    printLog("warning", "RAM too high (>400MB), restarting bot...");
    process.exit(1);
  }
}, 30000);

// Auto-create data directory and default files on startup
const DATA_DEFAULTS = {
  "owner.json": [],
  "banned.json": [],
  "premium.json": [],
  "warnings.json": {},
  "notes.json": {},
  "autoAi.json": {},
  "messageCount.json": { isPublic: true, messageCount: {} },
  "userGroupData.json": {
    users: [],
    groups: [],
    antilink: {},
    antibadword: {},
    warnings: {},
    sudo: [],
    welcome: {},
    goodbye: {},
    chatbot: {},
    autoReaction: false,
  },
  "autoStatus.json": { enabled: false },
  "autoread.json": { enabled: false },
  "autotyping.json": { enabled: false },
  "pmblocker.json": { enabled: false },
  "anticall.json": { enabled: false },
  "stealthMode.json": { enabled: false },
  "autoBio.json": { enabled: false, customBio: null },
  "autoReaction.json": { enabled: false },
  "antidelete.json": { enabled: false },
  "antilink.json": {},
  "antibadword.json": {},
};

fs.mkdirSync("./data", { recursive: true });
for (const [file, def] of Object.entries(DATA_DEFAULTS)) {
  const fp = `./data/${file}`;
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(def, null, 2));
}

let owner = [];
try {
  owner = JSON.parse(fs.readFileSync("./data/owner.json", "utf-8"));
} catch {
  owner = [];
}

global.botname = config.botName || "NOVA-MD";
global.themeemoji = "•";

// Désactiver le pairing via terminal - tout passe par l'interface web
const pairingCode = false;
const useMobile = process.argv.includes("--mobile");

let rl = null;
let rlClosed = false;
if (process.stdin.isTTY && !config.pairingNumber) {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.on("close", () => {
    rlClosed = true;
  });
}

const question = (text) => {
  if (rl && !rlClosed) {
    return new Promise((resolve) => rl.question(text, resolve));
  } else {
    return Promise.resolve(config.ownerNumber || "237676250509");
  }
};

process.on("exit", () => {
  if (rl && !rlClosed) rl.close();
});

process.on("SIGINT", () => {
  if (rl && !rlClosed) rl.close();
  process.exit(0);
});

function ensureSessionDirectory() {
  const sessionPath = path.join(__dirname, "session");
  if (!existsSync(sessionPath)) {
    mkdirSync(sessionPath, { recursive: true });
  }
  return sessionPath;
}

function hasValidSession() {
  return sessionManager.hasValidSession();
}

server.listen(PORT, () => {
  printLog("success", `Server listening on port ${PORT}`);
  printLog(
    "info",
    `🌐 Web interface available at: http://localhost:${PORT}/pairing`,
  );
});

async function startNovaXCode() {
  try {
    const { version } = await fetchLatestBaileysVersion();
    ensureSessionDirectory();
    await delay(1000);

    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    const _saveCreds = async () => {
      ensureSessionDirectory();
      await saveCreds();
    };

    const msgRetryCounterCache = new NodeCache();
    const ghostMode = await store.getSetting("global", "stealthMode");
    const isGhostActive = ghostMode && ghostMode.enabled;

    const NovaXCode = makeWASocket({
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
      markOnlineOnConnect: !isGhostActive,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      getMessage: async (key) => {
        const jid = jidNormalizedUser(key.remoteJid);
        const msg = await store.loadMessage(jid, key.id);
        return msg?.message || "";
      },
      msgRetryCounterCache,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    });

    NovaXCode.store = store;

    const originalSendPresenceUpdate = NovaXCode.sendPresenceUpdate;
    const originalReadMessages = NovaXCode.readMessages;
    const originalSendReceipt = NovaXCode.sendReceipt;

    NovaXCode.sendPresenceUpdate = async function (...args) {
      const ghostMode = await store.getSetting("global", "stealthMode");
      if (ghostMode && ghostMode.enabled) {
        printLog("info", "👻 Blocked presence update (stealth mode)");
        return;
      }
      return originalSendPresenceUpdate.apply(this, args);
    };

    NovaXCode.readMessages = async function (...args) {
      const ghostMode = await store.getSetting("global", "stealthMode");
      if (ghostMode && ghostMode.enabled) return;
      return originalReadMessages.apply(this, args);
    };

    if (originalSendReceipt) {
      NovaXCode.sendReceipt = async function (...args) {
        const ghostMode = await store.getSetting("global", "stealthMode");
        if (ghostMode && ghostMode.enabled) return;
        return originalSendReceipt.apply(this, args);
      };
    }

    const originalQuery = NovaXCode.query;
    NovaXCode.query = async function (node, ...args) {
      const ghostMode = await store.getSetting("global", "stealthMode");
      if (ghostMode && ghostMode.enabled) {
        if (node && node.tag === "receipt") return;
        if (
          node &&
          node.attrs &&
          (node.attrs.type === "read" || node.attrs.type === "read-self")
        )
          return;
      }
      return originalQuery.apply(this, [node, ...args]);
    };

    NovaXCode.isGhostMode = async () => {
      const ghostMode = await store.getSetting("global", "stealthMode");
      return ghostMode && ghostMode.enabled;
    };

    NovaXCode.ev.on("creds.update", _saveCreds);
    store.bind(NovaXCode.ev);

    NovaXCode.ev.on("messages.upsert", async (chatUpdate) => {
      try {
        const mek = chatUpdate.messages[0];
        if (!mek.message) return;
        mek.message =
          Object.keys(mek.message)[0] === "ephemeralMessage"
            ? mek.message.ephemeralMessage.message
            : mek.message;

        if (mek.key && mek.key.remoteJid === "status@broadcast") {
          await handleStatus(NovaXCode, chatUpdate);
          return;
        }

        if (
          !NovaXCode.public &&
          !mek.key.fromMe &&
          chatUpdate.type === "notify"
        ) {
          const isGroup = mek.key?.remoteJid?.endsWith("@g.us");
          if (!isGroup) return;
        }

        if (mek.key.id.startsWith("BAE5") && mek.key.id.length === 16) return;

        if (NovaXCode?.msgRetryCounterCache) {
          NovaXCode.msgRetryCounterCache.clear();
        }

        try {
          await handleMessages(NovaXCode, chatUpdate);
        } catch (err) {
          printLog("error", `Error in handleMessages: ${err.message}`);
          if (mek.key && mek.key.remoteJid) {
            await NovaXCode.sendMessage(mek.key.remoteJid, {
              text: "❌ An error occurred while processing your message.",
              contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363429019355682@newsletter",
                  newsletterName: "NOSTRA",
                  serverMessageId: -1,
                },
              },
            }).catch(console.error);
          }
        }
      } catch (err) {
        printLog("error", `Error in messages.upsert: ${err.message}`);
      }
    });

    NovaXCode.decodeJid = (jid) => {
      if (!jid) return jid;
      if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {};
        return (
          (decode.user && decode.server && `${decode.user}@${decode.server}`) ||
          jid
        );
      } else return jid;
    };

    NovaXCode.ev.on("contacts.update", (update) => {
      for (const contact of update) {
        const id = NovaXCode.decodeJid(contact.id);
        if (store && store.contacts)
          store.contacts[id] = { id, name: contact.notify };
      }
    });

    NovaXCode.getName = (jid, withoutContact = false) => {
      const id = NovaXCode.decodeJid(jid);
      withoutContact = NovaXCode.withoutContact || withoutContact;
      let v;
      if (id.endsWith("@g.us"))
        return new Promise(async (resolve) => {
          v = store.contacts[id] || {};
          if (!(v.name || v.subject)) v = NovaXCode.groupMetadata(id) || {};
          resolve(
            v.name ||
              v.subject ||
              PhoneNumber(`+${id.replace("@s.whatsapp.net", "")}`).number
                ?.international,
          );
        });
      else
        v =
          id === "0@s.whatsapp.net"
            ? {
                id,
                name: "WhatsApp",
              }
            : id === NovaXCode.decodeJid(NovaXCode.user.id)
              ? NovaXCode.user
              : store.contacts[id] || {};
      return (
        (withoutContact ? "" : v.name) ||
        v.subject ||
        v.verifiedName ||
        PhoneNumber(`+${jid.replace("@s.whatsapp.net", "")}`).number
          ?.international
      );
    };

    NovaXCode.public = true;
    NovaXCode.serializeM = (m) => smsg(NovaXCode, m, store);

    const isRegistered = state.creds?.registered === true;

    // Plus de génération automatique de pairing code
    if (isRegistered) {
      if (rl && !rlClosed) {
        rl.close();
        rl = null;
      }
    } else {
      printLog(
        "info",
        "🔄 Waiting for connection to establish via web interface...",
      );
      if (rl && !rlClosed) {
        rl.close();
        rl = null;
      }
    }

    NovaXCode.ev.on("connection.update", async (s) => {
      const { connection, lastDisconnect, qr } = s;

      if (connection === "open") {
        printLog("success", "Bot connected successfully!");

        try {
          // 🔄 ENVOI AUTOMATIQUE DU PANNEAU "ABOUT" DIRECTEMENT SUR WHATSAPP
          const botMode = await store.getBotMode();
          const uptime = process.uptime();
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);

          // Récupérer le logo
          const LOGO_URL =
            "https://raw.githubusercontent.com/NOVA-X-Code/Nova-MD/refs/heads/main/assets/logo.PNG";
          let logoBuffer = null;

          try {
            const response = await fetch(LOGO_URL);
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              logoBuffer = Buffer.from(arrayBuffer);
            }
          } catch (_e) {
            // Fallback: logo local
            const localLogoPath = path.join(
              process.cwd(),
              "assets",
              "logo.PNG",
            );
            if (fs.existsSync(localLogoPath)) {
              logoBuffer = fs.readFileSync(localLogoPath);
            }
          }

          // Construction du message en anglais avec style
          let autoAboutText = `╭━━『 *${config.botName || "NOVA-MD"} INFO* 』━⬣\n`;
          autoAboutText += `┃\n`;
          autoAboutText += `┃ ✨ *Status:* ✅ ONLINE\n`;
          autoAboutText += `┃ 🤖 *Version:* ${config.version || "2.5.0"} (Stable)\n`;
          autoAboutText += `┃ ⚙️ *Mode:* ${botMode.toUpperCase()}\n`;
          autoAboutText += `┃ ⏰ *Uptime:* ${hours}h ${minutes}m\n`;
          autoAboutText += `┃ 📊 *Prefixes:* ${config.prefixes.join(" ")}\n`;
          autoAboutText += `┃ 📦 *Plugins:* ${commandHandler.commands.size}\n`;
          autoAboutText += `┃ 💾 *Storage:* ${store.getStats().backend.toUpperCase()}\n`;
          autoAboutText += `┃\n`;
          autoAboutText += `┃━━━━━━━━━━━━━━━━━━⬣\n`;
          autoAboutText += `┃\n`;
          autoAboutText += `┃ 🌐 *JOIN CHANNELS*\n`;
          autoAboutText += `┃\n`;
          autoAboutText += `┃ 💬 *FaceBook:*\n`;
          autoAboutText += `┃ https://www.facebook.com/profile.php?id=61591828051151\n`;
          autoAboutText += `┃\n`;
          autoAboutText += `┃ 📱 *Telegram:*\n`;
          autoAboutText += `┃ https://t.me/addlist/CpQzYQfWwwxmYTk0\n`;
          autoAboutText += `┃\n`;
          autoAboutText += `┃ ▶️ *YouTube:*\n`;
          autoAboutText += `┃ https://youtube.com/@labokingfreesurf\n`;
          autoAboutText += `┃\n`;
          autoAboutText += `┃━━━━━━━━━━━━━━━━━━⬣\n`;
          autoAboutText += `┃\n`;
          autoAboutText += `┃ ✨ _Powered by NOSTRA._\n`;
          autoAboutText += `╰━━━━━━━━━━━━━━⬣`;

          const botNumber = `${NovaXCode.user.id.split(":")[0]}@s.whatsapp.net`;

          // Envoyer le message avec le logo
          if (logoBuffer) {
            await NovaXCode.sendMessage(botNumber, {
              image: logoBuffer,
              caption: autoAboutText,
              contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363429019355682@newsletter",
                  newsletterName: "NOSTRA",
                  serverMessageId: -1,
                },
              },
            });
          } else {
            await NovaXCode.sendMessage(botNumber, {
              text: autoAboutText,
              contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363429019355682@newsletter",
                  newsletterName: "NOSTRA",
                  serverMessageId: -1,
                },
              },
            });
          }

          printLog(
            "success",
            "📥 About message sent successfully to your WhatsApp!",
          );
        } catch (e) {
          printLog(
            "error",
            `Failed to send automatic about message: ${e.message}`,
          );
        }

        const ghostMode = await store.getSetting("global", "stealthMode");
        if (ghostMode && ghostMode.enabled) {
          printLog("info", "👻 STEALTH MODE ACTIVE");
        }

        printLog(
          "success",
          `Connected to => ${JSON.stringify(NovaXCode.user, null, 2)}`,
        );

        await delay(1999);
        try {
          owner = JSON.parse(fs.readFileSync("./data/owner.json", "utf-8"));
        } catch (_e) {}

        printLog("info", `[ ${config.botName || "NOVA-MD"} ]`);
        printLog(
          "info",
          `WA NUMBER  : ${owner[0] || config.ownerNumber || ""}`,
        );
        printLog("success", `Bot Connected Successfully!`);
        printLog("info", `Plugins   : ${commandHandler.commands.size}`);
        printLog("info", `Prefixes   : ${config.prefixes.join(", ")}`);
        printLog("store", `Backend    : ${store.getStats().backend}`);
        console.log();
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          try {
            rmSync("./session", { recursive: true, force: true });
          } catch (_e) {
            /* ignore */
          }
          await delay(3000);
          startNovaXCode();
          return;
        }

        if (shouldReconnect) {
          printLog("connection", "Reconnecting in 5 seconds...");
          await delay(5000);
          startNovaXCode();
        }
      }
    });

    NovaXCode.ev.on("call", async (calls) => {
      await handleCall(NovaXCode, calls);
    });

    NovaXCode.ev.on("group-participants.update", async (update) => {
      await handleGroupParticipantUpdate(NovaXCode, update);
    });

    NovaXCode.ev.on("status.update", async (status) => {
      await handleStatus(NovaXCode, status);
    });

    NovaXCode.ev.on("messages.reaction", async (reaction) => {
      await handleStatus(NovaXCode, reaction);
    });

    return NovaXCode;
  } catch (error) {
    printLog("error", `Error in startNovaXCode: ${error.message}`);
    if (rl && !rlClosed) {
      rl.close();
      rl = null;
    }
    await delay(5000);
    startNovaXCode();
  }
}

async function waitForSessionCreation() {
  printLog("info", "🔄 Waiting for session to be created via web interface...");
  printLog(
    "info",
    `📱 Open http://localhost:${config.port || 5000}/pairing in your browser if it's local`,
  );
  printLog(
    "info",
    "📱 For web servic deployment, click the service URL and add /pairing at the end",
  );

  const maxWaitTime = 30 * 60 * 1000; // 30 minutes
  const startTime = Date.now();
  const checkInterval = 3000; // Check every 3 seconds

  return new Promise((resolve, reject) => {
    const checkLoop = setInterval(() => {
      if (hasValidSession()) {
        clearInterval(checkLoop);
        printLog("success", "✅ Session detected! Starting bot...");
        resolve();
      }

      if (Date.now() - startTime > maxWaitTime) {
        clearInterval(checkLoop);
        reject(new Error("Session creation timeout (30 minutes)"));
      }
    }, checkInterval);
  });
}

async function main() {
  await compileAll();
  await commandHandler.loadCommands();
  printLog("info", "Starting NOVA-MD BOT...");

  // Vérifier si une session existe déjà
  if (hasValidSession()) {
    printLog("success", "✅ Valid session found, starting bot...");
    await delay(3000);
    startNovaXCode().catch((error) => {
      printLog("error", `Fatal error: ${error.message}`);
      if (rl && !rlClosed) rl.close();
      process.exit(1);
    });
  } else {
    printLog("info", "🌐 No session found. Launching web pairing interface...");
    printLog(
      "info",
      `📱 Open http://localhost:${config.port || 5000}/pairing in your browser to connect WhatsApp`,
    );
    printLog("info", "📱 For Render: https://votre-bot.onrender.com/pairing");
    printLog("info", "");
    printLog("info", "Choose one of these methods:");
    printLog("info", "   • QR Code: Scan with WhatsApp > Linked Devices");
    printLog(
      "info",
      "   • Pairing Code: Enter your phone number, get 8-digit code",
    );
    printLog("info", "");

    // Attendre la création de session via l'interface web
    try {
      await waitForSessionCreation();
      printLog("success", "✅ Session detected! Starting bot...");
      await delay(3000);
      startNovaXCode().catch((error) => {
        printLog("error", `Fatal error: ${error.message}`);
        if (rl && !rlClosed) rl.close();
        process.exit(1);
      });
    } catch (error) {
      printLog("error", `Session creation failed: ${error.message}`);
      if (rl && !rlClosed) rl.close();
      process.exit(1);
    }
  }
}

main();

// Session cleanup interval
const sessionDir = path.join(process.cwd(), "session");
setInterval(
  () => {
    if (!fs.existsSync(sessionDir)) return;
    fs.readdir(sessionDir, (err, files) => {
      if (err) return;
      for (const file of files) {
        if (file === "creds.json") continue;
        if (file.startsWith("app-state-sync-key-")) continue;
        fs.unlink(path.join(sessionDir, file), () => {});
      }
    });
  },
  3 * 60 * 1000,
);

// Temp folder setup
const customTemp = path.join(process.cwd(), "temp");
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Temp folder cleanup
setInterval(
  () => {
    fs.readdir(customTemp, (err, files) => {
      if (err) return;
      for (const file of files) {
        const filePath = path.join(customTemp, file);
        fs.stat(filePath, (err, stats) => {
          if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
            fs.unlink(filePath, () => {});
          }
        });
      }
    });
  },
  1 * 60 * 60 * 1000,
);

// Syntax check dist files
const folders = [
  path.join(__dirname, "./lib"),
  path.join(__dirname, "./plugins"),
];
folders.forEach((folder) => {
  if (!fs.existsSync(folder)) return;
  fs.readdirSync(folder)
    .filter((file) => file.endsWith(".js"))
    .forEach((file) => {
      const filePath = path.join(folder, file);
      try {
        const code = fs.readFileSync(filePath, "utf-8");
        const err = syntaxerror(code, file, {
          sourceType: "module",
          allowAwaitOutsideFunction: true,
        });
        if (err) {
          console.error(chalk.red(`❌ Syntax error in ${filePath}:\n${err}`));
        }
      } catch (e) {
        console.error(chalk.yellow(`⚠️ Cannot read file ${filePath}:\n${e}`));
      }
    });
});

// Error handlers
process.on("uncaughtException", (err) => {
  printLog("error", `Uncaught Exception: ${err.message}`);
  console.error(err.stack);
  writeErrorLog({
    type: "uncaughtException",
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  });
});

process.on("unhandledRejection", (err) => {
  printLog("error", `Unhandled Rejection: ${err.message}`);
  console.error(err.stack);
  writeErrorLog({
    type: "unhandledRejection",
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    printLog("error", `Address localhost:${PORT} in use`);
    writeErrorLog({
      type: "serverError",
      error: `Address localhost:${PORT} in use`,
      timestamp: new Date().toISOString(),
    });
    server.close();
  } else {
    printLog("error", `Server error: ${error.message}`);
    writeErrorLog({
      type: "serverError",
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }
});
