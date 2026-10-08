//! Group chats: a named set of bots in one project that the owner talks to in
//! a single thread.
//!
//! The daemon only keeps the membership; the conversation itself is each
//! member's own transcript, merged by the client. A prompt sent to a group
//! goes to every member it addresses, so nothing new reaches the runtimes.
//! Groups live in one JSON file in the Gravity home, rewritten atomically.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::Conn;

const GROUPS_FILE: &str = "groups.json";
const MAX_NAME_CHARS: usize = 60;
const MAX_MEMBERS: usize = 12;

/// Serialises read-modify-write cycles on the file.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub bot_ids: Vec<String>,
    pub created_at: String,
}

fn groups_path(home: &Path) -> PathBuf {
    home.join(GROUPS_FILE)
}

fn load(home: &Path) -> Vec<Group> {
    std::fs::read_to_string(groups_path(home))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| serde_json::from_value(value["groups"].clone()).ok())
        .unwrap_or_default()
}

fn store(home: &Path, groups: &[Group]) -> anyhow::Result<()> {
    crate::paths::atomic_write_json(&groups_path(home), &json!({ "groups": groups }))
}

/// Inserts or replaces `group` by id.
fn upsert(groups: &mut Vec<Group>, group: Group) {
    match groups.iter_mut().find(|other| other.id == group.id) {
        Some(slot) => *slot = group,
        None => groups.push(group),
    }
}

impl Conn {
    /// `list_groups {project_id?}` → `{groups}`.
    pub(super) fn list_groups(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let project_id = req.get("project_id").and_then(Value::as_str);
        let groups: Vec<Group> = load(&self.app.cfg.home)
            .into_iter()
            .filter(|group| project_id.is_none_or(|id| group.project_id == id))
            .collect();
        self.send(json!({ "type": "groups", "req_id": req_id, "groups": groups }));
        Ok(())
    }

    /// `save_group {group_id?, name, project_id, bot_ids}` → `{group}`; no id creates one.
    pub(super) fn save_group(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let name = Self::str_field(req, "name")?.trim();
        anyhow::ensure!(
            !name.is_empty() && name.chars().count() <= MAX_NAME_CHARS,
            "a group name is 1 to {MAX_NAME_CHARS} characters"
        );
        let project_id = Self::str_field(req, "project_id")?;
        anyhow::ensure!(
            self.app.db.get_project(project_id)?.is_some(),
            "project not found"
        );
        let mut bot_ids: Vec<String> = req
            .get("bot_ids")
            .and_then(Value::as_array)
            .map(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        bot_ids.sort();
        bot_ids.dedup();
        anyhow::ensure!(
            (2..=MAX_MEMBERS).contains(&bot_ids.len()),
            "a group has 2 to {MAX_MEMBERS} bots"
        );
        for id in &bot_ids {
            let bot = self
                .app
                .db
                .get_bot(id)?
                .ok_or_else(|| anyhow::anyhow!("bot not found"))?;
            anyhow::ensure!(
                bot.project_id == project_id,
                "every member must be in the group's project"
            );
        }
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut groups = load(&self.app.cfg.home);
        let existing = req
            .get("group_id")
            .and_then(Value::as_str)
            .map(|id| {
                groups
                    .iter()
                    .find(|group| group.id == id)
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("group not found"))
            })
            .transpose()?;
        let group = Group {
            id: existing
                .as_ref()
                .map_or_else(|| uuid::Uuid::new_v4().to_string(), |g| g.id.clone()),
            name: name.to_string(),
            project_id: project_id.to_string(),
            bot_ids,
            created_at: existing.map_or_else(|| chrono::Utc::now().to_rfc3339(), |g| g.created_at),
        };
        upsert(&mut groups, group.clone());
        store(&self.app.cfg.home, &groups)?;
        self.send(json!({ "type": "group_saved", "req_id": req_id, "group": group }));
        Ok(())
    }

    /// `delete_group {group_id}` → `{group_id}`. Transcripts are untouched.
    pub(super) fn delete_group(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let group_id = Self::str_field(req, "group_id")?;
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut groups = load(&self.app.cfg.home);
        groups.retain(|group| group.id != group_id);
        store(&self.app.cfg.home, &groups)?;
        self.send(json!({ "type": "group_deleted", "req_id": req_id, "group_id": group_id }));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(id: &str, name: &str) -> Group {
        Group {
            id: id.to_string(),
            name: name.to_string(),
            project_id: "p".to_string(),
            bot_ids: vec!["a".to_string(), "b".to_string()],
            created_at: "2026-10-08T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn groups_round_trip_and_upsert_by_id() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load(tmp.path()).is_empty());
        let mut groups = vec![group("1", "One")];
        upsert(&mut groups, group("2", "Two"));
        upsert(&mut groups, group("1", "Renamed"));
        store(tmp.path(), &groups).unwrap();
        let loaded = load(tmp.path());
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].name, "Renamed");
    }
}
