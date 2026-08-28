import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';

async function initializeDatabase() {
  const db = await open({
    filename: path.join(__dirname, '../database.sqlite'),
    driver: sqlite3.Database
  });

  console.log('Initializing Protocol 201.3 database...');

  // Read the schema file
  const schemaPath = path.join(__dirname, 'schema_2013_complete.sql');
  
  if (!fs.existsSync(schemaPath)) {
    console.error('Schema file not found:', schemaPath);
    await db.close();
    return;
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8');
  
  // Split by semicolons and execute each statement
  const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
  
  for (const statement of statements) {
    try {
      await db.exec(statement.trim());
      console.log('✓ Executed statement');
    } catch (err: any) {
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
