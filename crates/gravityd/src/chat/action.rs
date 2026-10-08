//! What a working bot is doing right now, in a few words, for the line under
//! its name: the newest transcript entry tells thinking from a tool call, and
//! the tool call names the work.

use std::path::Path;

use serde_json::Value;

use super::{clip, step_detail, BUS_TOOL_PREFIX};
use crate::activity::{newest_transcript, tail_lines_within, transcript_dir};

/// The current action sits at the very end of the transcript.
const SCAN_LINES: usize = 40;
const TAIL_BYTES: u64 = 1 << 20;

/// The current action of a bot's session, or None without a transcript.
pub fn for_workspace(home: &Path, workspace: &Path) -> Option<String> {
    let path = newest_transcript(&transcript_dir(home, workspace))?;
    from_newest_first(&tail_lines_within(&path, SCAN_LINES, TAIL_BYTES))
}

/// Reads lines newest first and describes the first one that says anything.
pub fn from_newest_first(lines: &[String]) -> Option<String> {
    lines.iter().find_map(|line| {
        let entry: Value = serde_json::from_str(line).ok()?;
        if entry.get("isSidechain").and_then(Value::as_bool) == Some(true)
            || entry.get("isMeta").and_then(Value::as_bool) == Some(true)
        {
            return None;
        }
        match entry.get("type").and_then(Value::as_str)? {
            "assistant" => assistant_action(&entry),
            // A prompt or a tool result just arrived: the model is on it.
            "user" | "attachment" => Some("Thinking".to_string()),
            _ => None,
        }
    })
}

fn assistant_action(entry: &Value) -> Option<String> {
    let blocks = entry.get("message")?.get("content")?.as_array()?;
    let last = blocks.last()?;
    match last.get("type").and_then(Value::as_str)? {
        "tool_use" => {
            let name = last.get("name").and_then(Value::as_str).unwrap_or("");
            let input = last.get("input").cloned().unwrap_or(Value::Null);
            let detail = clip(&step_detail(name, &input));
            let verb = verb(name);
            Some(if detail.is_empty() {
                verb
            } else {
                format!("{verb} · {detail}")
            })
        }
        "text" => Some("Writing".to_string()),
        _ => Some("Thinking".to_string()),
    }
}

fn verb(tool: &str) -> String {
    let short = tool.rsplit("__").next().unwrap_or(tool);
    match short {
        "Bash" | "ctx_shell" | "shell" => "Running",
        "Read" | "ctx_read" | "NotebookRead" => "Reading",
        "Edit" | "Write" | "NotebookEdit" | "ctx_patch" | "MultiEdit" => "Editing",
        "Grep" | "Glob" | "ctx_search" | "ctx_glob" | "ctx_tree" | "ctx_compose" => "Searching",
        "WebFetch" | "WebSearch" => "Browsing",
        "Agent" | "Task" => "Delegating",
        "TodoWrite" => "Planning",
        _ if tool.starts_with(BUS_TOOL_PREFIX) => match short {
            "send_message" => "Messaging",
            "complete_task" => "Reporting",
            "raise_decision" => "Asking you",
            _ => "Using the bus",
        },
        _ => return format!("Using {short}"),
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(v: Value) -> String {
        v.to_string()
    }

    #[test]
    fn names_the_running_tool() {
        let lines = [line(serde_json::json!({
            "type": "assistant",
            "message": {"content": [{"type": "tool_use", "name": "Bash",
                "input": {"description": "Run the tests", "command": "cargo test"}}]}
        }))];
        assert_eq!(
            from_newest_first(&lines).as_deref(),
            Some("Running · Run the tests")
        );
    }

    #[test]
    fn a_tool_result_means_thinking() {
        let lines = [
            line(serde_json::json!({"type": "user", "message": {"content": []}})),
            line(serde_json::json!({"type": "assistant",
                "message": {"content": [{"type": "text", "text": "hi"}]}})),
        ];
        assert_eq!(from_newest_first(&lines).as_deref(), Some("Thinking"));
    }

    #[test]
    fn bus_tools_get_their_own_words() {
        assert_eq!(verb("mcp__gravity-bus__send_message"), "Messaging");
        assert_eq!(verb("mcp__lean-ctx__ctx_read"), "Reading");
        assert_eq!(verb("Skill"), "Using Skill");
    }
}
