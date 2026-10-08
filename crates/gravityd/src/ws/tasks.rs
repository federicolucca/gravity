//! Requests for the task boards; the queue itself runs in `crate::tasks`.

use serde_json::{json, Value};

use super::Conn;
use crate::tasks::{
    board_json, chat_task, load, models, new_task, send_prompt, set_status, update, validate,
    Status,
};
use bus::BotState;

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

    /// `save_task {bot_id, task_id?, title, body, model?}` → the board; no id adds to the todo column.
    pub(super) fn save_task(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        anyhow::ensure!(self.app.db.get_bot(bot_id)?.is_some(), "bot not found");
        let (title, body) = validate(
            Self::str_field(req, "title")?,
            req.get("body").and_then(Value::as_str).unwrap_or(""),
        )?;
        let model = models::parse_choice(req.get("model").and_then(Value::as_str))?;
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
                    if req.get("model").is_some() {
                        task.model = model;
                    }
                }
                None => boards.tasks.push(new_task(bot_id, title, body, model)),
            }
            Ok(())
        })?;
        self.send_board(req_id, bot_id);
        Ok(())
    }

    /// `send_chat {bot_id, text, model}` → `{type:"chat_model", switched, model?, reason?}`.
    ///
    /// A chat message with a model of its own. Idle and on another model: the
    /// message waits on the bot's queue while it restarts onto the model, and
    /// goes back afterwards. Busy, or already on that model: typed straight in.
    pub(super) fn send_chat(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let bot_id = Self::str_field(req, "bot_id")?;
        let text = Self::str_field(req, "text")?;
        anyhow::ensure!(!text.trim().is_empty(), "text is empty");
        anyhow::ensure!(self.app.db.get_bot(bot_id)?.is_some(), "bot not found");
        let choice = models::parse_choice(req.get("model").and_then(Value::as_str))?;
        let task = chat_task(bot_id, text, choice);
        let target = models::resolve(&task);
        let current = match models::active(&self.app.cfg.home, bot_id) {
            Some(o) => Some(o.model),
            None => self.app.db.bot_model(bot_id)?,
        };
        let same = match (target, current.as_deref()) {
            (None, _) => true,
            (Some(t), Some(c)) => models::same_family(c, t),
            (Some(_), None) => false,
        };
        let idle = self.app.supervisor.state(bot_id).0 == BotState::Ready;
        if same || !idle {
            send_prompt(&self.app, bot_id, text)?;
            let reason = if same {
                "already on that model"
            } else {
                "bot is busy: sent with its current model"
            };
            self.send(json!({
                "type": "chat_model", "req_id": req_id, "switched": false,
                "model": target, "reason": reason,
            }));
            return Ok(());
        }
        update(&self.app.cfg.home, |boards| {
            boards.tasks.insert(0, task);
            Ok(())
        })?;
        self.send(json!({
            "type": "chat_model", "req_id": req_id, "switched": true, "model": target,
        }));
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
