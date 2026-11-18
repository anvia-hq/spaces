const INSTALL_SCRIPT = "https://raw.githubusercontent.com/anvia-hq/spaces/main/install.sh";

export function installCommand(origin: string, token: string): string {
  return `curl -fsSL ${INSTALL_SCRIPT} | bash -s -- --runtime --url ${origin} --token ${token}`;
}
