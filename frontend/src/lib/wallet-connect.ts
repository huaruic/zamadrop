const METAMASK_INSTALL_URL = "https://metamask.io/download/";

export async function hasWalletProvider(
  connector?: { getProvider?: () => Promise<unknown> },
): Promise<boolean> {
  if (!connector?.getProvider) return false;
  try {
    return !!(await connector.getProvider());
  } catch {
    return false;
  }
}

export function openMetaMaskInstall() {
  window.open(METAMASK_INSTALL_URL, "_blank", "noopener,noreferrer");
}
