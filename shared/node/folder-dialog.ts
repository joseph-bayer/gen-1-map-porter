// The system's folder picker, opened from the server, since a browser page can't hand over a real
// path. One implementation per platform; only Windows has one so far.

import { windowsFolderDialog } from "./folder-dialog-windows.js";

export interface FolderDialog {
	/** Open the dialog, starting in `initial` if given; resolves to the chosen path, or null if cancelled. */
	pick(title: string, initial?: string): Promise<string | null>;
}

const DIALOGS: Partial<Record<NodeJS.Platform, FolderDialog>> = {
	win32: windowsFolderDialog,
};

/** Open this platform's folder dialog. */
export function pickFolder(title: string, initial?: string): Promise<string | null> {
	const dialog = DIALOGS[process.platform];
	if (!dialog) return Promise.reject(new Error(`no folder dialog on ${process.platform} yet`));
	return dialog.pick(title, initial);
}
