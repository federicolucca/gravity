use serde_json::json;

use super::*;

fn lines(entries: &[Value]) -> Vec<String> {
    entries.iter().map(Value::to_string).collect()
}

fn typed(text: &str) -> Value {
    json!({ "type": "user", "timestamp": "t1", "message": { "content": text } })
}

fn said(blocks: Value) -> Value {
    json!({ "type": "assistant", "timestamp": "t2", "message": { "content": blocks } })
}

#[test]
fn keeps_the_dialogue_and_folds_tool_calls_into_one_steps_item() {
    let items = from_lines(&lines(&[
        typed("check the deploy"),
        said(json!([{ "type": "text", "text": "Checking." }])),
        said(json!([{ "type": "tool_use", "name": "Bash", "input": { "command": "ls", "description": "List files" } }])),
        json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "x" }] } }),
        said(json!([{ "type": "tool_use", "name": "Read", "input": { "file_path": "/a.rs" } }])),
        said(json!([{ "type": "text", "text": "All good." }])),
    ]));
    let kinds: Vec<&str> = items.iter().map(|i| i.kind).collect();
    assert_eq!(kinds, ["user", "bot", "steps", "bot"]);
    assert_eq!(
        items[2].steps,
        [
            Step { tool: "Bash".into(), detail: "List files".into() },
            Step { tool: "Read".into(), detail: "/a.rs".into() },
        ]
    );
}

#[test]
fn splits_bus_traffic_from_owner_prompts() {
    let items = from_lines(&lines(&[
        typed("[msg #8 from USER · chat] status?"),
        json!({ "type": "attachment", "timestamp": "t3", "attachment": {
            "type": "queued_command", "prompt": "[msg #9 from Arty @ mac · task · task_id 42] run it" } }),
        said(json!([{ "type": "tool_use", "name": "mcp__gravity-bus__send_message",
            "input": { "to": "Reflex", "body": "done" } }])),
    ]));
    assert_eq!(items[0].kind, "user");
    assert_eq!(items[0].text, "status?");
    assert_eq!((items[1].kind, items[1].peer.as_str(), items[1].text.as_str()), ("bus_in", "Arty", "run it"));
    assert_eq!((items[2].kind, items[2].peer.as_str()), ("bus_out", "Reflex"));
}

#[test]
fn drops_harness_entries_and_sidechains() {
    let items = from_lines(&lines(&[
        typed("<command-name>/exit</command-name>"),
        json!({ "type": "user", "isMeta": true, "message": { "content": "meta" } }),
        json!({ "type": "user", "isSidechain": true, "message": { "content": "agent prompt" } }),
        json!({ "type": "user", "isCompactSummary": true, "message": { "content": "summary" } }),
        typed("real"),
    ]));
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].text, "real");
}
