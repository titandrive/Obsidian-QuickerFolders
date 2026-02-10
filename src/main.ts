import { Plugin, PluginSettingTab, Setting, TFile, TFolder, App } from "obsidian";

type Fallback = "recent" | "alphabetical" | "none";
type EmptyFolderBehavior = "recent_recursive" | "recent_index" | "none";

interface FolderIndexSettings {
	fallback: Fallback;
	emptyFolderBehavior: EmptyFolderBehavior;
	allowFolderToggle: boolean;
	strictMatching: boolean;
}

const DEFAULT_SETTINGS: FolderIndexSettings = {
	fallback: "recent",
	emptyFolderBehavior: "none",
	allowFolderToggle: true,
	strictMatching: false,
};

export default class FolderIndexPlugin extends Plugin {
	settings: FolderIndexSettings = DEFAULT_SETTINGS;
	private clickHandler: ((evt: MouseEvent) => void) | null = null;
	private preventToggleHandler: ((evt: Event) => void) | null = null;
	private blockToggle = false;
	private unpatchFn: (() => void) | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new FolderIndexSettingTab(this.app, this));
		this.registerFolderClickHandler();
		this.patchFileExplorer();
	}

	onunload() {
		this.removeFolderClickHandler();
		if (this.unpatchFn) {
			this.unpatchFn();
			this.unpatchFn = null;
		}
	}

	private patchFileExplorer() {
		const plugin = this;

		const doPatch = () => {
			const leaves = this.app.workspace.getLeavesOfType("file-explorer");
			if (leaves.length === 0) return;

			const view = leaves[0].view as any;
			if (!view?.fileItems) return;

			let folderProto: any = null;
			for (const path in view.fileItems) {
				const item = view.fileItems[path];
				if (item.file instanceof TFolder) {
					folderProto = Object.getPrototypeOf(item);
					break;
				}
			}

			if (!folderProto?.setCollapsed) return;

			const original = folderProto.setCollapsed;
			folderProto.setCollapsed = function (collapsed: boolean) {
				if (plugin.blockToggle) return;
				return original.call(this, collapsed);
			};

			plugin.unpatchFn = () => {
				folderProto.setCollapsed = original;
			};
		};

		this.app.workspace.onLayoutReady(doPatch);
	}

	private registerFolderClickHandler() {
		this.clickHandler = (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			const folderTitle = target.closest(".nav-folder-title");
			if (!folderTitle) return;

			const clickedArrow = target.closest(
				".nav-folder-collapse-indicator, .collapse-icon, .tree-item-icon"
			);

			const folderPath = folderTitle.getAttribute("data-path");
			if (!folderPath) return;

			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) return;

			if (!clickedArrow) {
				const note = this.resolveNote(folder);
				if (note) {
					this.app.workspace.openLinkText(note.path, "", false);
				}
			}

			if (!this.settings.allowFolderToggle && !clickedArrow) {
				evt.stopImmediatePropagation();
				evt.preventDefault();
				setTimeout(() => { this.blockToggle = false; }, 100);
			}
		};

		this.preventToggleHandler = (evt: Event) => {
			if (this.settings.allowFolderToggle) return;

			const target = evt.target as HTMLElement;
			const folderTitle = target.closest(".nav-folder-title");
			if (!folderTitle) return;

			const clickedArrow = target.closest(
				".nav-folder-collapse-indicator, .collapse-icon, .tree-item-icon"
			);
			if (clickedArrow) return;

			this.blockToggle = true;
			evt.stopImmediatePropagation();
			evt.preventDefault();
		};

		window.addEventListener("click", this.clickHandler, true);
		for (const evt of ["mousedown", "mouseup", "pointerdown", "pointerup"]) {
			window.addEventListener(evt, this.preventToggleHandler, true);
		}
	}

	private removeFolderClickHandler() {
		if (this.clickHandler) {
			window.removeEventListener("click", this.clickHandler, true);
			this.clickHandler = null;
		}
		if (this.preventToggleHandler) {
			for (const evt of ["mousedown", "mouseup", "pointerdown", "pointerup"]) {
				window.removeEventListener(evt, this.preventToggleHandler, true);
			}
			this.preventToggleHandler = null;
		}
	}

	private resolveNote(folder: TFolder): TFile | null {
		const index = this.getIndexNote(folder);
		if (index) return index;

		const directFiles = this.getMarkdownFiles(folder);
		if (directFiles.length === 0) {
			switch (this.settings.emptyFolderBehavior) {
				case "recent_recursive":
					return this.getMostRecentRecursive(folder);
				case "recent_index":
					return this.getMostRecentSubfolderIndex(folder);
				case "none":
					return null;
			}
		}

		switch (this.settings.fallback) {
			case "alphabetical":
				return this.getAlphabeticalFirst(folder);
			case "recent":
				return this.getMostRecent(folder);
			case "none":
				return null;
		}
	}

	private getMarkdownFiles(folder: TFolder): TFile[] {
		return folder.children.filter(
			(f): f is TFile => f instanceof TFile && f.extension === "md"
		);
	}

	private getIndexNote(folder: TFolder): TFile | null {
		if (this.settings.strictMatching) {
			const path = `${folder.path}/index.md`;
			const file = this.app.vault.getAbstractFileByPath(path);
			return file instanceof TFile ? file : null;
		}

		const files = this.getMarkdownFiles(folder);
		const exact = files.find((f) => f.basename.toLowerCase() === "index");
		if (exact) return exact;
		const partial = files.find((f) =>
			f.basename.toLowerCase().includes("index")
		);
		return partial ?? null;
	}

	private getAlphabeticalFirst(folder: TFolder): TFile | null {
		const files = this.getMarkdownFiles(folder);
		if (files.length === 0) return null;
		files.sort((a, b) => a.name.localeCompare(b.name));
		return files[0];
	}

	private getMostRecent(folder: TFolder): TFile | null {
		const files = this.getMarkdownFiles(folder);
		if (files.length === 0) return null;
		files.sort((a, b) => b.stat.mtime - a.stat.mtime);
		return files[0];
	}

	private getMarkdownFilesRecursive(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.getMarkdownFilesRecursive(child));
			}
		}
		return files;
	}

	private getMostRecentRecursive(folder: TFolder): TFile | null {
		const files = this.getMarkdownFilesRecursive(folder);
		if (files.length === 0) return null;
		files.sort((a, b) => b.stat.mtime - a.stat.mtime);
		return files[0];
	}

	private getMostRecentSubfolderIndex(folder: TFolder): TFile | null {
		const indices: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				const index = this.getIndexNote(child);
				if (index) indices.push(index);
			}
		}
		if (indices.length === 0) return null;
		indices.sort((a, b) => b.stat.mtime - a.stat.mtime);
		return indices[0];
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class FolderIndexSettingTab extends PluginSettingTab {
	plugin: FolderIndexPlugin;

	constructor(app: App, plugin: FolderIndexPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		const descEl = containerEl.createEl("p", {
			text: "Opens a note when you click on a folder. If a folder contains an index.md, it will always be opened first.",
		});
		descEl.style.paddingLeft = "var(--size-4-2)";

		containerEl.createEl("h4", { text: "Settings" });

		new Setting(containerEl)
			.setName("Fallback behavior")
			.setDesc("Which note to open when a folder has no index.md")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("recent", "Recently edited")
					.addOption("alphabetical", "Topmost")
					.addOption("none", "Nothing")
					.setValue(this.plugin.settings.fallback)
					.onChange(async (value) => {
						this.plugin.settings.fallback = value as Fallback;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Nested folder behavior")
			.setDesc("What to open when a folder contains only subfolders (no direct notes)")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("recent_index", "Recently edited index")
					.addOption("recent_recursive", "Recently edited note")
					.addOption("none", "Nothing")
					.setValue(this.plugin.settings.emptyFolderBehavior)
					.onChange(async (value) => {
						this.plugin.settings.emptyFolderBehavior = value as EmptyFolderBehavior;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Strict matching")
			.setDesc("Only match notes titled exactly \"index\". When off, any note containing \"index\" in the title will be used.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.strictMatching)
					.onChange(async (value) => {
						this.plugin.settings.strictMatching = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Allow folder toggle")
			.setDesc("Expand/collapse folders when clicking on the name. Clicking on arrow will always toggle folders.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.allowFolderToggle)
					.onChange(async (value) => {
						this.plugin.settings.allowFolderToggle = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h4", { text: "About" });

		new Setting(containerEl)
			.setName("GitHub")
			.setDesc("View source code, report issues, or contribute")
			.addButton((button) =>
				button.setButtonText("GitHub").onClick(() => {
					window.open("https://github.com/titandrive/FolderIndex");
				})
			);

		containerEl.createEl("h4", { text: "Support" });

		new Setting(containerEl)
			.setName("Buy me a coffee")
			.setDesc("If you find this plugin useful, consider supporting its development!")
			.addButton((button) =>
				button.setButtonText("Ko-fi").onClick(() => {
					window.open("https://ko-fi.com/titandrive");
				})
			);
	}
}
