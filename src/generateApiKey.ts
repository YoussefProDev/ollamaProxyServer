import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

// Path to the API keys file
const apiKeysFilePath = path.join(__dirname, "api_keys.json");

// Define the structure of the API key entry
interface ApiKey {
  name: string;
  description: string;
}

// Load existing API keys
let apiKeys: { [key: string]: ApiKey } = {};
if (fs.existsSync(apiKeysFilePath)) {
  apiKeys = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
}

// Function to generate a new API key
function generateApiKey(name: string, description: string) {
  const token = uuidv4();
  apiKeys[token] = { name, description };

  // Save to the file
  fs.writeFileSync(apiKeysFilePath, JSON.stringify(apiKeys, null, 2));
  console.log(`API Key generated for ${name}: ${token}`);
}

// Usage
const name = process.argv[2];
const description = process.argv[3];

if (!name || !description) {
  console.log("Usage: ts-node generateApiKey.ts <name> <description>");
} else {
  generateApiKey(name, description);
}
