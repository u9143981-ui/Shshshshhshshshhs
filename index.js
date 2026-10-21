const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// ==================== CONFIG ====================
const BOT_TOKEN = "8904819586:AAHQPi5vL5gpQYBZszapbK77yIoI3jk4YDU";
const API_ID = 29612794;
const API_HASH = '6edc1a58a202c9f6e62dc98466932bad';
const ADMIN_ID = "7904483885"; // Aapki Admin ID

// Checker Bot Settings
const CHECKER_BOT = "DazaiccBot";
const CHECKER_CMD = "/au"; 
const TIMEOUT_SECONDS = 30;

const sessionDir = "./sessions";
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

let clients = [];
let waitingForFile = {};

app.get('/', (req, res) => res.send("Combo Bot is running safely!"));
app.listen(port, () => console.log("System active on port " + port));

// ==================== HELPER FUNCTIONS ====================
function extractChatIdentifier(url) {
    if (!url) return null;
    url = url.trim();
    if (!url.includes('t.me/')) return url.replace('@', '');
    if (url.includes('t.me/+') || url.includes('joinchat/')) return url.split('+').pop().split('/').pop();
    let cleanUrl = url.split('?')[0]; 
    return cleanUrl.split('t.me/').pop().split('/').pop(); 
}

async function loadAllSessions() {
    clients = [];
    const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.session'));
    for (const file of files) {
        try {
            const sessionStr = fs.readFileSync(path.join(sessionDir, file), 'utf8').trim();
            if (!sessionStr) continue;
            const client = new TelegramClient(new StringSession(sessionStr), API_ID, API_HASH, { connectionRetries: 5 });
            await client.connect();
            clients.push(client);
        } catch (e) { console.log("Failed to load: " + file); }
    }
}

function validateCard(cardInput) {
    let clean = cardInput.trim().replace(/ /g, '');
    if (clean.includes('|') || clean.includes(':')) {
        let parts = clean.split(/[|:]/);
        if (parts.length >= 4) {
            let card = parts[0];
            let month = parts[1].padStart(2, '0');
            let year = parts[2].length === 4 ? parts[2].slice(-2) : parts[2].padStart(2, '0');
            let cvv = parts[3];
            if (card.match(/^\d{15,16}$/) && parseInt(month) >= 1 && parseInt(month) <= 12) {
                return `${card}|${month}|${year}|${cvv}`;
            }
        }
    }
    return null;
}

// ==================== MAIN INIT ====================
async function init() {
    console.log("SYSTEM BOOTING: COMBO BOT");
    await loadAllSessions();

    const botClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, { connectionRetries: 5 });
    await botClient.start({ botAuthToken: BOT_TOKEN });
    console.log("Control Bot Online!");

    botClient.addEventHandler(async (event) => {
        const message = event.message;
        if (!message) return;

        const senderId = message.senderId ? message.senderId.toString() : "unknown";
        const isAdmin = senderId === ADMIN_ID;

        // FILE UPLOAD HANDLING (SESLOG)
        if (waitingForFile[senderId] && isAdmin) {
            if (message.text && message.text.toLowerCase() === "/sescancel") {
                delete waitingForFile[senderId];
                return message.reply({ message: "File upload cancelled." });
            }

            if (message.media && message.media.document) {
                const fileName = message.media.document.attributes.find(a => a.className === 'DocumentAttributeFilename')?.fileName || "file";
                
                if (!fileName.endsWith('.session') && !fileName.endsWith('.zip')) {
                    return message.reply({ message: "Invalid file. Send .session or .zip, or type /sescancel." });
                }

                await message.reply({ message: "Processing file... Please wait." });
                delete waitingForFile[senderId];

                try {
                    const buffer = await message.downloadMedia();
                    const filesToLoad = [];

                    if (fileName.endsWith('.session')) {
                        filesToLoad.push({ name: fileName, data: buffer.toString('utf8') });
                    } else if (fileName.endsWith('.zip')) {
                        const zip = new AdmZip(buffer);
                        for (const entry of zip.getEntries()) {
                            if (entry.entryName.endsWith('.session')) {
                                filesToLoad.push({ name: entry.entryName, data: entry.getData().toString('utf8') });
                            }
                        }
                    }

                    let loadedCount = 0;
                    for (const file of filesToLoad) {
                        const tempClient = new TelegramClient(new StringSession(file.data.trim()), API_ID, API_HASH, { connectionRetries: 1 });
                        try {
                            await tempClient.connect();
                            const me = await tempClient.getMe();
                            const cleanPhone = me.phone ? me.phone.toString() : "Unknown";
                            const newFileName = "Account " + (clients.length + 1) + " [" + cleanPhone + "].session";
                            
                            fs.writeFileSync(path.join(sessionDir, newFileName), tempClient.session.save());
                            clients.push(tempClient);
                            loadedCount++;
                        } catch (e) {}
                    }
                    await message.reply({ message: loadedCount + " sessions loaded successfully!" });
                } catch (e) {
                    await message.reply({ message: "Error: " + e.message });
                }
                return;
            } else {
                return message.reply({ message: "Please send a valid .session or .zip file." });
            }
        }

        if (!message.text) return;
        const args = message.text.split(" ");
        const command = args[0].toLowerCase();

        // ==================== /START & /CMDS ====================
        if (command === "/start") {
            await message.reply({ message: "Welcome to Combo Bot!\n\n/cmds to see commands." });
        }
        else if (command === "/cmds") {
            let text = "User Commands:\n/chk - Check Card\n/bin - Check BIN\n\n";
            if (isAdmin) {
                text += "Admin Commands:\n/seslog - Upload Sessions\n/getsession - Download Sessions\n/joinvc [link] - Join VC\n/leavevc - Leave VC\n/stats - Check Stats";
            }
            await message.reply({ message: text });
        }

        // ==================== /CHK (CARD CHECK) ====================
        else if (command === "/chk") {
            let cardInput = message.replyToMsgId ? null : args.slice(1).join(" ");
            // Agar reply kiya hai toh (NodeJS gramJS mein reply text nikalna thoda complex hai, filhal args se le rahe hain)
            if (!cardInput) return message.reply({ message: "Usage: /chk cc|mm|yy|cvv" });

            const parsedCard = validateCard(cardInput);
            if (!parsedCard) return message.reply({ message: "Invalid card format." });
            if (clients.length === 0) return message.reply({ message: "No accounts available for check." });

            const msg = await message.reply({ message: "Checking card... Please wait." });
            
            // Random client pick karo check ke liye
            const checkClient = clients[Math.floor(Math.random() * clients.length)];
            
            try {
                const checkerEntity = await checkClient.getEntity(CHECKER_BOT);
                await checkClient.sendMessage(checkerEntity, { message: `${CHECKER_CMD} ${parsedCard}` });
                
                let found = false;
                let startTime = Date.now();

                while (Date.now() - startTime < TIMEOUT_SECONDS * 1000) {
                    await new Promise(r => setTimeout(r, 2000));
                    
                    const messages = await checkClient.getMessages(checkerEntity, { limit: 1 });
                    if (messages.length > 0) {
                        const replyText = messages[0].message;
                        if (replyText && (replyText.includes("CC:") || replyText.includes("Status:"))) {
                            await botClient.editMessage(message.chatId, { message: msg.id, text: replyText });
                            found = true;
                            break;
                        }
                    }
                }

                if (!found) {
                    await botClient.editMessage(message.chatId, { message: msg.id, text: "❌ Timeout: No response from gateway." });
                }

            } catch (e) {
                await botClient.editMessage(message.chatId, { message: msg.id, text: "❌ Error: " + e.message });
            }
        }

        // ==================== ADMIN ONLY COMMANDS ====================
        else if (isAdmin) {
            if (command === "/seslog") {
                waitingForFile[senderId] = true;
                await message.reply({ message: "Please send your .session or .zip file now.\n\n(To cancel, type /sescancel)" });
            }
            else if (command === "/sescancel") {
                await message.reply({ message: "Nothing to cancel." });
            }
            else if (command === "/getsession" || command === "/getsallses") {
                const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.session'));
                if (files.length === 0) return message.reply({ message: "No sessions found." });

                if (files.length === 1) {
                    const filePath = path.join(sessionDir, files[0]);
                    await botClient.sendFile(message.chatId, { file: filePath, forceDocument: true });
                } else {
                    const zip = new AdmZip();
                    for (const file of files) zip.addLocalFile(path.join(sessionDir, file));
                    const zipPath = path.join(__dirname, "All_Accounts.zip");
                    zip.writeZip(zipPath); 
                    
                    await botClient.sendFile(message.chatId, {
                        file: zipPath,
                        caption: `All Sessions (${files.length})`,
                        forceDocument: true
                    });
                    setTimeout(() => { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); }, 5000);
                }
            }
            else if (command === "/stats") {
                await message.reply({ message: `Total Active Sessions: ${clients.length}` });
            }
            else if (command === "/joinvc") {
                const rawLink = args[1];
                if (!rawLink) return message.reply({ message: "Usage: /joinvc https://t.me/link" });
                if (clients.length === 0) return message.reply({ message: "No accounts loaded." });
                
                await message.reply({ message: `Deploying ${clients.length} accounts...` });
                const isPrivate = rawLink.includes('+') || rawLink.includes('joinchat/');
                const cleanLink = extractChatIdentifier(rawLink);

                for (let i = 0; i < clients.length; i++) {
                    try {
                        let chatEntity;
                        if (isPrivate) {
                            try {
                                const result = await clients[i].invoke(new Api.messages.ImportChatInvite({ hash: cleanLink }));
                                chatEntity = result.chats[0];
                            } catch (e) {
                                if (e.errorMessage === 'USER_ALREADY_PARTICIPANT' || e.message.includes('USER_ALREADY_PARTICIPANT')) throw new Error("Already in group");
                                else throw e;
                            }
                        } else {
                            chatEntity = await clients[i].getEntity(cleanLink);
                        }

                        let callObject;
                        try {
                            const full = await clients[i].invoke(new Api.channels.GetFullChannel({ channel: chatEntity }));
                            callObject = full.fullChat.call;
                        } catch (e) {
                            const full = await clients[i].invoke(new Api.messages.GetFullChat({ chatId: chatEntity.id }));
                            callObject = full.fullChat.call;
                        }

                        if (!callObject) throw new Error("No active VC found.");

                        const joinParams = {
                            call: callObject,
                            joinAs: await clients[i].getMe(),
                            params: new Api.DataJSON({ data: JSON.stringify({ ssrc: Math.floor(Math.random() * 100000000) }) }),
                            muted: true
                        };

                        await clients[i].invoke(new Api.phone.JoinGroupCall(joinParams));
                        clients[i].currentCall = callObject;

                        if (clients[i].vcInterval) clearInterval(clients[i].vcInterval);
                        clients[i].vcInterval = setInterval(async () => {
                            try {
                                await clients[i].invoke(new Api.phone.JoinGroupCall(joinParams));
                            } catch (err) {
                                try {
                                    await clients[i].invoke(new Api.phone.JoinGroupCall({
                                        call: callObject, joinAs: await clients[i].getMe(),
                                        params: new Api.DataJSON({ data: JSON.stringify({ ssrc: Math.floor(Math.random() * 100000000) }) }), muted: true
                                    }));
                                } catch (e) {}
                            }
                        }, 10000);

                        await new Promise(r => setTimeout(r, 1000)); 
                    } catch (e) { console.log(`Acc Error: ` + e.message); }
                }
                await message.reply({ message: "Process Completed!" });
            }
            else if (command === "/leavevc") {
                for (let i = 0; i < clients.length; i++) {
                    try {
                        if (clients[i].vcInterval) { clearInterval(clients[i].vcInterval); clients[i].vcInterval = null; }
                        if (clients[i].currentCall) {
                            await clients[i].invoke(new Api.phone.LeaveGroupCall({ call: clients[i].currentCall, source: 0 }));
                            clients[i].currentCall = null;
                        }
                    } catch (e) {}
                }
                await message.reply({ message: "All accounts left VC." });
            }
        }
    }, new NewMessage({ incoming: true }));
}

init().catch(console.error);
