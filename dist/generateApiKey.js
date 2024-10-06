"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const uuid_1 = require("uuid");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Path to the API keys file
const apiKeysFilePath = path_1.default.join(__dirname, "api_keys.json");
// Load existing API keys
let apiKeys = {};
if (fs_1.default.existsSync(apiKeysFilePath)) {
    apiKeys = JSON.parse(fs_1.default.readFileSync(apiKeysFilePath, "utf8"));
}
// Function to generate a new API key
function generateApiKey(name, description) {
    const token = (0, uuid_1.v4)();
    apiKeys[token] = { name, description };
    // Save to the file
    fs_1.default.writeFileSync(apiKeysFilePath, JSON.stringify(apiKeys, null, 2));
    console.log(`API Key generated for ${name}: ${token}`);
}
// Usage
const name = process.argv[2];
const description = process.argv[3];
if (!name || !description) {
    console.log("Usage: ts-node generateApiKey.ts <name> <description>");
}
else {
    generateApiKey(name, description);
}
