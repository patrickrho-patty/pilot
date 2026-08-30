import { SECRET_PROVIDERS, type SecretProvider } from "@pilotai/shared";

export function getConfiguredSecretProvider(): SecretProvider {
  const configuredProvider = process.env.PILOT_SECRETS_PROVIDER;
  return configuredProvider && SECRET_PROVIDERS.includes(configuredProvider as SecretProvider)
    ? configuredProvider as SecretProvider
    : "local_encrypted";
}
