import express from "express";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode";
import { existsSync, rmSync } from "fs";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BACKEND_TOKEN = process.env.BACKEND_TOKEN || "meu-token-secreto";

// ── Estado global ────────────────────────────────────────────────────────────
let sock = null;
let currentQR = null;
let connectionStatus = "desconectado"; // desconectado | aguardando_qr | conectado
let qrDataURL = null;

// ── Middleware de autenticação ───────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers["x-backend-token"];
  if (!token || token !== BACKEND_TOKEN) {
    return res.status(401).json({ error: "Token inválido" });
  }
  next();
}

// ── Logger silencioso para Baileys ──────────────────────────────────────────
const logger = pino({ level: "silent" });

// ── Iniciar sessão WhatsApp ──────────────────────────────────────────────────
async function startSession() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["IntegraZap", "Chrome", "120.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      connectionStatus = "aguardando_qr";
      qrDataURL = await qrcode.toDataURL(qr);
      console.log("QR Code gerado — escaneie com o WhatsApp");
    }

    if (connection === "open") {
      connectionStatus = "conectado";
      currentQR = null;
      qrDataURL = null;
      console.log("WhatsApp conectado com sucesso!");
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`Conexão encerrada. Motivo: ${reason}. Reconectando: ${shouldReconnect}`);

      connectionStatus = "desconectado";
      currentQR = null;
      qrDataURL = null;

      if (shouldReconnect) {
        setTimeout(startSession, 3000);
      } else {
        sock = null;
      }
    }
  });
}

// ── Rotas ────────────────────────────────────────────────────────────────────

// Healthcheck público
app.get("/health", (_req, res) => {
  res.json({ ok: true, status: connectionStatus });
});

// POST /start — inicia a sessão e gera o QR
app.post("/start", auth, async (req, res) => {
  try {
    if (sock && connectionStatus === "conectado") {
      return res.json({ status: "ja_conectado", message: "WhatsApp já está conectado" });
    }
    if (connectionStatus === "aguardando_qr") {
      return res.json({ status: "aguardando_qr", message: "QR Code já está disponível em /qr" });
    }
    await startSession();
    res.json({ status: "iniciando", message: "Sessão iniciada — aguarde o QR Code em /qr" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /qr — retorna o QR Code em base64
app.get("/qr", auth, (req, res) => {
  if (connectionStatus === "conectado") {
    return res.json({ status: "conectado", qr: null });
  }
  if (!qrDataURL) {
    return res.json({ status: connectionStatus, qr: null, message: "QR ainda não disponível — chame /start primeiro" });
  }
  res.json({ status: "aguardando_qr", qr: qrDataURL });
});

// GET /status — retorna status da conexão
app.get("/status", auth, (req, res) => {
  const phone = sock?.user?.id?.split(":")[0] || null;
  res.json({
    status: connectionStatus,
    phone,
    connected: connectionStatus === "conectado",
  });
});

// POST /stop — desconecta e limpa sessão
app.post("/stop", auth, async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
      sock = null;
    }
    if (existsSync("auth_info_baileys")) {
      rmSync("auth_info_baileys", { recursive: true, force: true });
    }
    connectionStatus = "desconectado";
    currentQR = null;
    qrDataURL = null;
    res.json({ status: "desconectado", message: "Sessão encerrada e dados removidos" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /send — envia mensagem de texto
app.post("/send", auth, async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: "Campos 'to' e 'message' são obrigatórios" });
  }
  if (connectionStatus !== "conectado") {
    return res.status(503).json({ error: "WhatsApp não está conectado" });
  }

  try {
    // Normaliza número: só dígitos + @s.whatsapp.net
    const jid = to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    res.json({ status: "enviado", to: jid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /send-bulk — envia em massa (array de { to, message })
app.post("/send-bulk", auth, async (req, res) => {
  const { messages, delay = 1500 } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Campo 'messages' deve ser um array não vazio" });
  }
  if (connectionStatus !== "conectado") {
    return res.status(503).json({ error: "WhatsApp não está conectado" });
  }

  const results = [];
  for (const { to, message } of messages) {
    try {
      const jid = to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text: message });
      results.push({ to, status: "enviado" });
    } catch (err) {
      results.push({ to, status: "erro", error: err.message });
    }
    await new Promise((r) => setTimeout(r, delay));
  }

  res.json({ total: messages.length, results });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Servidor WhatsApp rodando na porta ${PORT}`);
  console.log(`Token configurado: ${BACKEND_TOKEN.slice(0, 4)}${"*".repeat(Math.max(0, BACKEND_TOKEN.length - 4))}`);
});
