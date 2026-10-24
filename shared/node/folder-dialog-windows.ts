// Windows' own folder picker (the IFileOpenDialog "Select Folder" dialog), opened from the server
// through PowerShell, since a browser page can't hand over a real path. The dialog is owned by a
// topmost invisible window so it opens in front of the browser.

import { spawn } from "node:child_process";

import type { FolderDialog } from "./folder-dialog.js";

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Gen1PorterFolderPicker {
	[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW {}
	[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IFileDialog {
		[PreserveSig] int Show(IntPtr parent);
		void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
		void SetFileTypeIndex(uint iFileType);
		void GetFileTypeIndex(out uint piFileType);
		void Advise(IntPtr pfde, out uint pdwCookie);
		void Unadvise(uint dwCookie);
		void SetOptions(uint fos);
		void GetOptions(out uint pfos);
		void SetDefaultFolder(IShellItem psi);
		void SetFolder(IShellItem psi);
		void GetFolder(out IShellItem ppsi);
		void GetCurrentSelection(out IShellItem ppsi);
		void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
		void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
		void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
		void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
		void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
		void GetResult(out IShellItem ppsi);
		void AddPlace(IShellItem psi, int fdap);
		void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
		void Close(int hr);
		void SetClientGuid(ref Guid guid);
		void ClearClientData();
		void SetFilter(IntPtr pFilter);
	}
	[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IShellItem {
		void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
		void GetParent(out IShellItem ppsi);
		void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
		void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
		void Compare(IShellItem psi, uint hint, out int piOrder);
	}
	[DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
	static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem ppv);

	public static string Pick(string title, string initial, IntPtr owner) {
		IFileDialog dialog = (IFileDialog)new FileOpenDialogRCW();
		dialog.SetOptions(0x20 | 0x40 | 0x800); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
		dialog.SetTitle(title);
		if (!string.IsNullOrEmpty(initial) && System.IO.Directory.Exists(initial)) {
			IShellItem folder;
			SHCreateItemFromParsingName(initial, IntPtr.Zero, typeof(IShellItem).GUID, out folder);
			dialog.SetFolder(folder);
		}
		if (dialog.Show(owner) != 0) return null; // cancelled
		IShellItem result;
		dialog.GetResult(out result);
		string path;
		result.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
		return path;
	}
}
'@
if ($env:GEN1_PICK_COMPILE_ONLY) { [Console]::Out.Write('compiled'); exit 0 }
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$owner.Show()
$owner.Activate()
try {
	$path = [Gen1PorterFolderPicker]::Pick($env:GEN1_PICK_TITLE, $env:GEN1_PICK_INITIAL, $owner.Handle)
	if ($path) { [Console]::Out.Write($path) }
} finally {
	$owner.Close()
}
`;

export const windowsFolderDialog: FolderDialog = { pick: (title, initial) => pickFolder(title, initial) };

/** Open the folder dialog; resolves to the chosen path, or null if cancelled. */
export function pickFolder(title: string, initial?: string, compileOnly = false): Promise<string | null> {
	return new Promise((resolvePick, reject) => {
		const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
		const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
			env: {
				...process.env,
				GEN1_PICK_TITLE: title,
				GEN1_PICK_INITIAL: initial ?? "",
				...(compileOnly ? { GEN1_PICK_COMPILE_ONLY: "1" } : {}),
			},
			windowsHide: true,
		});
		let out = "", err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (err += d));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) return reject(new Error(`folder dialog failed: ${err.trim() || `exit ${code}`}`));
			const path = out.trim();
			resolvePick(path || null);
		});
	});
}
