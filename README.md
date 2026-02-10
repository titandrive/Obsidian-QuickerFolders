# FolderIndex

FolderIndex is a simple Obsidian plugin that automatically opens a note when you click on a folder in the file explorer.

## How it works

When you click a folder name, FolderIndex opens a note from that folder. If there is a note titled `index` it will open that note. If an index note does not exist, you can also set it to open the topmost note or the most recently edited note. 

## Settings

- **Fallback behavior** — What to open when a folder has no `index.md`:
  - *Most recent* — The most recently edited note
  - *Topmost* — The first note alphabetically
  - *Nothing* — Do nothing
- **Strict Matching** - Whether it will open any not containing "index" in the title, or whether it has to be titled exactly `index.md`. Defaulted to off.
- **Allow folder toggle** — Whether clicking a folder name expands/collapses it. When disabled, only the arrow icon toggles folders.

## Installation
FolderIndex can be installed either via the BRAT Plugin (recommended) or via a custom install. 

### BRAT Installation
Using BRAT is the recommended, and easiest, way to install custom Obsidian plugins that are not available in the Obsidian Community Store.

1. Install BRAT via community plugins. 
2. Open BRAT and select "Add Beta Plugin"
3. Paste `https://github.com/titandrive/folderindex` into the text bar
4. Click "Add Plugin"

BRAT will now automatically keep track of updates for you

### Custom Installation
1. Browse to FolderIndex [Releases](https://github.com/titandrive/folderindex/releases)
2. Download the latest release
3. Extract the release and copy it to your obsidian vault: `.../MyVault/.obsidian/plugins/FolderIndex`
