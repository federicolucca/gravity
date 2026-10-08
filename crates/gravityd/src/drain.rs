//! Restarting the daemon without losing work.
//!
//! A restart ends every bot's session. Before one, the deploy asks the daemon
//! to drain: for a while no new work is handed out (bus deliveries and routine
//! runs stay queued, board tasks wait), so busy bots finish and go idle. Bots
//! still working when the daemon stops are recorded, and once they are back up
//! (resumed with `--continue`) they are told to carry on.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use bus::BotState;
use serde_json::json;

use crate::app::AppState;

const INTERRUPTED_FILE: &str = "interrupted.json";
/// A bot that has not come back up by then is left alone.
const RESUME_WITHIN: Duration = Duration::from_secs(15 * 60);
const MAX_DRAIN_MINUTES: u64 = 30;
const RESUME_PROMPT: &str = "The Gravity daemon was updated and your previous turn was \
    interrupted; carry on where you left off.";

static UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

/// Holds new work back for `minutes` (capped); 0 ends the drain.
pub fn start(minutes: u64) {
    let until = (minutes > 0)
        .then(|| Instant::now() + Duration::from_secs(minutes.min(MAX_DRAIN_MINUTES) * 60));
    *UNTIL.lock().unwrap_or_else(|e| e.into_inner()) = until;
}

/// True while new work is held back.
pub fn active() -> bool {
    UNTIL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some_and(|until| Instant::now() < until)
}

fn interrupted_path(home: &Path) -> PathBuf {
    home.join(INTERRUPTED_FILE)
}

/// `bot id → when the daemon stopped (RFC 3339)`.
type Interrupted = BTreeMap<String, String>;

fn load(home: &Path) -> Interrupted {
    std::fs::read_to_string(interrupted_path(home))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Called as the daemon stops: notes every bot caught mid-turn.
pub fn record_interrupted(app: &AppState) {
    let bots = match app.db.list_bots(None) {
        Ok(bots) => bots,
        Err(e) => {
            tracing::warn!(error = %e, "cannot list bots to record interrupted turns");
            return;
        }
    };
    let now = chrono::Utc::now().to_rfc3339();
    let working: Interrupted = bots
        .iter()
        .filter(|bot| app.supervisor.state(&bot.id).0 == BotState::Working)
        .map(|bot| (bot.id.clone(), now.clone()))
        .collect();
    if working.is_empty() {
        return;
    }
    tracing::info!(bots = working.len(), "recording interrupted turns");
    if let Err(e) =
        crate::paths::atomic_write_json(&interrupted_path(&app.cfg.home), &json!(working))
    {
        tracing::warn!(error = %e, "cannot record interrupted turns");
    }
}

/// Tells each interrupted bot that is back up to carry on; stale entries expire.
pub fn resume_ready(app: &AppState) {
    let mut pending = load(&app.cfg.home);
    if pending.is_empty() {
        return;
    }
    let before = pending.len();
    pending.retain(|bot_id, at| {
        let fresh = chrono::DateTime::parse_from_rfc3339(at).is_ok_and(|at| {
            (chrono::Utc::now() - at.with_timezone(&chrono::Utc))
                .to_std()
                .is_ok_and(|age| age < RESUME_WITHIN)
        });
        if !fresh {
            return false;
        }
        if app.supervisor.state(bot_id).0 != BotState::Ready {
            return true;
        }
        if let Err(e) = crate::tasks::send_prompt(app, bot_id, RESUME_PROMPT) {
            tracing::warn!(bot_id, error = %e, "cannot resume interrupted turn");
        } else {
            tracing::info!(bot_id, "resumed interrupted turn");
        }
        false
    });
    if pending.len() == before {
        return;
    }
    let path = interrupted_path(&app.cfg.home);
    let result = if pending.is_empty() {
        std::fs::remove_file(&path).map_err(anyhow::Error::from)
    } else {
        crate::paths::atomic_write_json(&path, &json!(pending))
    };
    if let Err(e) = result {
        tracing::warn!(error = %e, "cannot update interrupted turns");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_drain_starts_and_ends() {
        start(5);
        assert!(active());
        start(0);
        assert!(!active());
    }
}
