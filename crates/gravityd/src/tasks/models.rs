//! Which model a queued task runs with, and switching a bot to it and back.
//!
//! A typed `/model` would rewrite the owner's global Claude Code default, so a
//! switch is a session restart with `--model` instead (the session resumes
//! with `--continue`, keeping the conversation). The override is persisted so
//! a daemon restart mid-task keeps it; once the task queue no longer needs it,
//! the bot is restarted once more on the model it had before ("home"), and
//! that start re-pins home instead of learning the override back from the
//! transcript.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::app::AppState;

use super::Task;

const OVERRIDES_FILE: &str = "model_overrides.json";

static LOCK: Mutex<()> = Mutex::new(());

/// The model choices a task can name; anything else is "auto".
pub const CHOICES: &[&str] = &["auto", "opus", "sonnet", "haiku"];

/// `"auto"` (or nothing) is stored as `None`.
pub fn parse_choice(raw: Option<&str>) -> anyhow::Result<Option<String>> {
    match raw {
        None | Some("" | "auto") => Ok(None),
        Some(choice) if CHOICES.contains(&choice) => Ok(Some(choice.to_string())),
        Some(_) => anyhow::bail!("model is one of auto, opus, sonnet, haiku"),
    }
}

fn model_id(choice: &str) -> Option<&'static str> {
    match choice {
        "opus" => Some("claude-opus-5-5"),
        "sonnet" => Some("claude-sonnet-5-5"),
        "haiku" => Some("claude-haiku-5-5"),
        _ => None,
    }
}

/// The model id a task should run with; `None` keeps whatever the bot runs.
pub fn resolve(task: &Task) -> Option<&'static str> {
    let choice = task.model.as_deref().or_else(|| auto_choice(task))?;
    model_id(choice)
}

/// Words that mark heavy work: code changes, design, debugging.
const HEAVY: &[&str] = &[
    "implement",
    "refactor",
    "debug",
    "design",
    "architect",
    "migrate",
    "rewrite",
    "investigate",
    "root cause",
    "crash",
    "race",
    "optimi",
    "security",
    "build ",
    "feature",
    "fix",
    "implementa",
    "progetta",
    "rifattorizza",
    "riscrivi",
    "indaga",
    "correggi",
    "sistema",
    "migra",
    "sviluppa",
];
/// Words that mark a quick lookup, check or summary.
const LIGHT: &[&str] = &[
    "check",
    "list",
    "status",
    "summar",
    "show",
    "count",
    "look up",
    "lookup",
    "ping",
    "verify",
    "remind",
    "translate",
    "rename",
    "riassumi",
    "riassunto",
    "controlla",
    "verifica",
    "elenca",
    "mostra",
    "conta",
    "stato",
    "ricorda",
    "traduci",
];

/// The routing rule for "auto", a transparent heuristic with no API call:
/// heavy words, attachments or a long brief go to Opus; a short brief made of
/// light words goes to Haiku; everything else is normal work for Sonnet.
fn auto_choice(task: &Task) -> Option<&'static str> {
    let text = format!("{}\n{}", task.title, task.body).to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| text.contains(w));
    let len = text.chars().count();
    let attachments = text.contains("attached file:");
    if has(HEAVY) || attachments || len > 1200 {
        Some("opus")
    } else if has(LIGHT) && len <= 300 {
        Some("haiku")
    } else {
        Some("sonnet")
    }
}

/// Same model family, ignoring a context-window suffix like `[1m]`.
pub fn same_family(a: &str, b: &str) -> bool {
    let base = |id: &str| id.split_once('[').map_or(id, |(base, _)| base).to_string();
    base(a) == base(b)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ModelOverride {
    pub model: String,
    /// The model to go back to; `None` when the bot had no pin.
    pub home: Option<String>,
    /// Set once the override is no longer wanted: the next start goes home.
    #[serde(default)]
    pub restore: bool,
}

fn path(home: &Path) -> PathBuf {
    home.join(OVERRIDES_FILE)
}

fn load(home: &Path) -> HashMap<String, ModelOverride> {
    std::fs::read_to_string(path(home))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn edit<T>(
    home: &Path,
    change: impl FnOnce(&mut HashMap<String, ModelOverride>) -> T,
) -> anyhow::Result<T> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load(home);
    let out = change(&mut all);
    crate::paths::atomic_write_json(&path(home), &serde_json::to_value(&all)?)?;
    Ok(out)
}

/// The override in force for a bot, if any (not one already being undone).
pub fn active(home: &Path, bot_id: &str) -> Option<ModelOverride> {
    load(home).remove(bot_id).filter(|o| !o.restore)
}

/// What the supervisor should pin when it starts a bot.
#[derive(Debug, PartialEq)]
pub enum StartModel {
    /// No task override: the usual pin-and-learn.
    Normal,
    /// A task's model, pinned without learning from the transcript.
    Override(String),
    /// Back from an override: pin this and store it as the bot's model.
    Restore(Option<String>),
}

/// Called on every start of a Claude Code bot; consumes a pending restore.
pub fn for_start(home: &Path, bot_id: &str) -> StartModel {
    match load(home).get(bot_id) {
        None => StartModel::Normal,
        Some(o) if !o.restore => StartModel::Override(o.model.clone()),
        Some(_) => match edit(home, |all| all.remove(bot_id)) {
            Ok(Some(o)) => StartModel::Restore(o.home),
            Ok(None) => StartModel::Normal,
            Err(e) => {
                tracing::warn!(bot_id, error = %e, "could not clear the model override");
                StartModel::Normal
            }
        },
    }
}

/// Restarts the bot on `model`, remembering what to come back to.
pub fn switch(app: &AppState, bot_id: &str, model: &str) -> anyhow::Result<()> {
    let pinned = app.db.bot_model(bot_id)?;
    edit(&app.cfg.home, |all| {
        let home = match all.get(bot_id) {
            Some(o) if !o.restore => o.home.clone(),
            _ => pinned,
        };
        all.insert(
            bot_id.to_string(),
            ModelOverride {
                model: model.to_string(),
                home,
                restore: false,
            },
        );
    })?;
    tracing::info!(bot_id, model, "restarting the bot on the task's model");
    app.supervisor.restart_bot(bot_id)
}

/// Restarts the bot on its own model again, if a task override is in force.
pub fn restore(app: &AppState, bot_id: &str) -> anyhow::Result<()> {
    let marked = edit(&app.cfg.home, |all| match all.get_mut(bot_id) {
        Some(o) if !o.restore => {
            o.restore = true;
            true
        }
        _ => false,
    })?;
    if marked {
        tracing::info!(bot_id, "restarting the bot on its own model");
        app.supervisor.restart_bot(bot_id)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choices_parse_and_resolve() {
        assert_eq!(parse_choice(Some("auto")).unwrap(), None);
        assert_eq!(
            parse_choice(Some("haiku")).unwrap().as_deref(),
            Some("haiku")
        );
        assert!(parse_choice(Some("gpt")).is_err());
        assert!(same_family("claude-opus-5-5[1m]", "claude-opus-5-5"));
        assert!(!same_family("claude-opus-5-5", "claude-sonnet-5-5"));
    }

    fn sample(title: &str, body: &str) -> Task {
        super::super::new_task("b", title.into(), body.into(), None)
    }

    #[test]
    fn auto_routes_by_weight_and_an_explicit_choice_wins() {
        let route = |title: &str, body: &str| auto_choice(&sample(title, body));
        assert_eq!(route("Check the disk status", ""), Some("haiku"));
        assert_eq!(route("Riassumi le mail di oggi", ""), Some("haiku"));
        assert_eq!(route("Controlla se il deploy è finito", ""), Some("haiku"));
        assert_eq!(
            route("Write the release notes for 0.13", ""),
            Some("sonnet")
        );
        assert_eq!(
            route("Aggiorna il README con la nuova porta", ""),
            Some("sonnet")
        );
        assert_eq!(route("Implement the export endpoint", ""), Some("opus"));
        assert_eq!(
            route("Debug why the bot crashes on start", ""),
            Some("opus")
        );
        assert_eq!(route("Correggi il bug del login", ""), Some("opus"));
        assert_eq!(
            route("Check this", "Attached file: `/tmp/a.png`"),
            Some("opus")
        );
        assert_eq!(route("Status", &"x".repeat(400)), Some("sonnet"));
        assert_eq!(route("Write docs", &"x".repeat(1300)), Some("opus"));
        let mut explicit = sample("Implement everything", "");
        explicit.model = Some("haiku".into());
        assert_eq!(resolve(&explicit), Some("claude-haiku-5-5"));
        assert_eq!(
            resolve(&sample("Check the status", "")),
            Some("claude-haiku-5-5")
        );
    }

    #[test]
    fn a_restore_is_consumed_by_the_next_start() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        assert_eq!(for_start(home, "b"), StartModel::Normal);
        edit(home, |all| {
            all.insert(
                "b".into(),
                ModelOverride {
                    model: "claude-haiku-5-5".into(),
                    home: Some("claude-opus-5-5".into()),
                    restore: false,
                },
            );
        })
        .unwrap();
        assert_eq!(
            for_start(home, "b"),
            StartModel::Override("claude-haiku-5-5".into())
        );
        assert!(active(home, "b").is_some());
        edit(home, |all| all.get_mut("b").unwrap().restore = true).unwrap();
        assert!(active(home, "b").is_none());
        assert_eq!(
            for_start(home, "b"),
            StartModel::Restore(Some("claude-opus-5-5".into()))
        );
        assert_eq!(for_start(home, "b"), StartModel::Normal);
    }
}
