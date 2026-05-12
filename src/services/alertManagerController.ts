let openDialog: (() => void) | null = null;

export function registerAlertManagerOpener(opener: (() => void) | null): void {
  openDialog = opener;
}

export function openAlertManager(): void {
  openDialog?.();
}
