# Como colocar no Railway em 5 minutos

## Passo 1 — Criar repositório no GitHub

1. Acesse https://github.com/new
2. Nome: `whatsapp-server`
3. Clique em **Create repository**
4. Copie os comandos que o GitHub mostra e rode no terminal

OU use o GitHub Desktop / arrastar os arquivos para o repositório.

## Passo 2 — Fazer deploy no Railway

1. Acesse https://railway.app e faça login
2. Clique em **New Project → Deploy from GitHub repo**
3. Selecione o repositório `whatsapp-server`
4. Railway vai detectar automaticamente e iniciar o deploy

## Passo 3 — Configurar variável de ambiente

No painel do Railway:
1. Clique no serviço → aba **Variables**
2. Adicione:
   - Chave: `BACKEND_TOKEN`
   - Valor: (crie uma senha forte, ex: `IntegraZap@2024`)
3. Clique em **Add**

## Passo 4 — Pegar a URL

1. Aba **Settings → Domains**
2. Copie a URL (ex: `meu-servidor.up.railway.app`)

## Passo 5 — Configurar no IntegraZap

1. Abra o IntegraZap → Configurações → **WhatsApp Direto (QR Code)**
2. Cole a URL no campo **URL do Servidor**
3. Cole o token no campo **Token do Backend**
4. Clique em **Salvar configuração**
5. Clique em **Gerar QR Code**
6. Escaneie com o WhatsApp!

---

## Endpoints disponíveis

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /start | Inicia sessão e gera QR |
| GET | /qr | Retorna QR Code em base64 |
| GET | /status | Status da conexão |
| POST | /stop | Desconecta e limpa sessão |
| POST | /send | Envia mensagem { to, message } |
| POST | /send-bulk | Envia em massa |
| GET | /health | Healthcheck público |

Todos os endpoints (exceto /health) precisam do header:
`x-backend-token: SEU_TOKEN`
