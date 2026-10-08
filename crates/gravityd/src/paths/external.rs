//! External working directories: a bot that runs inside an existing project
//! (a repository with its own `CLAUDE.md` and `.claude/`) instead of its own
//! workspace.
//!
//! Opt-in per bot with a one-line `working_dir` file in the bot's root
//! (`<bot>/working_dir`, next to `system.md`) holding an absolute path. The
//! bot's own workspace is still provisioned and stays where retention and
//! backups expect it, but the runtime is started in the external directory and
//! nothing is written there: Gravity's hooks and permission rules reach the
//! session through `--settings` instead of the project's
//! `.claude/settings.json`. Transcript lookups follow the same directory, so
//! activity, model pinning and `--continue` pick up the conversation the
//! project already has. Unix only; on Windows the marker is ignored.

use std::path::{Path, PathBuf};

use crate::config::Config;

/// Name of the marker file in the bot root.
pub const WORKING_DIR_FILE: &str = "working_dir";
/// Gravity's settings for an externally rooted session, in the bot root.
const SETTINGS_FILE: &str = "external-settings.json";

/// The directory a bot's runtime runs in: the external directory named by the
/// marker when it is an existing absolute directory, else the workspace.
pub fn run_dir(workspace: &Path) -> PathBuf {
    external_dir(workspace).unwrap_or_else(|| workspace.to_path_buf())
}

#[cfg(unix)]
fn external_dir(workspace: &Path) -> Option<PathBuf> {
    let marker = workspace.parent()?.join(WORKING_DIR_FILE);
    let raw = std::fs::read_to_string(marker).ok()?;
    let dir = PathBuf::from(raw.trim());
    (dir.is_absolute() && dir.is_dir()).then_some(dir)
}

#[cfg(not(unix))]
fn external_dir(_workspace: &Path) -> Option<PathBuf> {
    None
}

/// Every Claude Code bot is also reachable through Claude Code Remote Control
/// (claude.ai/code and the mobile app), under the bot's name, like the tmux
/// sessions it replaces.
pub fn remote_control_args(bot_name: &str) -> [String; 2] {
    ["--remote-control".to_string(), bot_name.to_string()]
}

/// Where the files the owner uploads for a bot are kept.
pub fn uploads_dir(gravity_home: &Path, bot_id: &str) -> PathBuf {
    gravity_home.join("uploads").join(bot_id)
}

/// Per-session arguments every Claude Code bot gets: Remote Control, and read
/// access to the files the owner uploads for it (`ws::uploads`).
pub fn session_args(cfg: &Config, bot: &bus::Bot) -> Vec<String> {
    let mut args = remote_control_args(&bot.name).to_vec();
    let uploads = uploads_dir(&cfg.home, &bot.id);
    if std::fs::create_dir_all(&uploads).is_ok() {
        let dir = uploads.display();
        args.extend([
            "--add-dir".to_string(),
            dir.to_string(),
            "--allowedTools".to_string(),
            format!("Read({dir}/**)"),
        ]);
    }
    args
}

/// How to launch a bot whose runtime runs in an external directory.
pub struct ExternalLaunch {
    pub dir: PathBuf,
    /// Extra runtime arguments (`--settings <file>`).
    pub args: Vec<String>,
    /// The directory already holds a conversation the bot should continue.
    pub has_transcript: bool,
}

/// Prepares an external launch, or `None` for a bot that runs in its own
/// workspace. Writes Gravity's hook settings into the bot root and trusts the
/// external directory; a settings failure falls back to the workspace.
pub fn prepare(cfg: &Config, workspace: &Path, bot_token_env: &str) -> Option<ExternalLaunch> {
    let dir = external_dir(workspace)?;
    let settings = workspace.parent()?.join(SETTINGS_FILE);
    if let Err(e) = write_settings(&settings, cfg.port, bot_token_env) {
        tracing::warn!(dir = %dir.display(), error = %e, "external settings not written; using the workspace");
        return None;
    }
    if let Err(e) = super::trust_workspace(&cfg.user_home, &dir) {
        tracing::warn!(dir = %dir.display(), error = %e, "could not trust external directory");
    }
    let transcripts = crate::activity::transcript_dir(&cfg.user_home, workspace);
    Some(ExternalLaunch {
        has_transcript: crate::activity::newest_transcript(&transcripts).is_some(),
        args: vec!["--settings".to_string(), settings.display().to_string()],
        dir,
    })
}

/// The same hooks and permission rules a workspace session gets.
#[cfg(unix)]
fn write_settings(path: &Path, daemon_port: u16, bot_token_env: &str) -> anyhow::Result<()> {
    super::atomic_write_json(path, &super::hook_settings(daemon_port, bot_token_env))
}

#[cfg(not(unix))]
fn write_settings(_path: &Path, _daemon_port: u16, _bot_token_env: &str) -> anyhow::Result<()> {
    anyhow::bail!("external working directories are not supported on this platform")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn run_dir_follows_a_valid_marker_only() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("bot");
        let workspace = root.join("workspace");
        let project = tmp.path().join("project");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        assert_eq!(run_dir(&workspace), workspace);

        std::fs::write(
            root.join(WORKING_DIR_FILE),
            format!("{}\n", project.display()),
        )
        .unwrap();
        assert_eq!(run_dir(&workspace), project);

        std::fs::write(root.join(WORKING_DIR_FILE), "relative/path").unwrap();
        assert_eq!(run_dir(&workspace), workspace);

        let missing = tmp.path().join("missing");
        std::fs::write(root.join(WORKING_DIR_FILE), missing.display().to_string()).unwrap();
        assert_eq!(run_dir(&workspace), workspace);
    }

    #[test]
    fn external_settings_match_the_workspace_settings() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(SETTINGS_FILE);
        write_settings(&path, 49777, "GRAVITY_TOKEN").unwrap();
        let settings: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            settings,
            crate::paths::hook_settings(49777, "GRAVITY_TOKEN")
        );
        assert!(settings["hooks"]["SessionStart"].is_array());
    }
}
