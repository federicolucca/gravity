//! Task queues: work the owner lines up for a bot, handed over one at a time
//! whenever the bot is idle.
//!
//! Each bot has a board with three columns — todo, progress, done. The watcher
//! below types the first todo into the bot's terminal once the bot has sat
//! idle for a moment, exactly as if the owner had sent it, and moves it to
//! progress. When the bot has worked on it and gone idle again the task is
//! done and the next one follows. A paused board is left alone. Boards live in
//! one JSON file in the Gravity home, rewritten atomically.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bus::BotState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::app::AppState;

pub mod models;

const TASKS_FILE: &str = "tasks.json";
const TICK: Duration = Duration::from_secs(3);
/// Idle ticks in a row before the next task goes out, so a bot between two
/// turns of its own is not interrupted.
const IDLE_TICKS: u32 = 2;
/// A task that never showed the bot working (it finished within a tick, or
/// the prompt never landed) still counts as done after this long idle.
const UNSEEN_DONE_SECS: i64 = 90;

/// Serialises read-modify-write cycles on the file.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Todo,
    Progress,
    Done,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Task {
    pub id: String,
    pub bot_id: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub status: Status,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_at: Option<String>,
    /// Whether the bot was seen working since the task went out.
    #[serde(default)]
    pub seen_working: bool,
    /// "opus", "sonnet" or "haiku"; `None` is auto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The model id the task was handed over with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ran_with: Option<String>,
    /// In progress, but the bot is restarting onto `ran_with` first.
    #[serde(default)]
    pub awaiting_model: bool,
    /// What was done, written by the bot when it closes the task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// The bot went idle without closing the task and was asked for its report.
    #[serde(default)]
    pub nudged: bool,
    /// A chat message sent with a model of its own: the body is typed as is,
    /// it jumps the queue, stays off the board and is dropped once answered.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub chat: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Boards {
    /// In queue order; a bot's todo tasks run top to bottom.
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub paused_bots: Vec<String>,
}

fn path(home: &Path) -> PathBuf {
    home.join(TASKS_FILE)
}

pub fn load(home: &Path) -> Boards {
    std::fs::read_to_string(path(home))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn store(home: &Path, boards: &Boards) -> anyhow::Result<()> {
    crate::paths::atomic_write_json(&path(home), &serde_json::to_value(boards)?)
}

/// Runs `change` on the boards under the file lock and saves the result.
pub fn update<T>(
    home: &Path,
    change: impl FnOnce(&mut Boards) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut boards = load(home);
    let out = change(&mut boards)?;
    store(home, &boards)?;
    Ok(out)
}

impl Status {
    pub fn parse(raw: &str) -> anyhow::Result<Self> {
        match raw {
            "todo" => Ok(Self::Todo),
            "progress" => Ok(Self::Progress),
            "done" => Ok(Self::Done),
            _ => anyhow::bail!("status is one of todo, progress, done"),
        }
    }
}

pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_BODY_CHARS: usize = 20_000;

/// Checks and trims a title and body for a task.
pub fn validate(title: &str, body: &str) -> anyhow::Result<(String, String)> {
    let title = title.trim();
    anyhow::ensure!(
        !title.is_empty() && title.chars().count() <= MAX_TITLE_CHARS,
        "a title is 1 to {MAX_TITLE_CHARS} characters"
    );
    anyhow::ensure!(
        body.chars().count() <= MAX_BODY_CHARS,
        "the description is too long"
    );
    Ok((title.to_string(), body.trim().to_string()))
}

/// A new todo for `bot_id`.
pub fn new_task(bot_id: &str, title: String, body: String, model: Option<String>) -> Task {
    Task {
        id: uuid::Uuid::new_v4().to_string(),
        bot_id: bot_id.to_string(),
        title,
        body,
        status: Status::Todo,
        created_at: chrono::Utc::now().to_rfc3339(),
        started_at: None,
        done_at: None,
        seen_working: false,
        model,
        ran_with: None,
        awaiting_model: false,
        comment: None,
        nudged: false,
        chat: false,
    }
}

/// A chat message that has to wait for the bot to switch model.
pub fn chat_task(bot_id: &str, text: &str, model: Option<String>) -> Task {
    let mut task = new_task(bot_id, "Chat message".to_string(), text.to_string(), model);
    task.chat = true;
    task
}

/// Moves a task to another column, keeping its timestamps consistent. Moving
/// to todo or progress never sends anything; the queue picks todo up.
pub fn set_status(task: &mut Task, to: Status) {
    if task.status == to {
        return;
    }
    let now = chrono::Utc::now().to_rfc3339();
    match to {
        Status::Todo => {
            task.started_at = None;
            task.done_at = None;
            task.ran_with = None;
            task.awaiting_model = false;
            task.comment = None;
            task.nudged = false;
        }
        // Marked in progress by hand: the queue waits for the bot to go idle
        // after work before calling it done.
        Status::Progress => {
            task.started_at = Some(now);
            task.done_at = None;
            task.seen_working = false;
        }
        Status::Done => task.done_at = Some(now),
    }
    task.status = to;
}

/// The prompt a task becomes in the bot's terminal.
pub fn prompt(task: &Task) -> String {
    if task.chat {
        return task.body.clone();
    }
    let mut out = format!("[Task] {}", task.title);
    if !task.body.is_empty() {
        out.push_str("\n\n");
        out.push_str(&task.body);
    }
    out.push_str(&format!(
        "\n\n(From your Tasks board, task_id {}. When it is finished, call \
         update_board_task with status \"done\" and a comment saying what was done.)",
        task.id
    ));
    out
}

#[derive(Debug, PartialEq)]
enum Action {
    None,
    /// The bot is busy with the task in progress.
    SeenWorking(String),
    Finish(String),
    Start(String),
    /// The bot is back on the task's model: hand the task over now.
    Send(String),
    /// Idle without closing the task: ask once for the done comment.
    Nudge(String),
}

fn secs_since(at: Option<&str>, now: chrono::DateTime<chrono::Utc>) -> i64 {
    at.and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
        .map_or(i64::MAX, |at| {
            (now - at.with_timezone(&chrono::Utc)).num_seconds()
        })
}

/// What to do for one bot this tick.
fn decide(
    boards: &Boards,
    bot_id: &str,
    state: BotState,
    idle_ticks: u32,
    now: chrono::DateTime<chrono::Utc>,
) -> Action {
    let mine = || boards.tasks.iter().filter(move |t| t.bot_id == bot_id);
    if let Some(task) = mine().find(|t| t.status == Status::Progress) {
        if task.awaiting_model {
            let ready = state == BotState::Ready && idle_ticks >= IDLE_TICKS;
            return if ready {
                Action::Send(task.id.clone())
            } else {
                Action::None
            };
        }
        return match state {
            BotState::Working | BotState::WaitingForApproval | BotState::WaitingForUser
                if !task.seen_working =>
            {
                Action::SeenWorking(task.id.clone())
            }
            BotState::Ready
                if idle_ticks >= IDLE_TICKS
                    && (task.seen_working
                        || secs_since(task.started_at.as_deref(), now) >= UNSEEN_DONE_SECS) =>
            {
                if task.nudged || task.chat {
                    Action::Finish(task.id.clone())
                } else {
                    Action::Nudge(task.id.clone())
                }
            }
            _ => Action::None,
        };
    }
    if state != BotState::Ready || idle_ticks < IDLE_TICKS {
        return Action::None;
    }
    // A waiting chat message goes first, paused board or not.
    if let Some(chat) = mine().find(|t| t.chat && t.status == Status::Todo) {
        return Action::Start(chat.id.clone());
    }
    if boards.paused_bots.iter().any(|id| id == bot_id) {
        return Action::None;
    }
    mine()
        .find(|t| t.status == Status::Todo)
        .map_or(Action::None, |t| Action::Start(t.id.clone()))
}

/// No task in progress and none that would start: a model override can go.
fn nothing_queued(boards: &Boards, bot_id: &str) -> bool {
    let paused = boards.paused_bots.iter().any(|id| id == bot_id);
    !boards.tasks.iter().any(|t| {
        t.bot_id == bot_id
            && (t.status == Status::Progress || (t.status == Status::Todo && (t.chat || !paused)))
    })
}

/// What `apply` does once the board is saved.
enum Effect {
    None,
    Send(Box<Task>),
    Nudge(String),
    Switch(&'static str),
    Restore,
}

fn apply(app: &AppState, bot_id: &str, action: Action) -> anyhow::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let active = models::active(&app.cfg.home, bot_id);
    let current = match &active {
        Some(o) => Some(o.model.clone()),
        None => app.db.bot_model(bot_id)?,
    };
    let effect = update(&app.cfg.home, |boards| {
        let id = match &action {
            Action::None => return Ok(Effect::None),
            Action::SeenWorking(id)
            | Action::Finish(id)
            | Action::Start(id)
            | Action::Send(id)
            | Action::Nudge(id) => id.clone(),
        };
        let paused = boards.paused_bots.iter().any(|b| b == bot_id);
        let next_todo = boards
            .tasks
            .iter()
            .any(|t| t.bot_id == bot_id && t.status == Status::Todo && t.id != id);
        let Some(task) = boards.tasks.iter_mut().find(|t| t.id == id) else {
            return Ok(Effect::None);
        };
        let effect = match action {
            Action::None => Effect::None,
            Action::SeenWorking(_) => {
                task.seen_working = true;
                Effect::None
            }
            Action::Finish(_) => {
                task.status = Status::Done;
                task.done_at = Some(now);
                // The next task decides whether the override stays.
                if active.is_some() && (paused || !next_todo) {
                    Effect::Restore
                } else {
                    Effect::None
                }
            }
            Action::Nudge(_) => {
                task.nudged = true;
                task.seen_working = false;
                task.started_at = Some(now);
                Effect::Nudge(task.id.clone())
            }
            Action::Send(_) => {
                task.awaiting_model = false;
                task.started_at = Some(now);
                Effect::Send(Box::new(task.clone()))
            }
            Action::Start(_) => match models::resolve(task) {
                Some(target)
                    if !current
                        .as_deref()
                        .is_some_and(|c| models::same_family(c, target)) =>
                {
                    task.status = Status::Progress;
                    task.started_at = Some(now);
                    task.seen_working = false;
                    task.awaiting_model = true;
                    task.ran_with = Some(target.to_string());
                    Effect::Switch(target)
                }
                // Wants the bot's own model while a task override is in force.
                None if active.is_some() => Effect::Restore,
                target => {
                    task.status = Status::Progress;
                    task.started_at = Some(now);
                    task.seen_working = false;
                    task.ran_with = target.map(str::to_string).or_else(|| current.clone());
                    Effect::Send(Box::new(task.clone()))
                }
            },
        };
        boards
            .tasks
            .retain(|t| !(t.chat && t.status == Status::Done));
        Ok(effect)
    })?;
    match effect {
        Effect::None => Ok(()),
        Effect::Send(task) => {
            tracing::info!(bot_id, task_id = %task.id, model = ?task.ran_with, "task handed to bot");
            send_prompt(app, bot_id, &prompt(&task))
        }
        Effect::Nudge(id) => send_prompt(
            app,
            bot_id,
            &format!(
                "(Tasks board: task_id {id} is still in progress. If it is finished, call \
                 update_board_task with status \"done\" and a comment saying what was done; \
                 otherwise carry on.)"
            ),
        ),
        Effect::Switch(model) => models::switch(app, bot_id, model),
        Effect::Restore => models::restore(app, bot_id),
    }
}

/// Types `text` into the bot's terminal and submits it, as the chat does.
pub fn send_prompt(app: &AppState, bot_id: &str, text: &str) -> anyhow::Result<()> {
    app.supervisor
        .input(bot_id, format!("\u{1b}[200~{text}\u{1b}[201~").as_bytes())?;
    std::thread::sleep(Duration::from_millis(150));
    app.supervisor.input(bot_id, b"\r")
}

/// Hands queued tasks to idle bots for as long as the daemon runs.
pub async fn watch(app: Arc<AppState>) {
    let mut idle: HashMap<String, u32> = HashMap::new();
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        if crate::drain::active() {
            continue;
        }
        let app = app.clone();
        let mut counts = std::mem::take(&mut idle);
        let result = tokio::task::spawn_blocking(move || {
            crate::drain::resume_ready(&app);
            let boards = load(&app.cfg.home);
            let mut bots: Vec<&str> = boards.tasks.iter().map(|t| t.bot_id.as_str()).collect();
            bots.sort_unstable();
            bots.dedup();
            let mut next = HashMap::new();
            for bot_id in bots {
                let (state, _) = app.supervisor.state(bot_id);
                let ticks = if state == BotState::Ready {
                    counts.remove(bot_id).unwrap_or(0) + 1
                } else {
                    0
                };
                next.insert(bot_id.to_string(), ticks);
                let action = decide(&boards, bot_id, state, ticks, chrono::Utc::now());
                let quiet =
                    action == Action::None && state == BotState::Ready && ticks >= IDLE_TICKS;
                let result = if quiet && nothing_queued(&boards, bot_id) {
                    // A task closed over MCP never passes through `Finish`.
                    models::restore(&app, bot_id)
                } else {
                    apply(&app, bot_id, action)
                };
                if let Err(e) = result {
                    tracing::warn!(bot_id, error = %e, "task step failed");
                }
            }
            next
        })
        .await;
        idle = result.unwrap_or_default();
    }
}

/// The board as the client shows it.
pub fn board_json(boards: &Boards, bot_id: &str) -> Value {
    let tasks: Vec<&Task> = boards
        .tasks
        .iter()
        .filter(|t| t.bot_id == bot_id && !t.chat)
        .collect();
    json!({
        "tasks": tasks,
        "paused": boards.paused_bots.iter().any(|id| id == bot_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, status: Status) -> Task {
        Task {
            id: id.into(),
            bot_id: "b".into(),
            title: id.into(),
            body: String::new(),
            status,
            created_at: "2026-10-08T12:00:00Z".into(),
            started_at: Some("2026-10-08T12:00:00Z".into()),
            done_at: None,
            seen_working: false,
            model: None,
            ran_with: None,
            awaiting_model: false,
            comment: None,
            nudged: false,
            chat: false,
        }
    }

    fn at(secs: i64) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-10-08T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
            + chrono::Duration::seconds(secs)
    }

    #[test]
    fn the_first_todo_starts_once_the_bot_has_been_idle() {
        let boards = Boards {
            tasks: vec![task("a", Status::Todo), task("b", Status::Todo)],
            ..Default::default()
        };
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 1, at(0)),
            Action::None
        );
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 2, at(0)),
            Action::Start("a".into())
        );
        assert_eq!(
            decide(&boards, "b", BotState::Working, 0, at(0)),
            Action::None
        );
    }

    #[test]
    fn a_task_in_progress_finishes_after_the_bot_worked_and_went_idle() {
        let mut boards = Boards {
            tasks: vec![task("a", Status::Progress), task("b", Status::Todo)],
            ..Default::default()
        };
        assert_eq!(
            decide(&boards, "b", BotState::Working, 0, at(5)),
            Action::SeenWorking("a".into())
        );
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 5, at(10)),
            Action::None
        );
        boards.tasks[0].seen_working = true;
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 1, at(10)),
            Action::None
        );
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 2, at(10)),
            Action::Nudge("a".into())
        );
        boards.tasks[0].nudged = true;
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 2, at(10)),
            Action::Finish("a".into())
        );
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 5, at(UNSEEN_DONE_SECS)),
            Action::Finish("a".into())
        );
    }

    #[test]
    fn a_task_waiting_for_its_model_is_sent_once_the_bot_is_back() {
        let mut boards = Boards {
            tasks: vec![task("a", Status::Progress)],
            ..Default::default()
        };
        boards.tasks[0].awaiting_model = true;
        assert_eq!(
            decide(&boards, "b", BotState::Starting, 0, at(5)),
            Action::None
        );
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 1, at(9)),
            Action::None
        );
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 2, at(500)),
            Action::Send("a".into())
        );
    }

    #[test]
    fn a_chat_message_jumps_the_queue_and_skips_the_nudge() {
        let mut boards = Boards {
            tasks: vec![task("a", Status::Todo), task("c", Status::Todo)],
            paused_bots: vec!["b".into()],
        };
        boards.tasks[1].chat = true;
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 2, at(0)),
            Action::Start("c".into())
        );
        boards.tasks[1].status = Status::Progress;
        boards.tasks[1].seen_working = true;
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 2, at(10)),
            Action::Finish("c".into())
        );
        assert!(board_json(&boards, "b")["tasks"]
            .as_array()
            .is_some_and(|tasks| tasks.len() == 1));
        boards.tasks[1].body = "hello".into();
        assert_eq!(prompt(&boards.tasks[1]), "hello");
    }

    #[test]
    fn an_override_goes_once_nothing_is_queued() {
        let mut boards = Boards {
            tasks: vec![task("a", Status::Done), task("t", Status::Todo)],
            ..Default::default()
        };
        assert!(!nothing_queued(&boards, "b"));
        boards.paused_bots.push("b".into());
        assert!(nothing_queued(&boards, "b"));
        boards.tasks[1].status = Status::Progress;
        assert!(!nothing_queued(&boards, "b"));
        boards.tasks[1].status = Status::Done;
        assert!(nothing_queued(&boards, "b"));
    }

    #[test]
    fn a_paused_board_starts_nothing() {
        let boards = Boards {
            tasks: vec![task("a", Status::Todo)],
            paused_bots: vec!["b".into()],
        };
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 9, at(0)),
            Action::None
        );
    }

    #[test]
    fn prompts_carry_the_title_body_and_id() {
        let mut t = task("Fix the build", Status::Todo);
        assert!(prompt(&t)
            .starts_with("[Task] Fix the build\n\n(From your Tasks board, task_id Fix the build."));
        t.body = "details".into();
        assert!(prompt(&t).starts_with("[Task] Fix the build\n\ndetails\n\n(From"));
    }
}
