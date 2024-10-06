import express, { Request, Response, NextFunction } from "express";
import httpProxy from "http-proxy";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { createObjectCsvWriter } from "csv-writer";

// Create an express app
const app = express();
const proxy = httpProxy.createProxyServer({});
app.set("trust proxy", true);
// Path to the authorized users file and log file
const apiKeysFilePath = path.join(process.cwd(), "api_keys.json");
const logFilePath = path.join(process.cwd(), "access_log.csv");

// Load API keys from JSON file
interface ApiKey {
  name: string;
  description: string;
}

let apiKeys: { [key: string]: ApiKey } = {};
if (fs.existsSync(apiKeysFilePath)) {
  apiKeys = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
}

// CSV Writer for logging
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

// Function to retrieve the client IP address, considering X-Forwarded-For
function getClientIp(req: Request): string {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) {
    const ipArray = (xForwardedFor as string).split(",");
    return ipArray[0].trim(); // The first IP is the original client IP
  }
  return req.ip ?? "IP Not Found"; // Default to the request IP if no X-Forwarded-For header is present
}

// Logging function
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

// Middleware for API key authentication
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

  // Store user in request object
  (req as any).user = apiKey.name;
  next();
}

// Simple load balancer: Choose the least busy server
let servers = [{ url: "http://localhost:11434", queue: 0 }];

function getLeastBusyServer() {
  return servers.reduce((prev, curr) =>
    prev.queue < curr.queue ? prev : curr
  );
}

// Proxy route
app.use(authMiddleware);

app.post("/api/*", (req: Request, res: Response) => {
  const targetServer = getLeastBusyServer();
  logAccess(
    "gen_request",
    (req as any).user,
    req,
    targetServer.url,
    targetServer.queue
  );

  targetServer.queue++;

  proxy.web(req, res, { target: targetServer.url });

  proxy.on("end", () => {
    targetServer.queue--;
    logAccess(
      "gen_done",
      (req as any).user,
      req,
      targetServer.url,
      targetServer.queue
    );
  });

  proxy.on("error", (error) => {
    targetServer.queue--;
    logAccess(
      "gen_error",
      (req as any).user,
      req,
      targetServer.url,
      targetServer.queue,
      error.message
    );
    res.status(500).send("Server error");
  });
});

// Start the server
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
