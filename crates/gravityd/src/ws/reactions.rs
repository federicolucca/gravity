//! The owner's emoji reactions to bot replies in the chat view.
//!
//! A reaction is the owner's mark on one reply — one emoji per reply, keyed by
//! the reply's transcript timestamp — and stays on this side: the bot never
//! sees it. Kept per bot in one JSON file in the Gravity home.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};

use super::Conn;

const REACTIONS_FILE: &str = "reactions.json";
/// An emoji is a few code points (skin tones, ZWJ sequences); anything longer is not one.
const MAX_EMOJI_CHARS: usize = 16;
const MAX_KEY_CHARS: usize = 64;

static LOCK: Mutex<()> = Mutex::new(());

/// `bot id → reply key → emoji`.
type Reactions = BTreeMap<String, BTreeMap<String, String>>;

fn reactions_path(home: &Path) -> PathBuf {
    home.join(REACTIONS_FILE)
}

fn load(home: &Path) -> Reactions {
    std::fs::read_to_string(reactions_path(home))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Sets or clears (`None`) one reaction.
fn apply(all: &mut Reactions, bot_id: &str, key: &str, emoji: Option<&str>) {
    match emoji {
        Some(emoji) => {
            all.entry(bot_id.to_string())
                .or_default()
                .insert(key.to_string(), emoji.to_string());
        }
        None => {
            if let Some(bot) = all.get_mut(bot_id) {
                bot.remove(key);
                if bot.is_empty() {
                    all.remove(bot_id);
                }
            }
        }
    }
}

impl Conn {
    /// `list_reactions {bot_id}` → `{reactions: {key: emoji}}`.
    pub(super) fn list_reactions(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        let reactions = load(&self.app.cfg.home).remove(bot_id).unwrap_or_default();
        self.send(json!({ "type": "reactions", "req_id": req_id, "reactions": reactions }));
        Ok(())
    }

    /// `set_reaction {bot_id, key, emoji?}` → `{reactions}`; no emoji clears it.
    pub(super) fn set_reaction(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        let key = Self::str_field(req, "key")?;
        anyhow::ensure!(
            !key.is_empty() && key.chars().count() <= MAX_KEY_CHARS,
            "invalid reply key"
        );
        let emoji = req
            .get("emoji")
            .and_then(Value::as_str)
            .filter(|e| !e.is_empty());
        if let Some(emoji) = emoji {
            anyhow::ensure!(
                emoji.chars().count() <= MAX_EMOJI_CHARS
                    && !emoji.chars().any(char::is_alphanumeric),
                "a reaction is one emoji"
            );
        }
        anyhow::ensure!(self.app.db.get_bot(bot_id)?.is_some(), "bot not found");
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut all = load(&self.app.cfg.home);
        apply(&mut all, bot_id, key, emoji);
        crate::paths::atomic_write_json(&reactions_path(&self.app.cfg.home), &json!(all))?;
        let reactions = all.remove(bot_id).unwrap_or_default();
        self.send(json!({ "type": "reactions", "req_id": req_id, "reactions": reactions }));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reactions_set_replace_and_clear() {
        let mut all = Reactions::new();
        apply(&mut all, "b", "t1", Some("👍"));
        apply(&mut all, "b", "t1", Some("❤️"));
        apply(&mut all, "b", "t2", Some("🎉"));
        assert_eq!(all["b"]["t1"], "❤️");
        apply(&mut all, "b", "t1", None);
        apply(&mut all, "b", "t2", None);
        assert!(all.is_empty());
    }
}
