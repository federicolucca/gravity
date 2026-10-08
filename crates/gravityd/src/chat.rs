//! A bot's conversation as a chat: what was said, without the work in between.
//!
//! The terminal shows everything Claude Code does. The chat view shows the
//! dialogue only — the owner's prompts, the bot's replies and the bus traffic —
//! and folds each run of tool calls into one collapsible `steps` item. It is
//! read from the same JSONL transcript the sidebar preview uses.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::activity::{newest_transcript, tail_lines_within, transcript_dir};

/// How much of the transcript's tail to read. Tool results make entries
/// large, so this is far more than the preview needs.
const TAIL_BYTES: u64 = 8 << 20;

/// Upper bound on transcript lines scanned per request.
const SCAN_LINES: usize = 4000;

/// Default and maximum number of items returned.
pub const DEFAULT_LIMIT: usize = 200;
const MAX_LIMIT: usize = 1000;

/// Longest text shipped for one step's detail.
const MAX_DETAIL_CHARS: usize = 160;

/// Prefix of the MCP tools the bus exposes to bots.
const BUS_TOOL_PREFIX: &str = "mcp__gravity-bus__";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Step {
    pub tool: String,
    pub detail: String,
}

/// One chat item. `kind` is `user`, `bot`, `bus_in`, `bus_out` or `steps`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatItem {
    pub kind: &'static str,
    pub at: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub text: String,
    /// The other bot, for bus items.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub peer: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<Step>,
}

impl ChatItem {
    fn new(kind: &'static str, at: &str, text: String) -> Self {
        Self {
            kind,
            at: at.to_string(),
            text,
            peer: String::new(),
            steps: Vec::new(),
        }
    }
}

/// The newest `limit` chat items of a bot's Claude Code session, oldest first.
pub fn for_workspace(home: &Path, workspace: &Path, limit: usize) -> Vec<ChatItem> {
    let Some(path) = newest_transcript(&transcript_dir(home, workspace)) else {
        return Vec::new();
    };
    let mut lines = tail_lines_within(&path, SCAN_LINES, TAIL_BYTES);
    lines.reverse();
    let mut items = from_lines(&lines);
    let keep = limit.clamp(1, MAX_LIMIT);
    if items.len() > keep {
        items.drain(..items.len() - keep);
    }
    items
}

/// Builds chat items from transcript lines in file order.
pub fn from_lines(lines: &[String]) -> Vec<ChatItem> {
    let mut items: Vec<ChatItem> = Vec::new();
    for line in lines {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if entry.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let at = entry.get("timestamp").and_then(Value::as_str).unwrap_or("");
        match entry.get("type").and_then(Value::as_str) {
            Some("user") => push_user(&mut items, &entry, at),
            Some("assistant") => push_assistant(&mut items, &entry, at),
            Some("attachment") => push_queued(&mut items, &entry, at),
            _ => {}
        }
    }
    items
}

/// A prompt typed by the owner (terminal or Remote Control). Tool results,
/// compaction summaries and harness-injected entries are not dialogue.
fn push_user(items: &mut Vec<ChatItem>, entry: &Value, at: &str) {
    if entry.get("isMeta").and_then(Value::as_bool) == Some(true)
        || entry.get("isCompactSummary").and_then(Value::as_bool) == Some(true)
    {
        return;
    }
    let Some(content) = entry.get("message").and_then(|m| m.get("content")) else {
        return;
    };
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => {
            if blocks.iter().any(|b| block_type(b) == "tool_result") {
                return;
            }
            let mut parts: Vec<String> = Vec::new();
            for block in blocks {
                match block_type(block) {
                    "text" => parts.extend(block_text(block)),
                    "image" => parts.push("[image]".to_string()),
                    _ => {}
                }
            }
            parts.join("\n")
        }
        _ => return,
    };
    let text = text.trim();
    if text.is_empty() || is_harness_text(text) {
        return;
    }
    push_prompt(items, text, at);
}

/// A bus delivery that Claude Code queued while the bot was busy.
fn push_queued(items: &mut Vec<ChatItem>, entry: &Value, at: &str) {
    let Some(attachment) = entry.get("attachment") else {
        return;
    };
    if attachment.get("type").and_then(Value::as_str) != Some("queued_command") {
        return;
    }
    if let Some(prompt) = attachment.get("prompt").and_then(Value::as_str) {
        push_prompt(items, prompt.trim(), at);
    }
}

/// A prompt, split into an owner message or an incoming bus message.
fn push_prompt(items: &mut Vec<ChatItem>, text: &str, at: &str) {
    match parse_bus_header(text) {
        Some((sender, body)) if sender == "USER" => {
            items.push(ChatItem::new("user", at, body.to_string()));
        }
        Some((sender, body)) => {
            let mut item = ChatItem::new("bus_in", at, body.to_string());
            item.peer = sender.to_string();
            items.push(item);
        }
        None => items.push(ChatItem::new("user", at, text.to_string())),
    }
}

fn push_assistant(items: &mut Vec<ChatItem>, entry: &Value, at: &str) {
    let Some(blocks) = entry
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return;
    };
    for block in blocks {
        match block_type(block) {
            "text" => {
                if let Some(text) = block_text(block).filter(|t| !t.trim().is_empty()) {
                    items.push(ChatItem::new("bot", at, text.trim().to_string()));
                }
            }
            "tool_use" => push_tool(items, block, at),
            _ => {}
        }
    }
}

fn push_tool(items: &mut Vec<ChatItem>, block: &Value, at: &str) {
    let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
    let input = block.get("input").unwrap_or(&Value::Null);
    if name == format!("{BUS_TOOL_PREFIX}send_message") {
        let mut item = ChatItem::new("bus_out", at, str_field(input, "body"));
        item.peer = str_field(input, "to");
        items.push(item);
        return;
    }
    let step = Step {
        tool: name.strip_prefix("mcp__").unwrap_or(name).to_string(),
        detail: clip(&step_detail(name, input)),
    };
    match items.last_mut() {
        Some(last) if last.kind == "steps" => last.steps.push(step),
        _ => {
            let mut item = ChatItem::new("steps", at, String::new());
            item.steps.push(step);
            items.push(item);
        }
    }
}

/// The one input field that says what a tool call did.
fn step_detail(name: &str, input: &Value) -> String {
    let keys: &[&str] = match name {
        "Bash" => &["description", "command"],
        "Read" | "Edit" | "Write" | "NotebookEdit" => &["file_path", "notebook_path"],
        "Grep" | "Glob" => &["pattern"],
        "WebFetch" => &["url"],
        "WebSearch" => &["query"],
        "Agent" | "Task" => &["description"],
        _ => &["description", "command", "path", "file_path", "query", "pattern", "to"],
    };
    keys.iter()
        .map(|k| str_field(input, k))
        .find(|v| !v.is_empty())
        .unwrap_or_default()
}

/// `[msg #N from SENDER[ @ MACHINE] · kind[ · task_id ID]] body` → (sender, body).
fn parse_bus_header(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix("[msg #")?;
    let close = rest.find(']')?;
    let header = &rest[..close];
    let body = rest[close + 1..].trim_start();
    let from = header.split_once(" from ")?.1;
    let sender = from.split(" · ").next()?;
    let sender = sender.split(" @ ").next()?.trim();
    Some((sender, body))
}

/// Entries Claude Code itself writes as user turns.
fn is_harness_text(text: &str) -> bool {
    [
        "<command-name>",
        "<command-message>",
        "<local-command-",
        "<system-reminder>",
        "<task-notification>",
        "[Request interrupted",
        "Caveat: ",
    ]
    .iter()
    .any(|p| text.starts_with(p))
}

fn block_type(block: &Value) -> &str {
    block.get("type").and_then(Value::as_str).unwrap_or("")
}

fn block_text(block: &Value) -> Option<String> {
    block.get("text").and_then(Value::as_str).map(str::to_string)
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn clip(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    if line.chars().count() <= MAX_DETAIL_CHARS {
        return line.to_string();
    }
    let cut: String = line.chars().take(MAX_DETAIL_CHARS).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests;
