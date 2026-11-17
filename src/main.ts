import { Plugin, PluginSettingTab, Setting, TFile, TFolder, App, Notice, Menu, TAbstractFile, setIcon, getIconIds, debounce, FuzzySuggestModal, FuzzyMatch, Platform } from "obsidian";

type Fallback = "recent" | "alphabetical" | "none";
type EmptyFolderBehavior = "recent_recursive" | "recent_index" | "none";

interface QuickerFoldersSettings {
	fallback: Fallback;
	emptyFolderBehavior: EmptyFolderBehavior;
	allowFolderToggle: boolean;
	strictMatching: boolean;
	keyword: string;
	showRibbonButton: boolean;
	/** On mobile, a light haptic tap when a folder is tapped or expanded/collapsed. */
	haptics: boolean;
	/** Index files that can't hold an index_note property (bases), by path. */
	indexFiles: string[];
	/** Show an icon beside each folder's index note in the file explorer. */
	showIndexIcon: boolean;
	indexIcon: string;
}

const DEFAULT_SETTINGS: QuickerFoldersSettings = {
	fallback: "recent",
	emptyFolderBehavior: "recent_index",
	allowFolderToggle: true,
	strictMatching: false,
	keyword: "index",
	showRibbonButton: true,
	haptics: true,
	indexFiles: [],
	showIndexIcon: true,
	indexIcon: "pin",
};

const INDEX_ICON_CLASS = "qf-index-icon";

/** File types that can be an index: notes (flagged in frontmatter) and bases (flagged in settings). */
const INDEX_EXTENSIONS = ["md", "base"];

export default class QuickerFoldersPlugin extends Plugin {
	settings: QuickerFoldersSettings = DEFAULT_SETTINGS;
	private clickHandler: ((evt: MouseEvent) => void) | null = null;
	private preventToggleHandler: ((evt: Event) => void) | null = null;
	private blockToggle = false;
	private unblockTimer = 0;
	private unpatchFn: (() => void) | null = null;
	private ribbonEl: HTMLElement | null = null;
	private currentIconName: string = "";
	/** Redraw the index icons in the file explorer, at most every 150 ms. */
	refreshIndexIcons = debounce(() => this.drawIndexIcons(), 150, true);

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
				if (!file || !this.canBeIndex(file)) return false;
				if (checking) return true;
				void this.setIndex(file, true);
				return true;
			},
		});

		this.addCommand({
			id: "remove-as-index",
			name: "Remove current note as index",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.isIndex(file)) return false;
				if (checking) return true;
				void this.setIndex(file, false);
				return true;
			},
		});

		this.updateRibbonButton();

		// Index icons in the file explorer follow anything that can change which file is a folder's index.
		this.app.workspace.onLayoutReady(() => this.refreshIndexIcons());
		this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshIndexIcons()));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshIndexIcons()));
		this.registerEvent(this.app.vault.on("create", () => this.refreshIndexIcons()));
		this.registerEvent(this.app.vault.on("rename", () => this.refreshIndexIcons()));
		this.registerEvent(this.app.vault.on("delete", () => this.refreshIndexIcons()));

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFile) || !this.canBeIndex(file)) return;

				if (this.isIndex(file)) {
					menu.addItem((item) => {
						item.setTitle("Remove index note")
							.setIcon("x-circle")
							.onClick(() => void this.setIndex(file, false));
					});
				} else {
					menu.addItem((item) => {
						item.setTitle("Set index note")
							.setIcon("pin")
							.onClick(() => void this.setIndex(file, true));
					});
				}
			})
		);

		// Keep bases flagged as index files when they're renamed or moved, and forget deleted ones.
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			const i = this.settings.indexFiles.indexOf(oldPath);
			if (i === -1) return;
			this.settings.indexFiles[i] = file.path;
			void this.saveSettings();
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			if (!this.settings.indexFiles.includes(file.path)) return;
			this.settings.indexFiles = this.settings.indexFiles.filter((p) => p !== file.path);
			void this.saveSettings();
		}));
	}

	onunload() {
		this.removeFolderClickHandler();
		document.querySelectorAll("." + INDEX_ICON_CLASS).forEach((el) => el.remove());
		if (this.unpatchFn) {
			this.unpatchFn();
			this.unpatchFn = null;
		}
	}

	updateRibbonButton() {
		if (this.ribbonEl) {
			this.ribbonEl.remove();
			this.ribbonEl = null;
		}
		if (!this.settings.showRibbonButton) return;

		this.ribbonEl = this.addRibbonIcon("pin", "Set index note", () => {
			const file = this.app.workspace.getActiveFile();
			if (!file || !this.canBeIndex(file)) {
				new Notice("No active note");
				return;
			}
			void this.setIndex(file, !this.isIndex(file));
		});

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateRibbonIcon()));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.updateRibbonIcon()));
		this.updateRibbonIcon();
	}

	private updateRibbonIcon() {
		if (!this.ribbonEl) return;
		const file = this.app.workspace.getActiveFile();
		const isIndex = file ? this.isIndex(file) : false;
		const iconName = isIndex ? "pin-off" : "pin";
		if (iconName !== this.currentIconName) {
			setIcon(this.ribbonEl, iconName);
			this.currentIconName = iconName;
		}
		this.ribbonEl.setAttribute("aria-label", isIndex ? "Remove index note" : "Set index note");
	}

	canBeIndex(file: TFile): boolean {
		return INDEX_EXTENSIONS.includes(file.extension);
	}

	/** Notes are flagged with index_note in their frontmatter; bases have none, so they're listed in settings. */
	isIndex(file: TFile): boolean {
		if (file.extension === "md") return this.app.metadataCache.getFileCache(file)?.frontmatter?.index_note === true;
		return this.settings.indexFiles.includes(file.path);
	}

	async setIndex(file: TFile, on: boolean): Promise<void> {
		if (file.extension === "md") {
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				if (on) fm.index_note = true;
				else delete fm.index_note;
			});
		} else {
			const others = this.settings.indexFiles.filter((p) => p !== file.path);
			this.settings.indexFiles = on ? [...others, file.path] : others;
			await this.saveSettings();
		}
		new Notice(on ? `Set "${file.basename}" as index note` : `Removed "${file.basename}" as index note`);
		this.updateRibbonIcon();
		this.refreshIndexIcons();
	}

	/** Every folder's index note (set as index, or matching the keyword), by path. */
	private indexPaths(): Set<string> {
		const paths = new Set<string>();
		const walk = (folder: TFolder) => {
			const index = this.getIndexNote(folder);
			if (index) paths.add(index.path);
			for (const child of folder.children) if (child instanceof TFolder) walk(child);
		};
		walk(this.app.vault.getRoot());
		return paths;
	}

	/** Put the index icon before the name of each index note in the file explorer, and nowhere else. */
	private drawIndexIcons() {
		const paths = this.settings.showIndexIcon ? this.indexPaths() : new Set<string>();
		for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
			const items = (leaf.view as any)?.fileItems as Record<string, { selfEl?: HTMLElement; innerEl?: HTMLElement }> | undefined;
			if (!items) continue;
			for (const [path, item] of Object.entries(items)) {
				const self = item.selfEl;
				if (!self) continue;
				const existing = self.querySelector(":scope > ." + INDEX_ICON_CLASS) as HTMLElement | null;
				if (!paths.has(path)) { existing?.remove(); continue; }
				if (existing?.dataset.icon === this.settings.indexIcon) continue;
				existing?.remove();
				const icon = createSpan({ cls: INDEX_ICON_CLASS, attr: { "aria-label": "Index note", "data-icon": this.settings.indexIcon } });
				setIcon(icon, this.settings.indexIcon);
				self.insertBefore(icon, item.innerEl ?? self.firstChild);
			}
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

	/**
	 * Whether a click on a folder row is meant for the expand/collapse arrow. The arrow icon itself is
	 * small, so anything from the row's left edge to just past the arrow counts as the arrow too;
	 * otherwise a slightly-off click opens the index note instead of toggling.
	 */
	private isArrowClick(evt: MouseEvent | PointerEvent, folderTitle: Element): boolean {
		const target = evt.target as HTMLElement;
		if (target.closest(".nav-folder-collapse-indicator, .collapse-icon, .tree-item-icon")) return true;
		const arrow = folderTitle.querySelector(".nav-folder-collapse-indicator, .collapse-icon, .tree-item-icon");
		if (!arrow || typeof evt.clientX !== "number") return false;
		const box = arrow.getBoundingClientRect();
		return box.width > 0 && evt.clientX <= box.right + 6;
	}

	private registerFolderClickHandler() {
		this.clickHandler = (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			const folderTitle = target.closest(".nav-folder-title");
			if (!folderTitle) return;

			const clickedArrow = this.isArrowClick(evt, folderTitle);

			const folderPath = folderTitle.getAttribute("data-path");
			if (!folderPath) return;

			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) return;

			// The same light tap Obsidian gives its own toggles (it routes this to the phone's haptics).
			if (this.settings.haptics && Platform.isMobile) navigator.vibrate?.(100);

			if (!clickedArrow) {
				const note = this.resolveNote(folder);
				if (note) {
					void this.app.workspace.getLeaf(false).openFile(note);
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

			// The arrow always toggles, and pressing it clears any leftover block.
			if (this.isArrowClick(evt as MouseEvent, folderTitle)) { this.blockToggle = false; return; }

			this.blockToggle = true;
			// Clear the block on our own too: if the press doesn't end in a click on the name (released
			// elsewhere, dragged), the click handler never runs, and the block would stay on, making
			// every later expand/collapse, arrow included, silently do nothing.
			window.clearTimeout(this.unblockTimer);
			this.unblockTimer = window.setTimeout(() => { this.blockToggle = false; }, 400);
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
		// A note or base set as index takes priority over everything
		const flagged = folder.children.find((f): f is TFile => f instanceof TFile && this.canBeIndex(f) && this.isIndex(f));
		if (flagged) return flagged;
		const files = this.getMarkdownFiles(folder);

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
		this.settings.indexFiles = [...(this.settings.indexFiles ?? [])];
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

		new Setting(containerEl)
			.setName("Show index icon")
			.setDesc("Show an icon beside each folder's index note (or base) in the file explorer.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showIndexIcon)
					.onChange(async (value) => {
						this.plugin.settings.showIndexIcon = value;
						await this.plugin.saveSettings();
						this.plugin.refreshIndexIcons();
						this.display();
					})
			);

		if (this.plugin.settings.showIndexIcon) {
			const iconSetting = new Setting(containerEl)
				.setName("Index icon")
				.setDesc("The icon shown beside index notes.");
			iconSetting.addButton((button) => {
				const draw = () => {
					button.buttonEl.empty();
					const icon = button.buttonEl.createSpan({ cls: "qf-icon-preview" });
					setIcon(icon, this.plugin.settings.indexIcon);
					button.buttonEl.createSpan({ text: this.plugin.settings.indexIcon });
				};
				draw();
				button.buttonEl.addClass("qf-icon-button");
				button.onClick(() => {
					new IconPickerModal(this.app, async (name) => {
						this.plugin.settings.indexIcon = name;
						await this.plugin.saveSettings();
						this.plugin.refreshIndexIcons();
						draw();
					}).open();
				});
			});
		}

		if (Platform.isMobile) {
			new Setting(containerEl)
				.setName("Haptic feedback")
				.setDesc("A light tap when you tap a folder or expand/collapse it.")
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.haptics)
						.onChange(async (value) => {
							this.plugin.settings.haptics = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Show ribbon button")
			.setDesc("Show a button in the ribbon to toggle index note on the active file")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showRibbonButton)
					.onChange(async (value) => {
						this.plugin.settings.showRibbonButton = value;
						await this.plugin.saveSettings();
						this.plugin.updateRibbonButton();
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

/** Search every icon Obsidian has by name, showing each one beside its name. */
class IconPickerModal extends FuzzySuggestModal<string> {
	constructor(app: App, private onPick: (name: string) => void) {
		super(app);
		this.setPlaceholder("Search icons…");
		this.modalEl.addClass("qf-icon-picker");
	}

	getItems(): string[] {
		return getIconIds().map((id) => id.replace(/^lucide-/, "")).sort();
	}

	getItemText(name: string): string {
		return name.replace(/-/g, " ");
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass("qf-icon-suggestion");
		setIcon(el.createSpan({ cls: "qf-icon-preview" }), match.item);
		super.renderSuggestion(match, el.createSpan());
	}

	onChooseItem(name: string): void {
		this.onPick(name);
	}
}
