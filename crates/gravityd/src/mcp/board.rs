//! MCP tools for a bot's own Tasks board: the queue the daemon feeds it from
//! whenever it is idle (see `crate::tasks`). A bot only sees and changes its
//! own board.

use std::sync::Arc;

use serde_json::{json, Value};

use super::schema::tool;
use crate::app::AppState;
use crate::tasks::{board_json, load, new_task, set_status, update, validate, Status};

pub(super) fn board_tools() -> Vec<Value> {
    vec![
        tool(
            "list_board_tasks",
            "List your Tasks board: work queued for you in todo, progress and done. The daemon \
              types your top todo task into your session whenever you are idle, one at a time.",
            json!({}),
            vec![],
        ),
        tool(
            "add_board_task",
            "Queue work for yourself on your Tasks board. It is handed to you as a new prompt \
              once you are idle and earlier tasks are done; use it to split a big job or to \
              schedule a follow-up for after the current one.",
            json!({
                "title": {"type": "string", "description": "One line, up to 200 characters"},
                "body": {"type": "string", "description": "Optional details: what to do and what done looks like"},
                "first": {"type": "boolean", "description": "Put it at the top of the queue instead of the bottom"}
            }),
            vec!["title"],
        ),
        tool(
            "update_board_task",
            "Change one of your board tasks: its title, details or status. Set status \"done\" \
              when you finish a task you were handed, so the next one follows.",
            json!({
                "task_id": {"type": "string"},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "status": {"type": "string", "enum": ["todo", "progress", "done"]}
            }),
            vec!["task_id"],
        ),
        tool(
            "delete_board_task",
            "Remove one of your board tasks.",
            json!({ "task_id": {"type": "string"} }),
            vec!["task_id"],
        ),
    ]
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

pub(super) fn list_board_tasks(app: &Arc<AppState>, bot_id: &str) -> anyhow::Result<Value> {
    Ok(board_json(&load(&app.cfg.home), bot_id))
}

pub(super) fn add_board_task(
    app: &Arc<AppState>,
    bot_id: &str,
    args: &Value,
) -> anyhow::Result<Value> {
    let (title, body) = validate(
        str_arg(args, "title").ok_or_else(|| anyhow::anyhow!("title is required"))?,
        str_arg(args, "body").unwrap_or(""),
    )?;
    let first = args.get("first").and_then(Value::as_bool).unwrap_or(false);
    let task = new_task(bot_id, title, body);
    let out = json!({ "task_id": task.id, "status": "todo" });
    update(&app.cfg.home, |boards| {
        let at = if first {
            boards
                .tasks
                .iter()
                .position(|t| t.bot_id == bot_id && t.status == Status::Todo)
        } else {
            None
        };
        boards.tasks.insert(at.unwrap_or(boards.tasks.len()), task);
        Ok(())
    })?;
    Ok(out)
}

pub(super) fn update_board_task(
    app: &Arc<AppState>,
    bot_id: &str,
    args: &Value,
) -> anyhow::Result<Value> {
    let task_id = str_arg(args, "task_id").ok_or_else(|| anyhow::anyhow!("task_id is required"))?;
    let status = str_arg(args, "status").map(Status::parse).transpose()?;
    update(&app.cfg.home, |boards| {
        let task = boards
            .tasks
            .iter_mut()
            .find(|t| t.id == task_id && t.bot_id == bot_id)
            .ok_or_else(|| anyhow::anyhow!("no task {task_id} on your board"))?;
        if str_arg(args, "title").is_some() || str_arg(args, "body").is_some() {
            let (title, body) = validate(
                str_arg(args, "title").unwrap_or(&task.title),
                str_arg(args, "body").unwrap_or(&task.body),
            )?;
            task.title = title;
            task.body = body;
        }
        if let Some(status) = status {
            set_status(task, status);
        }
        Ok(json!({ "task_id": task.id, "status": task.status }))
    })
}

pub(super) fn delete_board_task(
    app: &Arc<AppState>,
    bot_id: &str,
    args: &Value,
) -> anyhow::Result<Value> {
    let task_id = str_arg(args, "task_id").ok_or_else(|| anyhow::anyhow!("task_id is required"))?;
    update(&app.cfg.home, |boards| {
        let before = boards.tasks.len();
        boards
            .tasks
            .retain(|t| !(t.id == task_id && t.bot_id == bot_id));
        anyhow::ensure!(
            boards.tasks.len() < before,
            "no task {task_id} on your board"
        );
        Ok(json!({ "deleted": task_id }))
    })
}
