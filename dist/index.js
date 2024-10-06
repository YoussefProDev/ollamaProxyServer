"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_proxy_1 = __importDefault(require("http-proxy"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const csv_writer_1 = require("csv-writer");
// Create an express app
const app = (0, express_1.default)();
const proxy = http_proxy_1.default.createProxyServer({});
app.set("trust proxy", true);
// Path to the authorized users file and log file
const apiKeysFilePath = path_1.default.join(__dirname, "api_keys.json");
const logFilePath = path_1.default.join(__dirname, "access_log.csv");
let apiKeys = {};
if (fs_1.default.existsSync(apiKeysFilePath)) {
    apiKeys = JSON.parse(fs_1.default.readFileSync(apiKeysFilePath, "utf8"));
}
// CSV Writer for logging
const csvWriter = (0, csv_writer_1.createObjectCsvWriter)({
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
function getClientIp(req) {
    var _a;
    const xForwardedFor = req.headers["x-forwarded-for"];
    if (xForwardedFor) {
        const ipArray = xForwardedFor.split(",");
        return ipArray[0].trim(); // The first IP is the original client IP
    }
    return (_a = req.ip) !== null && _a !== void 0 ? _a : "IP Not Found"; // Default to the request IP if no X-Forwarded-For header is present
}
// Logging function
function logAccess(event, user, req, server, queueSize, error = "") {
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
function authMiddleware(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(403).json({ message: "Access Denied" });
        logAccess("rejected", "unknown", req, "None", -1, "Missing or Invalid Token");
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
    req.user = apiKey.name;
    next();
}
// Simple load balancer: Choose the least busy server
let servers = [{ url: "http://localhost:11434", queue: 0 }];
function getLeastBusyServer() {
    return servers.reduce((prev, curr) => prev.queue < curr.queue ? prev : curr);
}
// Proxy route
app.use(authMiddleware);
app.post("/api/*", (req, res) => {
    const targetServer = getLeastBusyServer();
    logAccess("gen_request", req.user, req, targetServer.url, targetServer.queue);
    targetServer.queue++;
    proxy.web(req, res, { target: targetServer.url });
    proxy.on("end", () => {
        targetServer.queue--;
        logAccess("gen_done", req.user, req, targetServer.url, targetServer.queue);
    });
    proxy.on("error", (error) => {
        targetServer.queue--;
        logAccess("gen_error", req.user, req, targetServer.url, targetServer.queue, error.message);
        res.status(500).send("Server error");
    });
});
// Start the server
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
