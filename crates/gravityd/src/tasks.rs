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

/// The prompt a task becomes in the bot's terminal.
pub fn prompt(task: &Task) -> String {
    if task.body.trim().is_empty() {
        format!("[Task] {}", task.title)
    } else {
        format!("[Task] {}\n\n{}", task.title, task.body.trim())
    }
}

#[derive(Debug, PartialEq)]
enum Action {
    None,
    /// The bot is busy with the task in progress.
    SeenWorking(String),
    Finish(String),
    Start(String),
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
                Action::Finish(task.id.clone())
            }
            _ => Action::None,
        };
    }
    if state != BotState::Ready
        || idle_ticks < IDLE_TICKS
        || boards.paused_bots.iter().any(|id| id == bot_id)
    {
        return Action::None;
    }
    mine()
        .find(|t| t.status == Status::Todo)
        .map_or(Action::None, |t| Action::Start(t.id.clone()))
}

fn apply(app: &AppState, bot_id: &str, action: Action) -> anyhow::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let started = update(&app.cfg.home, |boards| {
        let id = match &action {
            Action::None => return Ok(None),
            Action::SeenWorking(id) | Action::Finish(id) | Action::Start(id) => id,
        };
        let Some(task) = boards.tasks.iter_mut().find(|t| &t.id == id) else {
            return Ok(None);
        };
        match action {
            Action::SeenWorking(_) => task.seen_working = true,
            Action::Finish(_) => {
                task.status = Status::Done;
                task.done_at = Some(now);
            }
            Action::Start(_) => {
                task.status = Status::Progress;
                task.started_at = Some(now);
                task.seen_working = false;
                return Ok(Some(task.clone()));
            }
            Action::None => {}
        }
        Ok(None)
    })?;
    if let Some(task) = started {
        tracing::info!(bot_id, task_id = %task.id, "task handed to bot");
        send_prompt(app, bot_id, &prompt(&task))?;
    }
    Ok(())
}

/// Types `text` into the bot's terminal and submits it, as the chat does.
fn send_prompt(app: &AppState, bot_id: &str, text: &str) -> anyhow::Result<()> {
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
        let app = app.clone();
        let mut counts = std::mem::take(&mut idle);
        let result = tokio::task::spawn_blocking(move || {
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
                if let Err(e) = apply(&app, bot_id, action) {
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
    let tasks: Vec<&Task> = boards.tasks.iter().filter(|t| t.bot_id == bot_id).collect();
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
            Action::Finish("a".into())
        );
        assert_eq!(
            decide(&boards, "b", BotState::Ready, 5, at(UNSEEN_DONE_SECS)),
            Action::Finish("a".into())
        );
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
    fn prompts_carry_the_title_and_body() {
        let mut t = task("Fix the build", Status::Todo);
        assert_eq!(prompt(&t), "[Task] Fix the build");
        t.body = " details ".into();
        assert_eq!(prompt(&t), "[Task] Fix the build\n\ndetails");
    }
}
