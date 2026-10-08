//! A bot's emoji reactions to the owner's messages in the chat view.
//!
//! A reaction is the bot's mark on one owner message — one emoji per message,
//! keyed by the message's transcript timestamp. The owner cannot react to bot
//! replies; bots set theirs over MCP (`react_to_message`). Kept per bot in one
//! JSON file in the Gravity home.

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

/// `bot id → owner message key → emoji`.
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
}

/// An emoji is one reaction: short, and nothing alphanumeric in it.
pub fn valid_emoji(emoji: &str) -> bool {
    !emoji.is_empty()
        && emoji.chars().count() <= MAX_EMOJI_CHARS
        && !emoji.chars().any(char::is_alphanumeric)
}

/// Sets or clears (`None`) a bot's reaction to one of the owner's messages.
pub fn react(home: &Path, bot_id: &str, key: &str, emoji: Option<&str>) -> anyhow::Result<()> {
    anyhow::ensure!(
        !key.is_empty() && key.chars().count() <= MAX_KEY_CHARS,
        "invalid message key"
    );
    if let Some(emoji) = emoji {
        anyhow::ensure!(valid_emoji(emoji), "a reaction is one emoji");
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load(home);
    apply(&mut all, bot_id, key, emoji);
    crate::paths::atomic_write_json(&reactions_path(home), &json!(all))
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

    #[test]
    fn only_a_short_emoji_is_a_reaction() {
        assert!(valid_emoji("👍"));
        assert!(valid_emoji("❤️"));
        assert!(!valid_emoji(""));
        assert!(!valid_emoji("ok"));
        assert!(!valid_emoji("👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍"));
    }
}
