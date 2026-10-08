//! Sidebar folders: named, collapsible holders of bot and group rows.
//!
//! Purely visual. A folder belongs to one project and lists the rows it holds
//! as `bot:<id>` / `group:<id>`; nothing changes for the bots or the chats.
//! Kept in one JSON file in the Gravity home so every device sees the same
//! folders. Every reply is the whole list, so clients just replace theirs.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::Conn;

const FOLDERS_FILE: &str = "sidebar.json";
const MAX_NAME_CHARS: usize = 40;
const MAX_ITEMS: usize = 64;

/// Serialises read-modify-write cycles on the file.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub project_id: String,
    /// `bot:<id>` or `group:<id>`, in no particular order.
    pub items: Vec<String>,
}

fn folders_path(home: &Path) -> PathBuf {
    home.join(FOLDERS_FILE)
}

fn load(home: &Path) -> Vec<Folder> {
    std::fs::read_to_string(folders_path(home))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| serde_json::from_value(value["folders"].clone()).ok())
        .unwrap_or_default()
}

fn store(home: &Path, folders: &[Folder]) -> anyhow::Result<()> {
    crate::paths::atomic_write_json(&folders_path(home), &json!({ "folders": folders }))
}

fn valid_item(item: &str) -> bool {
    item.split_once(':').is_some_and(|(kind, id)| {
        matches!(kind, "bot" | "group") && !id.is_empty() && id.chars().count() <= 64
    })
}

/// Moves `item` into folder `target` (`None` takes it out of every folder).
fn place(folders: &mut [Folder], item: &str, target: Option<&str>) -> anyhow::Result<()> {
    if let Some(id) = target {
        let folder = folders
            .iter()
            .find(|folder| folder.id == id)
            .ok_or_else(|| anyhow::anyhow!("folder not found"))?;
        anyhow::ensure!(
            folder.items.iter().any(|other| other == item) || folder.items.len() < MAX_ITEMS,
            "a folder holds up to {MAX_ITEMS} rows"
        );
    }
    for folder in folders.iter_mut() {
        folder.items.retain(|other| other != item);
        if target == Some(folder.id.as_str()) {
            folder.items.push(item.to_string());
        }
    }
    Ok(())
}

impl Conn {
    fn send_folders(&self, req_id: &Value, folders: &[Folder]) {
        self.send(json!({ "type": "folders", "req_id": req_id, "folders": folders }));
    }

    /// `list_folders` → `{folders}`.
    pub(super) fn list_folders(&self, req_id: &Value, _req: &Value) -> anyhow::Result<()> {
        self.send_folders(req_id, &load(&self.app.cfg.home));
        Ok(())
    }

    /// `save_folder {folder_id?, name, project_id}` → `{folders}`; no id creates one.
    /// Renaming keeps the rows the folder holds.
    pub(super) fn save_folder(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let name = Self::str_field(req, "name")?.trim();
        anyhow::ensure!(
            !name.is_empty() && name.chars().count() <= MAX_NAME_CHARS,
            "a folder name is 1 to {MAX_NAME_CHARS} characters"
        );
        let project_id = Self::str_field(req, "project_id")?;
        anyhow::ensure!(
            self.app.db.get_project(project_id)?.is_some(),
            "project not found"
        );
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut folders = load(&self.app.cfg.home);
        match req.get("folder_id").and_then(Value::as_str) {
            Some(id) => {
                let folder = folders
                    .iter_mut()
                    .find(|folder| folder.id == id)
                    .ok_or_else(|| anyhow::anyhow!("folder not found"))?;
                folder.name = name.to_string();
            }
            None => folders.push(Folder {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.to_string(),
                project_id: project_id.to_string(),
                items: Vec::new(),
            }),
        }
        store(&self.app.cfg.home, &folders)?;
        self.send_folders(req_id, &folders);
        Ok(())
    }

    /// `delete_folder {folder_id}` → `{folders}`. Its rows go back to the project.
    pub(super) fn delete_folder(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let folder_id = Self::str_field(req, "folder_id")?;
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut folders = load(&self.app.cfg.home);
        folders.retain(|folder| folder.id != folder_id);
        store(&self.app.cfg.home, &folders)?;
        self.send_folders(req_id, &folders);
        Ok(())
    }

    /// `place_in_folder {item, folder_id?}` → `{folders}`; no folder takes the row out.
    pub(super) fn place_in_folder(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let item = Self::str_field(req, "item")?;
        anyhow::ensure!(valid_item(item), "invalid row");
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut folders = load(&self.app.cfg.home);
        place(
            &mut folders,
            item,
            req.get("folder_id").and_then(Value::as_str),
        )?;
        store(&self.app.cfg.home, &folders)?;
        self.send_folders(req_id, &folders);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, items: &[&str]) -> Folder {
        Folder {
            id: id.to_string(),
            name: id.to_string(),
            project_id: "p".to_string(),
            items: items.iter().map(ToString::to_string).collect(),
        }
    }

    #[test]
    fn a_row_lives_in_one_folder_at_a_time() {
        let mut folders = vec![folder("a", &["bot:1"]), folder("b", &[])];
        place(&mut folders, "bot:1", Some("b")).unwrap();
        assert!(folders[0].items.is_empty());
        assert_eq!(folders[1].items, ["bot:1"]);
        place(&mut folders, "bot:1", None).unwrap();
        assert!(folders.iter().all(|f| f.items.is_empty()));
        assert!(place(&mut folders, "bot:1", Some("missing")).is_err());
    }

    #[test]
    fn rows_are_bot_or_group_ids() {
        assert!(valid_item("bot:abc"));
        assert!(valid_item("group:abc"));
        assert!(!valid_item("abc"));
        assert!(!valid_item("bot:"));
        assert!(!valid_item("folder:x"));
    }

    #[test]
    fn folders_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load(tmp.path()).is_empty());
        store(tmp.path(), &[folder("a", &["group:1"])]).unwrap();
        assert_eq!(load(tmp.path()), [folder("a", &["group:1"])]);
    }
}
