//! Requests for the task boards; the queue itself runs in `crate::tasks`.

use serde_json::{json, Value};

use super::Conn;
use crate::tasks::{board_json, load, new_task, set_status, update, validate, Status};

impl Conn {
    fn send_board(&self, req_id: &Value, bot_id: &str) {
        let board = board_json(&load(&self.app.cfg.home), bot_id);
        self.send(json!({
            "type": "tasks", "req_id": req_id, "bot_id": bot_id,
            "tasks": board["tasks"], "paused": board["paused"],
        }));
    }

    /// `list_tasks {bot_id}` → `{bot_id, tasks, paused}`.
    pub(super) fn list_tasks(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        self.send_board(req_id, Self::str_field(req, "bot_id")?);
        Ok(())
    }

    /// `save_task {bot_id, task_id?, title, body}` → the board; no id adds to the todo column.
    pub(super) fn save_task(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        anyhow::ensure!(self.app.db.get_bot(bot_id)?.is_some(), "bot not found");
        let (title, body) = validate(
            Self::str_field(req, "title")?,
            req.get("body").and_then(Value::as_str).unwrap_or(""),
        )?;
        let task_id = req.get("task_id").and_then(Value::as_str);
        update(&self.app.cfg.home, |boards| {
            match task_id {
                Some(id) => {
                    let task = boards
                        .tasks
                        .iter_mut()
                        .find(|t| t.id == id && t.bot_id == bot_id)
                        .ok_or_else(|| anyhow::anyhow!("task not found"))?;
                    task.title = title;
                    task.body = body;
                }
                None => boards.tasks.push(new_task(bot_id, title, body)),
            }
            Ok(())
        })?;
        self.send_board(req_id, bot_id);
        Ok(())
    }

    /// `move_task {bot_id, task_id, status, before_id?}` → the board.
    pub(super) fn move_task(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        let task_id = Self::str_field(req, "task_id")?;
        let to = Status::parse(Self::str_field(req, "status")?)?;
        let before = req.get("before_id").and_then(Value::as_str);
        update(&self.app.cfg.home, |boards| {
            let index = boards
                .tasks
                .iter()
                .position(|t| t.id == task_id && t.bot_id == bot_id)
                .ok_or_else(|| anyhow::anyhow!("task not found"))?;
            let mut task = boards.tasks.remove(index);
            set_status(&mut task, to);
            let at = before
                .and_then(|id| boards.tasks.iter().position(|t| t.id == id))
                .unwrap_or(boards.tasks.len());
            boards.tasks.insert(at, task);
            Ok(())
        })?;
        self.send_board(req_id, bot_id);
        Ok(())
    }

    /// `delete_task {bot_id, task_id}` → the board.
    pub(super) fn delete_task(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        let task_id = Self::str_field(req, "task_id")?;
        update(&self.app.cfg.home, |boards| {
            boards
                .tasks
                .retain(|t| !(t.id == task_id && t.bot_id == bot_id));
            Ok(())
        })?;
        self.send_board(req_id, bot_id);
        Ok(())
    }

    /// `pause_tasks {bot_id, paused}` → the board.
    pub(super) fn pause_tasks(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        let paused = req.get("paused").and_then(Value::as_bool).unwrap_or(false);
        update(&self.app.cfg.home, |boards| {
            boards.paused_bots.retain(|id| id != bot_id);
            if paused {
                boards.paused_bots.push(bot_id.to_string());
            }
            Ok(())
        })?;
        self.send_board(req_id, bot_id);
        Ok(())
    }
}
