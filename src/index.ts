import express, { Request, Response, NextFunction } from "express";
import httpProxy from "http-proxy";
import fs from "fs";
import path from "path";
import { createObjectCsvWriter } from "csv-writer";
import axios, { AxiosResponse } from "axios"; // Importa AxiosResponse
import { Readable } from "stream";

// Crea un'app Express
const app = express();
const proxy = httpProxy.createProxyServer({});
app.set("trust proxy", true);
app.use(express.json()); // Aggiungi il middleware per il parsing JSON

// Percorso per il file delle API key e il file di log
const apiKeysFilePath = path.join(process.cwd(), "api_keys.json");
const logFilePath = path.join(process.cwd(), "access_log.csv");

// Carica le API key dal file JSON
let apiKeys: { [key: string]: { name: string; description: string } } = {};
if (fs.existsSync(apiKeysFilePath)) {
  apiKeys = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
}

// CSV Writer per il logging
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

// Funzione per recuperare l'IP del client
function getClientIp(req: Request): string {
  const xForwardedFor = req.headers["x-forwarded-for"];
  return xForwardedFor
    ? (xForwardedFor as string).split(",")[0].trim()
    : req.ip || "IP Not Found";
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

// Middleware per l'autenticazione delle API key
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

  (req as any).user = apiKey.name; // Salva l'utente nella richiesta
  next();
}

// Server proxy
app.post("/*", authMiddleware, async (req: Request, res: Response) => {
  const targetServerUrl = `http://localhost:11434${req.originalUrl}`; // Costruisci l'URL di destinazione

  try {
    const responseStream: AxiosResponse<Readable> = await axios.post(
      targetServerUrl,
      req.body,
      {
        headers: {
          Authorization: req.headers["authorization"],
          "Content-Type": "application/json",
        },
        responseType: "stream", // Imposta il tipo di risposta su stream
//	timeout: 60000, // Aumenta il timeout a 60 secondi     

 }
    );

    // Imposta l'intestazione per il contenuto JSON
    res.setHeader("Content-Type", "application/json");

    // Ascolta i dati dalla risposta in streaming
    responseStream.data.on("data", (chunk: Buffer) => {
      const responseText = chunk.toString(); // Converte il buffer in stringa
      res.write(responseText); // Scrive il chunk nella risposta al client
    });

    // Gestisci la fine dello stream
    responseStream.data.on("end", () => {
      res.end(); // Termina la risposta quando lo stream è finito
    });

    // Gestisci gli errori
    responseStream.data.on("error", (error: unknown) => {
      // Usa 'unknown' per il tipo di errore
      console.error("Error in stream:", error);
      res.status(500).json({ message: "Server error", error: String(error) }); // Converti l'errore in stringa
    });

    logAccess("gen_request", (req as any).user, req, targetServerUrl, 1);
  } catch (error: unknown) {
    console.error("Error forwarding request to Ollama:", error);
    const errorMessage = (error as any).response?.data || String(error); // Converti l'errore in stringa
    res.status(500).json({ message: "Server error", error: errorMessage });
    logAccess(
      "gen_error",
      (req as any).user,
      req,
      targetServerUrl,
      1,
      String(errorMessage)
    );
  }
});

// Avvia il server
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
