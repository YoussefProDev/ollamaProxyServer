import express, { Request, Response, NextFunction } from "express";
import httpProxy from "http-proxy";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { createObjectCsvWriter } from "csv-writer";
import axios from "axios"; // Usato per fare la richiesta verso Ollama o altro server

// Crea un'istanza di Express
const app = express();
const proxy = httpProxy.createProxyServer({});
app.set("trust proxy", true);

// Percorsi per il file delle API key e il log
const apiKeysFilePath = path.join(process.cwd(), "api_keys.json");
const logFilePath = path.join(process.cwd(), "access_log.csv");

// Carica le API key dal file JSON
interface ApiKey {
  name: string;
  description: string;
}

let apiKeys: { [key: string]: ApiKey } = {};
if (fs.existsSync(apiKeysFilePath)) {
  apiKeys = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
}

// CSV Writer per il log degli accessi
const csvWriter = createObjectCsvWriter({
  path: logFilePath,
  header: [
    { id: "timestamp", title: "TIMESTAMP" },
    { id: "event", title: "EVENT" },
    { id: "user", title: "USER" },
    { id: "ip", title: "IP ADDRESS" },
    { id: "server", title: "SERVER" },
    { id: "queue", title: "QUEUE SIZE" },
    { id: "error", title: "ERROR" },
  ],
  append: true,
});

// Funzione per recuperare l'indirizzo IP del client
function getClientIp(req: Request): string {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) {
    const ipArray = (xForwardedFor as string).split(",");
    return ipArray[0].trim(); // Il primo IP è quello del client originale
  }
  return req.ip ?? "IP Not Found"; // Default se non ci sono header
}

// Funzione di logging
function logAccess(
  event: string,
  user: string,
  req: Request,
  server: string,
  queueSize: number,
  error: string = ""
) {
  const clientIp = getClientIp(req);
  csvWriter.writeRecords([
    {
      timestamp: new Date().toISOString(),
      event,
      user,
      ip: clientIp,
      server,
      queue: queueSize,
      error,
    },
  ]);
}

// Middleware per autenticazione tramite API key
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(403).json({ message: "Access Denied" });
    logAccess(
      "rejected",
      "unknown",
      req,
      "None",
      -1,
      "Missing or Invalid Token"
    );
    return;
  }

  const token = authHeader.split(" ")[1];
  const apiKey = apiKeys[token];

  if (!apiKey) {
    res.status(403).json({ message: "Invalid API Key" });
    logAccess("rejected", "unknown", req, "None", -1, "Invalid API Key");
    return;
  }

  // Aggiunge l'utente alla richiesta
  (req as any).user = apiKey.name;
  next();
}

// Lista dei server finali (puoi aggiungere o cambiare l'URL del server finale qui)
let servers = [{ url: "http://ollama-server.com/api/generate", queue: 0 }];

// Funzione per ottenere il server meno occupato
function getLeastBusyServer() {
  return servers.reduce((prev, curr) =>
    prev.queue < curr.queue ? prev : curr
  );
}

// Middleware di autenticazione
app.use(authMiddleware);

// Route principale per le richieste POST
app.post("/api/*", async (req: Request, res: Response) => {
  const targetServer = getLeastBusyServer();
  logAccess(
    "gen_request",
    (req as any).user,
    req,
    targetServer.url,
    targetServer.queue
  );

  targetServer.queue++;

  try {
    // Inoltra la richiesta dal backend a Ollama o al server finale tramite Axios
    const response = await axios({
      method: "post",
      url: targetServer.url, // URL del server Ollama o altro
      headers: {
        Authorization: req.headers["authorization"], // Mantieni l'API key
        "Content-Type": "application/json", // Assumi JSON, ma puoi cambiare
      },
      data: req.body, // Forward del body
    });

    // Manda la risposta del server finale al client originale
    res.status(response.status).send(response.data);

    logAccess(
      "gen_done",
      (req as any).user,
      req,
      targetServer.url,
      targetServer.queue
    );
  } catch (error: any) {
    logAccess(
      "gen_error",
      (req as any).user,
      req,
      targetServer.url,
      targetServer.queue,
      error.message
    );
    res.status(500).send("Server error");
  } finally {
    targetServer.queue--;
  }
});

// Avvia il server proxy su localhost:3006
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
