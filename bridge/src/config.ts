export type BridgeConfig = {
  relayUrl: string;
  pilotBaseUrl: string;
  pilotApiKey: string;
  gatewayPrivateKey: string;
  dbPath: string;
  port: number;
  admin: { crewCliPath: string; relayAdminKeyPath: string };
};

const HEX64 = /^[0-9a-f]{64}$/i;

export function loadConfig(
  env: Record<string, string | undefined>,
  dbPathFallback = "./bridge.db",
): BridgeConfig {
  const req = (name: string): string => {
    const v = env[name];
    if (!v || v.length === 0) throw new Error(`Missing env ${name}`);
    return v;
  };
  const gatewayPrivateKey = req("CREW_GATEWAY_PRIVATE_KEY");
  if (!HEX64.test(gatewayPrivateKey)) {
    throw new Error("CREW_GATEWAY_PRIVATE_KEY must be 64 hex chars");
  }
  return {
    relayUrl: req("CREW_RELAY_URL"),
    pilotBaseUrl: req("PILOT_BASE_URL").replace(/\/$/, ""),
    pilotApiKey: req("PILOT_API_KEY"),
    gatewayPrivateKey,
    dbPath: env["BRIDGE_DB_PATH"] ?? dbPathFallback,
    port: Number(env["BRIDGE_PORT"] ?? "3101"),
    admin: {
      crewCliPath: env["CREW_CLI_PATH"] ?? "crew",
      relayAdminKeyPath: req("CREW_RELAY_ADMIN_KEY_PATH"),
    },
  };
}
