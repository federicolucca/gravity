//! `react_to_message`: a bot's emoji on one of the owner's messages.

use std::path::Path;
use std::sync::Arc;

use serde_json::{json, Value};

use super::schema::tool;
use crate::app::AppState;

/// Prompts the daemon types for the bot itself are not the owner's words.
const NOT_OWNER: &[&str] = &["[Task]", "(Tasks board"];

pub(super) fn react_tools() -> Vec<Value> {
    vec![tool(
        "react_to_message",
        "Put one emoji on a message the owner sent you, like a chat reaction (an acknowledgement, \
         a thumbs up for a request you will do, a check mark once it is done). It lands on their \
         latest message unless `at` names another. Reacting again replaces your emoji; pass an \
         empty emoji to remove it. Only the owner's messages can be reacted to.",
        json!({
            "emoji": {"type": "string", "description": "One emoji, e.g. 👍 ✅ 👀 🎉; empty removes it"},
            "at": {"type": "string", "description": "Timestamp of the owner message, as in your chat; omit for the latest"}
        }),
        vec!["emoji"],
    )]
}

fn is_owner_text(text: &str) -> bool {
    !text.trim().is_empty() && !NOT_OWNER.iter().any(|p| text.trim_start().starts_with(p))
}

pub(super) fn react_to_message(
    app: &Arc<AppState>,
    bot_id: &str,
    args: &Value,
) -> anyhow::Result<Value> {
    let emoji = args
        .get("emoji")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let bot = app
        .db
        .get_bot(bot_id)?
        .ok_or_else(|| anyhow::anyhow!("bot not found"))?;
    let items = crate::chat::for_workspace(
        &app.cfg.user_home,
        Path::new(&bot.workspace_path),
        crate::chat::DEFAULT_LIMIT,
    );
    let mut owner = items
        .iter()
        .filter(|item| item.kind == "user" && is_owner_text(&item.text));
    let key = match args.get("at").and_then(Value::as_str) {
        Some(at) => owner
            .find(|item| item.at == at)
            .map(|item| item.at.clone())
            .ok_or_else(|| anyhow::anyhow!("no owner message at {at}"))?,
        None => owner
            .next_back()
            .map(|item| item.at.clone())
            .ok_or_else(|| anyhow::anyhow!("the owner has not written to you yet"))?,
    };
    crate::ws::reactions::react(
        &app.cfg.home,
        bot_id,
        &key,
        (!emoji.is_empty()).then_some(emoji),
    )?;
    Ok(json!({ "at": key, "emoji": emoji }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_and_task_prompts_are_not_the_owner() {
        assert!(is_owner_text("please check the build"));
        assert!(!is_owner_text("[Task] Fix it"));
        assert!(!is_owner_text(
            "(Tasks board: task_id x is still in progress)"
        ));
        assert!(!is_owner_text("   "));
    }
}
