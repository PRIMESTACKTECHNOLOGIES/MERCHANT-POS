"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
async function initializeDatabase() {
    const db = await (0, sqlite_1.open)({
        filename: path_1.default.join(__dirname, '../database.sqlite'),
        driver: sqlite3_1.default.Database
    });
    console.log('Initializing Protocol 201.3 database...');
    // Read the schema file
    const schemaPath = path_1.default.join(__dirname, 'schema_2013_complete.sql');
    if (!fs_1.default.existsSync(schemaPath)) {
        console.error('Schema file not found:', schemaPath);
        await db.close();
        return;
    }
    const schema = fs_1.default.readFileSync(schemaPath, 'utf-8');
    // Split by semicolons and execute each statement
    const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
    for (const statement of statements) {
        try {
            await db.exec(statement.trim());
            console.log('✓ Executed statement');
        }
        catch (err) {
            // Ignore errors for IF NOT EXISTS and INSERT OR IGNORE
            if (!err.message.includes('already exists') &&
                !err.message.includes('UNIQUE constraint failed')) {
                console.error('Error executing statement:', err.message);
            }
        }
    }
    console.log('\n✅ Database initialized successfully!');
    console.log('\nDefault Data:');
    console.log('- Merchant: MRC-1001 (API Key: sk_test_mock_key_12345)');
    console.log('- Terminal: T2013-001');
    console.log('- Payment Codes: 123456, 999999, 888888');
    await db.close();
}
initializeDatabase().catch(console.error);
