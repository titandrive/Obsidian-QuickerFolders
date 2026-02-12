import { Plugin, PluginSettingTab, Setting, TFile, TFolder, App, Notice, Menu, TAbstractFile } from "obsidian";

type Fallback = "recent" | "alphabetical" | "none";
type EmptyFolderBehavior = "recent_recursive" | "recent_index" | "none";

interface QuickerFoldersSettings {
	fallback: Fallback;
	emptyFolderBehavior: EmptyFolderBehavior;
	allowFolderToggle: boolean;
	strictMatching: boolean;
	keyword: string;
}

const DEFAULT_SETTINGS: QuickerFoldersSettings = {
	fallback: "recent",
	emptyFolderBehavior: "recent_index",
	allowFolderToggle: true,
	strictMatching: false,
	keyword: "index",
};

export default class QuickerFoldersPlugin extends Plugin {
	settings: QuickerFoldersSettings = DEFAULT_SETTINGS;
	private clickHandler: ((evt: MouseEvent) => void) | null = null;
	private preventToggleHandler: ((evt: Event) => void) | null = null;
	private blockToggle = false;
	private unpatchFn: (() => void) | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new QuickerFoldersSettingTab(this.app, this));
		this.registerFolderClickHandler();
		this.patchFileExplorer();

		this.addCommand({
			id: "set-as-index",
			name: "Set current note as index",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				this.app.fileManager.processFrontMatter(file, (fm) => {
					fm.index_note = true;
				});
				new Notice(`Set "${file.basename}" as folder index`);
				return true;
			},
		});

		this.addCommand({
			id: "remove-as-index",
			name: "Remove current note as index",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const cache = this.app.metadataCache.getFileCache(file);
				if (!cache?.frontmatter?.index_note) return false;
				if (checking) return true;
				this.app.fileManager.processFrontMatter(file, (fm) => {
					delete fm.index_note;
				});
				new Notice(`Removed "${file.basename}" as folder index`);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;

				const cache = this.app.metadataCache.getFileCache(file);
				const isIndex = cache?.frontmatter?.index_note === true;

				if (isIndex) {
					menu.addItem((item) => {
						item.setTitle("Remove index note")
							.setIcon("x-circle")
							.onClick(() => {
								this.app.fileManager.processFrontMatter(file, (fm) => {
									delete fm.index_note;
								});
								new Notice(`Removed "${file.basename}" as folder index`);
							});
					});
				} else {
					menu.addItem((item) => {
						item.setTitle("Set index note")
							.setIcon("pin")
							.onClick(() => {
								this.app.fileManager.processFrontMatter(file, (fm) => {
									fm.index_note = true;
								});
								new Notice(`Set "${file.basename}" as folder index`);
							});
					});
				}
			})
		);
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
			let result: TFile | null = null;
			switch (this.settings.emptyFolderBehavior) {
				case "recent_recursive":
					result = this.getMostRecentRecursive(folder);
					break;
				case "recent_index":
					result = this.getMostRecentSubfolderIndex(folder);
					break;
				case "none":
					return null;
			}
			if (result) return result;

			// Fallback uses recursive search since folder has no direct notes
			const recursiveFiles = this.getMarkdownFilesRecursive(folder);
			if (recursiveFiles.length === 0) return null;
			switch (this.settings.fallback) {
				case "alphabetical":
					recursiveFiles.sort((a, b) => a.name.localeCompare(b.name));
					return recursiveFiles[0];
				case "recent":
					recursiveFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
					return recursiveFiles[0];
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
		// Frontmatter index: true takes priority over everything
		const files = this.getMarkdownFiles(folder);
		const frontmatterIndex = files.find((f) => {
			const cache = this.app.metadataCache.getFileCache(f);
			return cache?.frontmatter?.index_note === true;
		});
		if (frontmatterIndex) return frontmatterIndex;

		const keyword = this.settings.keyword.toLowerCase();

		if (this.settings.strictMatching) {
			const path = `${folder.path}/${keyword}.md`;
			const file = this.app.vault.getAbstractFileByPath(path);
			return file instanceof TFile ? file : null;
		}

		const exact = files.find((f) => f.basename.toLowerCase() === keyword);
		if (exact) return exact;
		const partial = files.find((f) =>
			f.basename.toLowerCase().includes(keyword)
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

class QuickerFoldersSettingTab extends PluginSettingTab {
	plugin: QuickerFoldersPlugin;

	constructor(app: App, plugin: QuickerFoldersPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		const descEl = containerEl.createEl("p", {
			text: "Quicker Folders is a simple Obsidian plugin that automatically opens a selected note when you click on a folder in the filetree.",
		});
		descEl.style.paddingLeft = "var(--size-4-2)";

		containerEl.createEl("h4", { text: "Settings" });

		new Setting(containerEl)
			.setName("Fallback behavior")
			.setDesc("Which note to open when a folder has no index.md")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("recent", "Recently edited")
					.addOption("alphabetical", "Alphabetical")
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

		let pendingKeyword = this.plugin.settings.keyword;
		new Setting(containerEl)
			.setName("Keyword")
			.setDesc("The keyword to match when looking for index notes (minimum 3 characters)")
			.addText((text) =>
				text
					.setPlaceholder("index")
					.setValue(this.plugin.settings.keyword)
					.onChange((value) => {
						pendingKeyword = value.trim().toLowerCase();
					})
			)
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						if (pendingKeyword.length < 3) {
							new Notice("Keyword must be at least 3 characters");
							return;
						}
						this.plugin.settings.keyword = pendingKeyword;
						await this.plugin.saveSettings();
						button.setButtonText("Saved!");
						button.removeCta();
						new Notice(`Keyword set to "${pendingKeyword}"`);
						setTimeout(() => {
							button.setButtonText("Save");
							button.setCta();
						}, 1500);
					})
			);

		new Setting(containerEl)
			.setName("Strict matching")
			.setDesc(`Only match notes titled exactly "${this.plugin.settings.keyword}". When off, any note containing "${this.plugin.settings.keyword}" in the title will be used.`)
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
					window.open("https://github.com/titandrive/Obsidian-QuickerFolders");
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
