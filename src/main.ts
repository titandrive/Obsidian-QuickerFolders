import { Plugin, PluginSettingTab, Setting, TFile, TFolder, App } from "obsidian";

type Fallback = "recent" | "alphabetical" | "none";

interface FolderIndexSettings {
	fallback: Fallback;
	allowFolderToggle: boolean;
}

const DEFAULT_SETTINGS: FolderIndexSettings = {
	fallback: "alphabetical",
	allowFolderToggle: true,
};

export default class FolderIndexPlugin extends Plugin {
	settings: FolderIndexSettings = DEFAULT_SETTINGS;
	private clickHandler: ((evt: MouseEvent) => void) | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new FolderIndexSettingTab(this.app, this));
		this.registerFolderClickHandler();
	}

	onunload() {
		this.removeFolderClickHandler();
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
			}
		};

		// Use capture phase so we fire alongside the native expand, not instead of it
		document.addEventListener("click", this.clickHandler, true);
	}

	private removeFolderClickHandler() {
		if (this.clickHandler) {
			document.removeEventListener("click", this.clickHandler, true);
			this.clickHandler = null;
		}
	}

	private resolveNote(folder: TFolder): TFile | null {
		const index = this.getIndexNote(folder);
		if (index) return index;

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
		const path = `${folder.path}/index.md`;
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
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

		new Setting(containerEl)
			.setName("Fallback behavior")
			.setDesc("Which note to open when a folder has no index.md")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("recent", "Most recent")
					.addOption("alphabetical", "Topmost")
					.addOption("none", "Nothing")
					.setValue(this.plugin.settings.fallback)
					.onChange(async (value) => {
						this.plugin.settings.fallback = value as Fallback;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Allow folder toggle")
			.setDesc("Allow folders to expand/collapse when clicked")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.allowFolderToggle)
					.onChange(async (value) => {
						this.plugin.settings.allowFolderToggle = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
