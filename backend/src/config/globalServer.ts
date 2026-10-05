function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for global-server settlement`);
  }
  return value;
}

export function getGlobalServerConfig() {
  return {
    baseUrl: requiredEnv('GLOBAL_SERVER_URL').replace(/\/+$/, ''),
    apiKey: requiredEnv('GLOBAL_API_KEY'),
    apiSecret: requiredEnv('GLOBAL_API_SECRET'),
  };
}
